const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { StringDecoder } = require('node:string_decoder');
const run = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function validPort(value) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('CLI 端口必须是 1–65535 的整数');
  return value;
}
function localHealth(port) {
  return new Promise(resolve => {
    const request = http.get({host:'127.0.0.1',port,path:'/health',timeout:1000}, response => {
      let body = '';
      response.on('data', data => { body += data; if (body.length > 4096) request.destroy(); });
      response.on('error', () => resolve(null));
      response.on('end', () => {
        try {
          const value = JSON.parse(body);
          resolve(response.statusCode === 200 && value.ok === true && value.agent === 'zcontrol-cli' ? {version:String(value.version || '').slice(0,32)} : null);
        } catch { resolve(null); }
      });
    });
    request.on('error', () => resolve(null));
    request.on('timeout', () => { request.destroy(); resolve(null); });
  });
}
async function available(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`CLI 端口 ${port} 已被占用；请修改端口或关闭已有 CLI`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

// The upstream setup page alone handles Cookie/QR login. Never read /api/config:
// that response contains the user's raw Bilibili Cookie.
class CliProxy {
  constructor({root, executable, hostExe, kill, log = () => {}, onUpdate = () => {}, childEnv} = {}) {
    this.root = path.resolve(root || '.');
    this.executable = executable || path.join(this.root, 'zviewer-cli-windows-amd64.exe');
    this.hostExe = hostExe; this.kill = kill; this.log = log; this.onUpdate = onUpdate; this.childEnv = childEnv;
    this.child = null; this.state = 'stopped'; this.activePort = null; this.version = ''; this.connected = false;
    this.stopPromise = null; this.lastErrorLog = 0;
    this.windowsHelper = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'windows-process.ps1');
  }
  snapshot() {
    return {state:this.state,pid:this.child?.pid || null,activePort:this.activePort,available:fs.existsSync(this.executable),version:this.version,connected:this.connected};
  }
  update() { this.onUpdate(this.snapshot()); }
  url({serverUrl, user, embedded = false} = {}) {
    if (!this.activePort || this.state !== 'running') throw new Error('请先启动 CLI 高画质代理');
    const address = new URL(`http://127.0.0.1:${this.activePort}/`);
    if (serverUrl) {
      const server = new URL(serverUrl);
      if (!['http:','https:'].includes(server.protocol) || server.username || server.password) throw new Error('CLI 后端地址必须是 HTTP 或 HTTPS 地址');
      address.searchParams.set('server', server.href);
    }
    if (typeof user === 'string' && user.trim()) address.searchParams.set('user', user.trim().slice(0,120));
    if (embedded) address.searchParams.set('desktop','1');
    return address.href;
  }
  allowsFrame(value) {
    if (this.state !== 'running' || !this.activePort) return false;
    try {
      const address = new URL(value);
      return address.protocol === 'http:' && address.hostname === '127.0.0.1' &&
        Number(address.port || 80) === this.activePort && address.pathname === '/' && !address.username && !address.password;
    } catch { return false; }
  }
  readOutput(child) {
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new StringDecoder('utf8'); let pending = '';
      stream.on('data', data => {
        pending += decoder.write(data);
        const lines = pending.split(/\r?\n/); pending = lines.pop().slice(-4000);
        for (const line of lines) {
          // Upstream logs can contain playback URLs, comments and remote errors.
          // Record only fixed status messages so account credentials never enter GUI logs.
          if (line === '[ZViewer CLI] [CLI] 已注册到服务器（全局，所有房间可用）') {
            this.connected = true; this.log('CLI 已注册到服务器，所有房间可用', 'cli'); this.update();
          } else if (line === '[ZViewer CLI] 已断开服务器连接' || line.startsWith('[ZViewer CLI] Socket 断开:')) {
            this.connected = false; this.log('CLI 与服务器的连接已断开', 'cli'); this.update();
          } else if (/失败|异常/.test(line) && Date.now() - this.lastErrorLog > 10000) {
            this.lastErrorLog = Date.now(); this.log('CLI 报告连接或解析错误，可打开代理设置查看状态', 'cli', 'WARN');
          }
        }
      });
    }
  }
  async start(port = 9333) {
    validPort(port);
    if (this.stopPromise) await this.stopPromise;
    if (this.child) return this.snapshot();
    if (!fs.existsSync(this.executable)) throw new Error('缺少 zviewer-cli-windows-amd64.exe，请重新构建或安装完整运行包');
    if (process.platform === 'win32' && !fs.existsSync(this.hostExe || '')) throw new Error('缺少 CLI 进程监管组件');
    await available(port);
    this.state = 'starting'; this.activePort = port; this.connected = false; this.update();
    const args = ['-port',String(port),'-no-open=true'];
    const supervised = process.platform === 'win32';
    const child = spawn(supervised ? this.hostExe : this.executable, supervised ? [this.executable,...args] : args, {
      cwd:path.dirname(this.executable),env:{...process.env,...this.childEnv},windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']
    });
    this.child = child; this.readOutput(child);
    child.once('error', () => { if (this.child === child) { this.state = 'error'; this.update(); } });
    child.once('exit', (code, signal) => {
      if (this.child !== child) return;
      const intentional = this.state === 'stopping';
      this.child = null; this.activePort = null; this.connected = false; this.state = intentional ? 'stopped' : 'error';
      this.log(`CLI 进程已退出（${code ?? signal}）`, 'cli', intentional ? 'INFO' : 'WARN'); this.update();
    });
    try {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && this.child === child && child.exitCode === null && this.state === 'starting') {
        const health = await localHealth(port);
        if (health) {
          if (supervised) {
            const {stdout} = await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',this.windowsHelper,'-Action','inspect','-ProcessId',String(child.pid),'-Port',String(port),'-ExpectedPath',this.hostExe],{windowsHide:true});
            const inspected = JSON.parse(stdout);
            if (!inspected.owner.some(pid => inspected.members.includes(pid))) throw new Error('CLI 监听端口不属于 GUI 启动的进程树');
          }
          this.version = health.version; this.state = 'running'; this.log(`CLI 高画质代理已就绪：http://127.0.0.1:${port}`, 'cli'); this.update();
          return this.snapshot();
        }
        await delay(200);
      }
      throw new Error('CLI 未能启动，请检查端口或重新安装完整运行包');
    } catch (error) {
      await this.stop().catch(() => {}); this.state = 'error'; this.update(); throw error;
    }
  }
  async stop() {
    if (this.stopPromise) return this.stopPromise;
    if (!this.child) { this.state = 'stopped'; this.activePort = null; this.connected = false; this.update(); return this.snapshot(); }
    const child = this.child; this.state = 'stopping'; this.update();
    this.stopPromise = (async () => {
      if (this.kill) await this.kill(child, process.platform === 'win32' ? this.hostExe : this.executable);
      else {
        if (process.platform === 'win32') throw new Error('缺少 CLI 进程停止处理');
        child.kill('SIGTERM');
        for (let i = 0; i < 50 && child.exitCode === null; i++) await delay(100);
        if (child.exitCode === null) throw new Error('CLI 停止超时');
      }
      if (this.child === child) this.child = null;
      this.state = 'stopped'; this.activePort = null; this.connected = false; this.update(); return this.snapshot();
    })();
    try { return await this.stopPromise; } finally { this.stopPromise = null; }
  }
}
module.exports = {CliProxy};
