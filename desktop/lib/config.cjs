const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');

const defaults = {
  port: 3333, rtmpPort: 3334, flvPort: 3335, livekitPort: 3336, livekitTcpPort: 3337, bindHost: '127.0.0.1', https: false,
  closeToTray: true, launchAtLogin: false, autoStart: false,
  domain: 'localhost', lanIp: '',
  frp: { host: '', port: 7000, advertiseIp: '', voice: true, rtmp: true, tcp: false, webPort: 3333, voicePort: 3333, rtmpPort: 3334, tcpPort: 3337 }
};
function port(value) { return /^\d+$/.test(String(value)) && Number(value) > 0 && Number(value) <= 65535; }
function hostname(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 253 &&
    (net.isIP(value) || (!/^[\d.]+$/.test(value) && value.split('.').every(p => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(p))));
}
function validate(input) {
  const c = { ...defaults, ...input, frp: { ...defaults.frp, ...input.frp } };
  for (const k of ['port', 'rtmpPort', 'flvPort', 'livekitPort', 'livekitTcpPort']) {
    if (!port(c[k])) throw new Error(`${k} 需要填写 1–65535 的整数`);
    c[k] = Number(c[k]);
  }
  if (new Set([c.port, c.rtmpPort, c.flvPort, c.livekitPort, c.livekitTcpPort]).size !== 5) throw new Error('网页、RTMP、FLV、LiveKit 信令和语音 TCP 端口不能重复');
  // UDP and TCP may share the same number; media UDP always follows the web port.
  if (input.frp?.voicePort === undefined) c.frp.voicePort = c.port;
  if (input.frp?.webPort === undefined) c.frp.webPort = c.port;
  if (input.frp?.tcpPort === undefined) c.frp.tcpPort = c.livekitTcpPort;
  if (!['127.0.0.1', '0.0.0.0', '::'].includes(c.bindHost)) throw new Error('监听地址无效');
  for (const k of ['https', 'closeToTray', 'launchAtLogin', 'autoStart']) c[k] = c[k] === true;
  if (!hostname(c.domain) || net.isIP(c.domain)) throw new Error('证书域名无效');
  if (c.lanIp && !net.isIP(c.lanIp)) throw new Error('内网 IP 无效');
  c.domain = c.domain.toLowerCase();
  c.frp = Object.fromEntries(Object.keys(defaults.frp).map(k => [k, c.frp[k]]));
  if (c.frp.host && !hostname(c.frp.host)) throw new Error('VPS 地址应为 IP 或域名，不包含协议、端口或路径');
  if (c.frp.advertiseIp && net.isIP(c.frp.advertiseIp) !== 4) throw new Error('语音公布地址需要填写 VPS 的 IPv4 地址');
  for (const k of ['port', 'webPort', 'voicePort', 'rtmpPort', 'tcpPort']) {
    if (!port(c.frp[k])) throw new Error(`FRP ${k} 端口无效`);
    c.frp[k] = Number(c.frp[k]);
  }
  for (const k of ['voice', 'rtmp', 'tcp']) c.frp[k] = c.frp[k] === true;
  if (c.frp.advertiseIp && c.frp.voice && c.frp.voicePort !== c.port) throw new Error(`使用 VPS 公布语音地址时，远端 UDP 端口需与本地语音端口 ${c.port} 一致`);
  if (c.frp.advertiseIp && c.frp.tcp && c.frp.tcpPort !== c.livekitTcpPort) throw new Error(`使用 VPS 公布语音地址时，远端 TCP 语音端口需与本地语音端口 ${c.livekitTcpPort} 一致`);
  const tcpPorts = [c.frp.webPort, ...(c.frp.rtmp ? [c.frp.rtmpPort] : []), ...(c.frp.tcp ? [c.frp.tcpPort] : [])];
  if (new Set(tcpPorts).size !== tcpPorts.length) throw new Error('FRP 同一协议的远端端口不能重复');
  return Object.fromEntries(Object.keys(defaults).map(k => [k, c[k]]));
}
function atomic(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  try { fs.writeFileSync(temp, contents, { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function envValues(root) {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).flatMap(line => {
    const m = line.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/);
    if (!m) return [];
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    return [[m[1], value]];
  }));
}
class ConfigStore {
  constructor(dir, root, cipher) {
    this.file = path.join(dir, 'settings.json'); this.cipher = cipher; this.secret = '';
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const config = saved.config || {};
      if ((saved.schema || 1) < 2 && config.port && config.frp?.voicePort === 3333) config.frp.voicePort = Number(config.port);
      this.value = validate(config); this.secret = saved.frpToken || '';
    } else {
      const env = envValues(root);
      this.value = validate({ port: env.PORT || 3333, rtmpPort: env.RTMP_PORT || 3334, flvPort: env.HTTP_FLV_PORT || 3335, bindHost: ['127.0.0.1', '0.0.0.0', '::'].includes(env.HOST) ? env.HOST : '127.0.0.1', https: env.HTTPS === 'true' });
    }
  }
  save(patch, token) {
    const frp = { ...this.value.frp, ...patch.frp };
    for (const [local, remote] of [['port','voicePort'], ['port','webPort'], ['livekitTcpPort','tcpPort']]) {
      if (patch[local] !== undefined && patch.frp?.[remote] === undefined && frp[remote] === this.value[local]) frp[remote] = Number(patch[local]);
    }
    const value = validate({ ...this.value, ...patch, frp });
    let secret = this.secret;
    if (token !== undefined && token !== '') {
      if (typeof token !== 'string' || token.length > 4096 || /[\r\n\0]/.test(token)) throw new Error('Token 格式无效');
      secret = this.cipher.encrypt(token);
    }
    atomic(this.file, JSON.stringify({ schema: 2, config: value, frpToken: secret }, null, 2));
    this.value = value; this.secret = secret;
    return value;
  }
  token() { return this.secret ? this.cipher.decrypt(this.secret) : ''; }
}
module.exports = { defaults, validate, port, hostname, atomic, envValues, ConfigStore };
