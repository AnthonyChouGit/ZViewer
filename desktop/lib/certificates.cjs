require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const run = promisify(execFile);
const { atomic, hostname } = require('./config.cjs');
const alg = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const privatePem = data => `-----BEGIN PRIVATE KEY-----\n${Buffer.from(data).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;

class Certificates {
  constructor(dir, log) { this.dir = path.join(dir, 'tls'); this.log = log; }
  paths() { return { cert: path.join(this.dir, 'cert.pem'), key: path.join(this.dir, 'key.pem'), ca: path.join(this.dir, 'root-ca.pem'), caKey: path.join(this.dir, 'root-ca.key') }; }
  inspect() {
    try {
      const p = this.paths(), c = new crypto.X509Certificate(fs.readFileSync(p.cert)), root = new crypto.X509Certificate(fs.readFileSync(p.ca));
      return { exists: true, valid: c.validFromDate <= new Date() && c.validToDate > new Date(Date.now() + 86400000) && c.verify(root.publicKey) && c.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(p.key))), subject: c.subject, san: c.subjectAltName, validTo: c.validTo, fingerprint: root.fingerprint256, thumbprint: root.fingerprint.replaceAll(':', ''), ca: root.ca };
    } catch { return { exists: false, valid: false }; }
  }
  async protect() {
    if (process.platform !== 'win32') return;
    const { stdout } = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true });
    const sid = stdout.match(/S-1-5-[\d-]+/)?.[0];
    if (!sid) throw new Error('无法确认当前 Windows 用户，停止保存私钥');
    await run('icacls.exe', [this.dir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { windowsHide: true });
  }
  async ensure(domain = 'localhost', ip = '') {
    if (!hostname(domain) || net.isIP(domain) || (ip && !net.isIP(ip))) throw new Error('证书域名或 IP 无效');
    const p = this.paths(), info = this.inspect();
    if (info.valid) {
      const cert = new crypto.X509Certificate(fs.readFileSync(p.cert));
      if (cert.checkHost(domain) && (!ip || cert.checkIP(ip))) return info;
    }
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    await this.protect();
    const x509 = await import('@peculiar/x509');
    x509.cryptoProvider.set(crypto.webcrypto);
    const before = new Date(Date.now() - 300000);
    let root, rootKey;
    if (fs.existsSync(p.ca) || fs.existsSync(p.caKey)) {
      if (!fs.existsSync(p.ca) || !fs.existsSync(p.caKey)) throw new Error('本地 CA 文件不完整，请恢复备份；不会自动替换已信任的 CA');
      root = new x509.X509Certificate(fs.readFileSync(p.ca, 'utf8'));
      const nativeRoot = new crypto.X509Certificate(fs.readFileSync(p.ca));
      if (!nativeRoot.ca || nativeRoot.validToDate < new Date(Date.now() + 86400000 * 400) || !nativeRoot.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(p.caKey)))) throw new Error('本地 CA 无效或临近过期，需要手动轮换');
      rootKey = await crypto.webcrypto.subtle.importKey('pkcs8', crypto.createPrivateKey(fs.readFileSync(p.caKey)).export({ format: 'der', type: 'pkcs8' }), alg, false, ['sign']);
    } else {
      const keys = await crypto.webcrypto.subtle.generateKey(alg, true, ['sign', 'verify']);
      root = await x509.X509CertificateGenerator.createSelfSigned({ name: `CN=ZViewer Local CA ${crypto.randomBytes(5).toString('hex')}, O=ZViewer Desktop`, keys, notBefore: before, notAfter: new Date(Date.now() + 86400000 * 3650), extensions: [new x509.BasicConstraintsExtension(true, 0, true), new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true), await x509.SubjectKeyIdentifierExtension.create(keys.publicKey)] });
      rootKey = keys.privateKey;
      atomic(p.caKey, privatePem(await crypto.webcrypto.subtle.exportKey('pkcs8', keys.privateKey)));
      atomic(p.ca, root.toString('pem'));
      this.log('已创建本机专用 CA，尚未安装系统信任', 'cert');
    }
    const keys = await crypto.webcrypto.subtle.generateKey(alg, true, ['sign', 'verify']);
    const names = [{ type: 'dns', value: 'localhost' }, { type: 'ip', value: '127.0.0.1' }, { type: 'ip', value: '::1' }];
    if (domain !== 'localhost') names.push({ type: 'dns', value: domain });
    if (ip && !['127.0.0.1', '::1'].includes(ip)) names.push({ type: 'ip', value: ip });
    const cert = await x509.X509CertificateGenerator.create({ subject: `CN=${domain}, O=ZViewer Desktop`, issuer: root.subject, publicKey: keys.publicKey, signingKey: rootKey, notBefore: before, notAfter: new Date(Date.now() + 86400000 * 365), extensions: [new x509.BasicConstraintsExtension(false, undefined, true), new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true), new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1']), new x509.SubjectAlternativeNameExtension(names), await x509.AuthorityKeyIdentifierExtension.create(root.publicKey)] });
    const pem = cert.toString('pem'), key = privatePem(await crypto.webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
    const check = new crypto.X509Certificate(pem);
    if (!check.checkPrivateKey(crypto.createPrivateKey(key)) || !check.verify(new crypto.X509Certificate(root.toString('pem')).publicKey)) throw new Error('证书与私钥校验失败');
    if (fs.existsSync(p.cert) && fs.existsSync(p.key)) {
      const backup = path.join(this.dir, 'backups', String(Date.now())); fs.mkdirSync(backup, { recursive: true });
      fs.copyFileSync(p.cert, path.join(backup, 'cert.pem')); fs.copyFileSync(p.key, path.join(backup, 'key.pem'));
    }
    atomic(p.key, key); atomic(p.cert, pem);
    this.log(`已签发 ${domain} 的本地 HTTPS 证书，有效期 365 天`, 'cert');
    return this.inspect();
  }
  async trust(installed) {
    const info = this.inspect(); if (!info.valid || !info.ca) throw new Error('请先签发有效本地证书');
    if (installed) await run('certutil.exe', ['-user', '-addstore', 'Root', this.paths().ca], { windowsHide: true });
    else await run('certutil.exe', ['-user', '-delstore', 'Root', info.thumbprint], { windowsHide: true });
    this.log(installed ? '已安装当前用户的本机 CA 信任' : '已撤销当前用户的本机 CA 信任', 'cert');
    return { trusted: installed, fingerprint: info.fingerprint };
  }
}
module.exports = { Certificates };
