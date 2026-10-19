const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { StringDecoder } = require('node:string_decoder');
const run = promisify(execFile);
const { ConfigStore, envValues, atomic, validate } = require('./config.cjs');
const { Certificates } = require('./certificates.cjs');
const { CliProxy } = require('./cli.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const FRP_VERSION = '0.71.1';

async function available(port, host = '127.0.0.1') {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`端口 ${port} 已被占用；不会停止占用它的其他程序`)));
    server.listen(port, host, () => server.close(resolve));
  });
}
async function udpAvailable(port, host = '127.0.0.1') {
  await new Promise((resolve, reject) => {
    const socket = dgram.createSocket(host.includes(':') ? 'udp6' : 'udp4');
    socket.once('error', () => { socket.close(); reject(new Error(`语音 UDP 端口 ${port} 已被占用；不会停止占用它的其他程序`)); });
    socket.bind(port, host, () => socket.close(resolve));
  });
}
function livekitReady(port) {
  return new Promise(resolve => {
    const request = http.get({host:'127.0.0.1',port,path:'/',timeout:1000}, response => { response.resume(); response.on('end', () => resolve(response.statusCode === 200)); });
    request.once('error', () => resolve(false)); request.once('timeout', () => { request.destroy(); resolve(false); });
  });
}
function probe(port, secure, ca) {
  return new Promise(resolve => {
    const request = (secure ? https : http).get({ host: '127.0.0.1', port, path: '/health', timeout: 1200, ...(secure ? { ca, servername: 'localhost', rejectUnauthorized: true } : {}) }, response => {
      let body = ''; response.on('data', data => { if (body.length < 4096) body += data; });
      response.on('end', () => resolve(response.statusCode === 200 && (body.includes('ok') || body.includes('status'))));
    });
    request.once('error', () => resolve(false)); request.once('timeout', () => { request.destroy(); resolve(false); });
  });
}
class Controller extends EventEmitter {
  constructor({ root, stateDir, frpc, cliExecutable, cipher }) {
    super(); this.root = path.resolve(root); this.dir = path.resolve(stateDir); this.frpc = frpc;
    this.store = new ConfigStore(this.dir, this.root, cipher);
    this.events = []; this.redactions = []; this.backend = null; this.frp = null; this.livekit = null;
    this.voiceCredentials = { key: crypto.randomBytes(12).toString('hex'), secret: crypto.randomBytes(48).toString('hex') };
    this.livekitStopPromise = null;
    this.backendState = 'stopped'; this.frpState = 'stopped'; this.voiceState = 'stopped'; this.operation = false;
    this.active = null; this.trusted = false; this.frpRegistrations = new Set();
    this.hostExe = path.join(path.dirname(__dirname).replace('app.asar', 'app.asar.unpacked'), 'assets', 'ZViewer.ProcessHost.exe');
    this.windowsHelper = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'windows-process.ps1');
    this.certificates = new Certificates(this.dir, (...args) => this.log(...args));
    this.cli = new CliProxy({ root: this.root, executable: cliExecutable, hostExe: this.hostExe,
      kill: (child, exe) => this.kill(child, exe), log: (...args) => this.log(...args),
      onUpdate: () => this.emit('update', this.snapshot()) });
    this.log('桌面控制台已就绪；配置将在下次启动自动读取');
  }
  sanitize(text) {
    let message = String(text).replace(/\x1b\[[0-9;]*m/g, '');
    for (const secret of this.redactions) if (secret.length >= 4) message = message.split(secret).join('[已隐藏]');
    return message.replace(/((?:token|secret|password|密码|authorization|cookie|SESSDATA|bili_jct)\s*[:=：]\s*)([^\r\n]+)/gi, '$1[已隐藏]').slice(0, 4000);
  }
  log(message, source = 'console', level = 'INFO') {
    const text = this.sanitize(message); if (!text.trim()) return;
    const event = { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), at: new Date().toISOString(), source, level, message: text };
    this.events.unshift(event); this.events.length = Math.min(500, this.events.length);
    const logFile = path.join(this.dir, 'logs', 'desktop.log'); fs.mkdirSync(path.dirname(logFile), { recursive: true });
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) fs.renameSync(logFile, `${logFile}.previous`);
    fs.appendFileSync(logFile, JSON.stringify(event) + '\n');
    this.emit('log', event); this.emit('update', this.snapshot());
  }
  snapshot() {
    return { config: this.store.value, active: this.active, webUrl: this.webUrl(), backend: this.backendState, voice: this.voiceState,
      frp: this.frpState, cli: this.cli.snapshot(), pid: this.backend?.pid || null, voicePid: this.livekit?.pid || null, frpPid: this.frp?.pid || null,
      tokenSaved: !!this.store.secret, certificate: { ...this.certificates.inspect(), trusted: this.trusted },
      events: this.events, root: this.root, frpcAvailable: fs.existsSync(this.frpc || ''),
      runtime: { backend: fs.existsSync(path.join(this.root, 'zviewer-backend.exe')), cert: true, livekit: fs.existsSync(path.join(this.root, 'livekit-server.exe')), web: fs.existsSync(path.join(this.root, 'frontend', 'dist', 'index.html')) } };
  }
  save(patch, token) { const config = this.store.save(patch, token); this.log('用户配置已保存，服务参数在下次启动或重启后生效'); return config; }
  async exclusive(task) {
    if (this.operation) throw new Error('正在执行另一项服务操作，请稍后');
    this.operation = true;
    try { return await task(); }
    catch (error) {
      if (this.backendState === 'starting') { await this.stopBackend().catch(cleanup => this.log(cleanup.message, 'backend', 'ERROR')); this.backendState = 'error'; }
      throw error;
    } finally { this.operation = false; this.emit('update', this.snapshot()); }
  }
  watch(child, source, onLine) {
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new StringDecoder('utf8'); let pending = '';
      stream.on('data', chunk => {
        pending += decoder.write(chunk); const lines = pending.split(/\r?\n/); pending = lines.pop();
        if (pending.length > 16000) { lines.push(pending.slice(0, 4000)); pending = ''; }
        for (const line of lines) { this.log(line, source, /error|fatal|failed|错误|失败/i.test(line) ? 'ERROR' : /warn|警告/i.test(line) ? 'WARN' : 'INFO'); onLine?.(line); }
      });
      stream.on('end', () => { pending += decoder.end(); if (pending.trim()) this.log(pending, source); });
    }
  }
  environment() {
    let values = envValues(this.root);
    if (!fs.existsSync(path.join(this.root, '.env'))) {
      const jwt1 = crypto.randomBytes(48).toString('hex'), jwt2 = crypto.randomBytes(48).toString('hex');
      atomic(path.join(this.root, '.env'), `# Generated locally by ZViewer Desktop\nPORT=3333\nHOST=127.0.0.1\nNODE_ENV=production\nJWT_ACCESS_SECRET=${jwt1}\nJWT_REFRESH_SECRET=${jwt2}\n`);
      values = envValues(this.root);
    }
    const c = this.store.value, cert = this.certificates.paths();
    this.redactions = [...Object.entries(values).filter(([key]) => /SECRET|TOKEN|PASSWORD|API_KEY/.test(key)).map(([, value]) => value), this.voiceCredentials.key, this.voiceCredentials.secret].filter(Boolean);
    return { ...process.env, ...values, NODE_ENV: 'production', PORT: String(c.port), HOST: c.bindHost, HTTPS: String(c.https), RTMP_PORT: String(c.rtmpPort), HTTP_FLV_PORT: String(c.flvPort),
      LIVEKIT_EXTERNAL: '1', LIVEKIT_API_HOST: `http://127.0.0.1:${c.livekitPort}`, LIVEKIT_API_KEY: this.voiceCredentials.key, LIVEKIT_API_SECRET: this.voiceCredentials.secret, LIVEKIT_URL: '',
      ...(c.https ? { SSL_CERT_PATH: cert.cert, SSL_KEY_PATH: cert.key } : {}),
      ...(c.bindHost === '127.0.0.1' && !values.LIVEKIT_BIND ? { LIVEKIT_BIND: '127.0.0.1', LIVEKIT_NODE_IP: values.LIVEKIT_NODE_IP || '127.0.0.1', LIVEKIT_RTC_USE_EXTERNAL_IP: 'false' } : {}),
      ...(c.frp.advertiseIp ? { LIVEKIT_NODE_IP: c.frp.advertiseIp, LIVEKIT_RTC_USE_EXTERNAL_IP: 'false' } : {}) };
  }
  async start() { return this.exclusive(() => this.startBackend()); }
  async startLivekit(env) {
    const c = this.store.value, exe = path.join(this.root, 'livekit-server.exe');
    if (!fs.existsSync(exe)) throw new Error('缺少 livekit-server.exe');
    const nodeIp = c.frp.advertiseIp || env.LIVEKIT_NODE_IP || '';
    const config = { port: c.livekitPort, bind_addresses: [c.bindHost], rtc: { udp_port: c.port, tcp_port: c.livekitTcpPort, enable_loopback_candidate: true, use_external_ip: !nodeIp && env.LIVEKIT_RTC_USE_EXTERNAL_IP === 'true' }, keys: { [this.voiceCredentials.key]: this.voiceCredentials.secret }, logging: { level: 'info' } };
    if (c.bindHost === '127.0.0.1' && !c.frp.advertiseIp) config.rtc.ips = { includes: ['127.0.0.0/8','::1/128'] };
    const child = spawn(process.platform === 'win32' ? this.hostExe : exe, process.platform === 'win32' ? [exe] : [], { cwd: this.root, env: { ...env, LIVEKIT_CONFIG: JSON.stringify(config), NODE_IP: nodeIp }, windowsHide: true, shell: false, stdio: ['pipe','pipe','pipe'] });
    this.livekit = child;
    this.watch(child, 'voice');
    child.on('error', error => { this.voiceState = 'error'; this.log(error.message, 'voice', 'ERROR'); });
    child.on('exit', (code, signal) => {
      if (this.livekit !== child) return;
      this.livekit = null; this.voiceState = this.voiceState === 'stopping' ? 'stopped' : 'error';
      this.log(`LiveKit 进程已退出（${code ?? signal}）`, 'voice', this.voiceState === 'error' ? 'ERROR' : 'INFO');
    });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && this.livekit === child && child.exitCode === null && child.pid) {
      if (await livekitReady(c.livekitPort)) {
        if (process.platform === 'win32') {
          const {stdout} = await run('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',this.windowsHelper,'-Action','inspect','-ProcessId',String(child.pid),'-Port',String(c.livekitPort),'-ExpectedPath',this.hostExe,'-UdpPort',String(c.port),'-MediaTcpPort',String(c.livekitTcpPort)], {windowsHide:true});
          const inspected = JSON.parse(stdout);
          if (!inspected.owner.some(pid => inspected.members.includes(pid))) throw new Error('LiveKit 信令端口不属于 GUI 启动的进程树');
          if (!inspected.udpOwner.some(pid => inspected.members.includes(pid)) || !inspected.rtcOwner.some(pid => inspected.members.includes(pid))) throw new Error('LiveKit 语音 UDP / TCP 端口未由受管进程监听');
          if (!inspected.udpAddresses.includes('127.0.0.1') && !inspected.udpAddresses.includes('0.0.0.0')) throw new Error('LiveKit 未监听 UDP 回环地址，本机访问与 FRP 转发不可用');
        }
        this.voiceState = 'running';
        this.log(`LiveKit 已就绪：信令 TCP ${c.livekitPort}，媒体 UDP ${c.port}，RTC TCP ${c.livekitTcpPort}`, 'voice'); return;
      }
      await delay(250);
    }
    throw new Error('LiveKit 未通过就绪检查，请检查端口或查看运行日志');
  }
  async stopLivekit() {
    if (this.livekitStopPromise) return this.livekitStopPromise;
    if (!this.livekit) { this.voiceState = 'stopped'; return; }
    const child = this.livekit;
    this.voiceState = 'stopping';
    this.livekitStopPromise = (async () => {
      await this.kill(child, process.platform === 'win32' ? this.hostExe : path.join(this.root,'livekit-server.exe'));
      this.voiceState = 'stopped';
    })();
    try { await this.livekitStopPromise; } finally { this.livekitStopPromise = null; }
  }
  async startBackend() {
    if (this.backend) return this.snapshot();
    if (this.livekit || this.livekitStopPromise) await this.stopLivekit();
    const c = this.store.value, exe = path.join(this.root, 'zviewer-backend.exe');
    if (!fs.existsSync(exe) || !fs.existsSync(path.join(this.root, 'frontend', 'dist', 'index.html'))) throw new Error('缺少后端或网页运行文件');
    for (const n of [c.port, c.rtmpPort, c.flvPort, c.livekitPort, c.livekitTcpPort]) await available(n, c.bindHost);
    await udpAvailable(c.port, c.bindHost);
    if (c.https) await this.certificates.ensure(c.domain, c.lanIp);
    this.backendState = 'starting'; this.voiceState = 'starting'; this.emit('update', this.snapshot());
    if (process.platform === 'win32' && !fs.existsSync(this.hostExe)) throw new Error('缺少进程监管组件 ZViewer.ProcessHost.exe');
    const env = this.environment(); await this.startLivekit(env);
    const child = spawn(process.platform === 'win32' ? this.hostExe : exe, process.platform === 'win32' ? [exe] : [], { cwd: this.root, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    this.backend = child; this.active = structuredClone(c);
    this.watch(child, 'backend');
    child.on('error', error => { this.backendState = 'error'; this.log(error.message, 'backend', 'ERROR'); });
    child.on('exit', (code, signal) => {
      if (this.backend !== child) return;
      this.backend = null; this.active = null;
      const intentional = this.backendState === 'stopping';
      this.backendState = intentional ? 'stopped' : 'error';
      this.log(`后端进程已退出（${code ?? signal}）`, 'backend', this.backendState === 'error' ? 'ERROR' : 'INFO');
      if (this.frp) this.stopFrp().catch(error => this.log(error.message, 'frp', 'ERROR'));
      if (this.livekit && !intentional) this.stopLivekit().catch(error => this.log(error.message, 'voice', 'ERROR'));
      if (!intentional) this.cli.stop().catch(error => this.log(error.message, 'cli', 'ERROR'));
    });
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline && child.exitCode === null && this.backend === child && child.pid) {
      const ca = c.https ? fs.readFileSync(this.certificates.paths().ca) : undefined;
      if (await probe(c.port, c.https, ca)) {
        if (process.platform === 'win32') {
          const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.windowsHelper, '-Action', 'inspect', '-ProcessId', String(child.pid), '-Port', String(c.port), '-ExpectedPath', this.hostExe], { windowsHide: true });
          const inspected = JSON.parse(stdout);
          if (!inspected.owner.some(pid => inspected.members.includes(pid))) throw new Error('监听端口不属于 GUI 启动的进程树');
        }
        this.backendState = 'running'; this.log(`服务已就绪：${c.https ? 'https' : 'http'}://localhost:${c.port}，PID ${child.pid}`, 'backend');
        if (c.cli.autoStart) {
          try { await this.cli.start(c.cli.port); }
          catch (error) { this.log(`高画质代理启动失败：${error.message}`, 'cli', 'ERROR'); }
        }
        return this.snapshot();
      }
      await delay(350);
    }
    if (this.backend === child) await this.stopBackend();
    this.backendState = 'error'; throw new Error('后端未在 45 秒内通过健康检查，请查看运行日志');
  }
  async kill(child, exe) {
    if (!child || child.exitCode !== null || child.killed || !child.pid) return;
    if (exe === this.hostExe && child.stdin?.writable) {
      child.stdin.write('stop\n');
      for (let i = 0; i < 140 && child.exitCode === null; i++) await delay(100);
      if (child.exitCode !== null) return;
    }
    if (process.platform === 'win32') await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.windowsHelper, '-Action', 'stop', '-ProcessId', String(child.pid), '-ExpectedPath', exe], { windowsHide: true });
    else child.kill('SIGTERM');
    for (let i = 0; i < 50 && child.exitCode === null; i++) await delay(100);
    if (child.exitCode === null) throw new Error('受管进程停止超时');
  }
  async stopBackend() {
    await this.stopFrp();
    await this.cli.stop();
    if (!this.backend) { await this.stopLivekit(); this.backendState = 'stopped'; return; }
    this.backendState = 'stopping'; this.emit('update', this.snapshot());
    await this.kill(this.backend, process.platform === 'win32' ? this.hostExe : path.join(this.root, 'zviewer-backend.exe'));
    await this.stopLivekit();
    this.backendState = 'stopped'; this.voiceState = 'stopped'; this.log('已停止本控制台启动的后端及其伴生进程', 'backend');
  }
  async stop() { return this.exclusive(async () => { await this.stopBackend(); return this.snapshot(); }); }
  async restart() { return this.exclusive(async () => { await this.stopBackend(); return this.startBackend(); }); }
  async enableHttps(domain = 'localhost', ip = '') {
    return this.exclusive(async () => {
      if (this.backend && this.backendState !== 'running') throw new Error('请等待当前服务操作完成');
      const cert = await this.certificates.ensure(domain, ip);
      this.store.save({ https: true, domain, lanIp: ip });
      if (this.backend) await this.stopBackend();
      await this.startBackend();
      return cert;
    });
  }
  frpConfig(server = false) {
    const c = this.store.value, f = c.frp;
    const token = 'auth.method = "token"\nauth.token = "{{ .Envs.FRP_TOKEN }}"';
    if (server) return `# 设置环境变量 FRP_TOKEN 后运行 frps\nbindPort = ${f.port}\n${token}\ntransport.tls.force = true\n`;
    const proxy = (name, type, local, remote) => `\n[[proxies]]\nname = "zviewer-${name}"\ntype = "${type}"\nlocalIP = "127.0.0.1"\nlocalPort = ${local}\nremotePort = ${remote}\n`;
    return `serverAddr = ${JSON.stringify(f.host || 'YOUR_VPS_IP')}\nserverPort = ${f.port}\n${token}\ntransport.tls.enable = true\n${proxy('backend', 'tcp', c.port, f.webPort)}${f.voice ? proxy('voice', 'udp', c.port, f.voicePort) : ''}${f.rtmp ? proxy('rtmp', 'tcp', c.rtmpPort, f.rtmpPort) : ''}${f.tcp ? proxy('voice-tcp', 'tcp', c.livekitTcpPort, f.tcpPort) : ''}`;
  }
  async startFrp() {
    return this.exclusive(async () => {
      if (this.frp && this.frpState !== 'error') return this.snapshot();
      if (this.frp) await this.stopFrp();
      if (this.backendState !== 'running') throw new Error('请先启动本地服务');
      const config = validate(this.store.value);
      if (['port','rtmpPort','livekitPort','livekitTcpPort'].some(key => this.active[key] !== config[key]) || this.active.frp.advertiseIp !== config.frp.advertiseIp) throw new Error('服务端口或语音公布地址已修改，请先重启本地服务再连接 FRP');
      if (!config.frp.host) throw new Error('请先保存 VPS 地址');
      if (!fs.existsSync(this.frpc || '')) throw new Error('未找到 frpc.exe');
      const token = this.store.token(); if (!token) throw new Error('请填写并保存 FRP Token');
      this.redactions.push(token);
      const version = await run(this.frpc, ['--version'], { windowsHide: true });
      if (version.stdout.trim().replace(/^v/, '') !== FRP_VERSION) throw new Error(`需要 FRP ${FRP_VERSION}`);
      const file = path.join(this.dir, 'frp', 'frpc.toml'); atomic(file, this.frpConfig());
      const env = { ...process.env, FRP_TOKEN: token };
      await run(this.frpc, ['verify', '-c', file], { windowsHide: true, env });
      this.frpState = 'connecting'; this.frpRegistrations.clear();
      const expected = 1 + Number(config.frp.voice) + Number(config.frp.rtmp) + Number(config.frp.tcp);
      const child = spawn(this.frpc, ['-c', file], { cwd: path.dirname(file), env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      this.frp = child;
      this.watch(child, 'frp', line => {
        const match = line.match(/\[(zviewer-[\w-]+)\].*start proxy success/i);
        if (match) { this.frpRegistrations.add(match[1]); if (this.frpRegistrations.size >= expected) { this.frpState = 'registered'; this.log('FRP 代理已注册；公网网页和语音仍需外网设备验收', 'frp'); } }
        if (/login to server failed|connect to server error|start error/i.test(line)) this.frpState = 'error';
        this.emit('update', this.snapshot());
      });
      child.on('error', error => { this.frpState = 'error'; this.log(error.message, 'frp', 'ERROR'); });
      child.on('exit', code => { if (this.frp === child) { this.frp = null; this.frpState = this.frpState === 'stopping' ? 'stopped' : 'error'; this.log(`FRP 已退出（${code}）`, 'frp', this.frpState === 'error' ? 'ERROR' : 'INFO'); } });
      this.log('FRP 配置校验通过，正在连接自建 VPS', 'frp'); return this.snapshot();
    });
  }
  async stopFrp() {
    if (!this.frp) { this.frpState = 'stopped'; return; }
    this.frpState = 'stopping'; await this.kill(this.frp, this.frpc); this.frpState = 'stopped';
  }
  webUrl() { const c = this.active || this.store.value; return `${c.https ? 'https' : 'http'}://localhost:${c.port}/`; }
  managementUrl() { return `${this.webUrl()}admin`; }
  async startCli() { return this.exclusive(async () => { await this.cli.start(this.store.value.cli.port); return this.snapshot(); }); }
  async cliSettingsUrl() {
    await this.startCli();
    return this.cli.url({ serverUrl: this.webUrl(), user: this.store.value.cli.user, embedded: true });
  }
  async stopCli() { return this.exclusive(async () => { await this.cli.stop(); return this.snapshot(); }); }
  saveCli(patch) { return this.save({ cli: { port: patch.port, autoStart: patch.autoStart, user: patch.user ?? this.store.value.cli.user } }); }
  async shutdown() { return this.stop(); }
}
module.exports = { Controller, available, udpAvailable, probe, FRP_VERSION };
