/**
 * SSL 证书生成脚本（本地自签）。
 *
 * 使用 node-forge 生成自签 X.509 证书，仅依赖 JavaScript，
 * 无需 openssl 或任何系统工具。
 * （原 Let's Encrypt ACME 可信证书签发已移除：公网部署请使用
 *   Cloudflare / Nginx / Caddy / 宝塔 / 1Panel 等反代签发可信证书。）
 *
 * 单文件版已将自签能力内置到后端（zviewer-backend --gen-cert），
 * 本脚本仅供源码开发环境使用。
 *
 * 输出：
 *   config/ssl/cert.pem  - 证书文件
 *   config/ssl/key.pem   - 私钥文件
 *
 * 用法：node scripts/generate-cert.js [host] [选项]
 *   host       域名、IP 或 localhost（缺省 localhost），
 *              会一并写入证书 SAN（localhost / 127.0.0.1 / ::1 始终包含）
 *   --force    强制重新生成，不检查证书是否已存在
 *
 * 示例：
 *   node scripts/generate-cert.js                     # localhost 自签
 *   node scripts/generate-cert.js 192.168.1.1         # 指定 IP 自签
 *   node scripts/generate-cert.js example.com --force # 指定域名强制重签
 */

const forge = require('node-forge');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const SSL_DIR = path.resolve(__dirname, '..', 'config', 'ssl');
const CERT_FILE = path.join(SSL_DIR, 'cert.pem');
const KEY_FILE = path.join(SSL_DIR, 'key.pem');

const args = process.argv.slice(2);

// ==================== 参数解析 ====================
function printUsage() {
  console.log('用法: node scripts/generate-cert.js [host] [选项]');
  console.log('  host     域名、IP 或 localhost（缺省 localhost），写入证书 SAN');
  console.log('  --force  强制重新生成，不检查证书是否已存在');
  console.log('示例:');
  console.log('  node scripts/generate-cert.js                     # localhost 自签证书');
  console.log('  node scripts/generate-cert.js 192.168.1.1         # 指定 IP 自签证书');
  console.log('  node scripts/generate-cert.js example.com --force # 指定域名强制重签');
}

if (args.includes('--help') || args.includes('-h')) {
  printUsage();
  process.exit(0);
}

const force = args.includes('--force') || args.includes('-f');

// 提取 host：第一个非 -- 开头的参数
const knownFlags = new Set(['--force', '-f', '--help', '-h']);
let host = null;
for (const a of args) {
  if (knownFlags.has(a)) continue;
  if (a.startsWith('--') && a.includes('=')) continue; // --key=value 形式
  if (a.startsWith('-')) {
    console.error(`  [错误] 无法识别的参数: ${a}`);
    console.error('');
    printUsage();
    process.exit(1);
  }
  if (host === null) {
    host = a;
  } else {
    console.error(`  [错误] 参数过多: ${a}`);
    process.exit(1);
  }
}

// 判断 host 是 IP 还是域名（net.isIP 严格校验 IPv4/IPv6）
let hostKind = null; // 'ip' | 'dns'
if (host && host.toLowerCase() !== 'localhost') {
  const ipv = net.isIP(host);
  if (ipv === 4 || ipv === 6) {
    hostKind = 'ip';
  } else if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    console.error(`  [错误] 非法 IPv4 地址: ${host}`);
    process.exit(1);
  } else if (host.includes(':')) {
    console.error(`  [错误] 非法 IPv6 地址: ${host}`);
    process.exit(1);
  } else if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(host)) {
    hostKind = 'dns';
  } else {
    console.error(`  [错误] 无法识别的域名或 IP 地址: ${host}`);
    console.error('        请输入合法域名（如 example.com）或 IP 地址（如 192.168.1.1）');
    process.exit(1);
  }
}

// ==================== 证书读取工具 ====================
function readCertSanHosts(certFile) {
  try {
    const pem = fs.readFileSync(certFile, 'utf-8');
    const cert = forge.pki.certificateFromPem(pem);
    const ext = cert.getExtension('subjectAltName');
    if (!ext || !ext.altNames) return [];
    return ext.altNames.map((a) => (a.ip !== undefined ? a.ip : a.value));
  } catch {
    return [];
  }
}

// 证书是否未过期
function isCertNotExpired(certFile) {
  try {
    const pem = fs.readFileSync(certFile, 'utf-8');
    const cert = forge.pki.certificateFromPem(pem);
    return cert.validity.notAfter > new Date();
  } catch {
    return false;
  }
}

// ==================== 检查是否已有证书 ====================
if (!force && fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
  const existingHosts = readCertSanHosts(CERT_FILE).map((h) => h.toLowerCase());
  const hostExists = host
    ? existingHosts.includes(host.toLowerCase())
    : existingHosts.includes('localhost');

  const displayHost = host || 'localhost';
  if (hostExists && isCertNotExpired(CERT_FILE)) {
    console.log(`  SSL 证书已存在（已包含 ${displayHost}），跳过生成（如需重新生成请加 --force）`);
    process.exit(0);
  }
  if (hostExists && !isCertNotExpired(CERT_FILE)) {
    console.log('  现有证书已过期，自动重新生成...');
  }
}

// 确保目录存在
fs.mkdirSync(SSL_DIR, { recursive: true });

// ==================== 自签证书 ====================
console.log(`  生成 SSL 证书（类型: ${host || 'localhost'}，自签）...`);
console.log('  生成 RSA 2048 密钥对...');

// 1. 生成 RSA 密钥对
const keys = forge.pki.rsa.generateKeyPair(2048);

// 2. 创建证书
const cert = forge.pki.createCertificate();

// 3. 设置证书属性
cert.publicKey = keys.publicKey;
cert.serialNumber = forge.util.bytesToHex(forge.random.getBytesSync(8));

// 有效期：从前一天开始，10 年后结束
const notBefore = new Date();
notBefore.setDate(notBefore.getDate() - 1);
const notAfter = new Date();
notAfter.setFullYear(notAfter.getFullYear() + 10);
cert.validity.notBefore = notBefore;
cert.validity.notAfter = notAfter;

// 主体 CN：指定了 host 则用 host，否则 localhost
const cn = host && hostKind ? host : 'localhost';

// 颁发者 / 主体（自签证书二者一致）
cert.setSubject([
  { name: 'countryName', value: 'CN' },
  { name: 'organizationName', value: 'ZViewer' },
  { name: 'commonName', value: cn },
]);
cert.setIssuer([
  { name: 'countryName', value: 'CN' },
  { name: 'organizationName', value: 'ZViewer' },
  { name: 'commonName', value: cn },
]);

// 扩展: SubjectAltName（始终包含本机地址，便于本机调试；host 与之重复时不重复添加）
const baseHosts = ['localhost', '127.0.0.1', '::1'];
const altNames = [];
if (host && hostKind && !baseHosts.includes(host.toLowerCase())) {
  if (hostKind === 'ip') {
    altNames.push({ type: 7, ip: host });         // 指定 IP
  } else {
    altNames.push({ type: 2, value: host });      // 指定域名
  }
}
altNames.push({ type: 2, value: 'localhost' });   // DNS
altNames.push({ type: 7, ip: '127.0.0.1' });      // IPv4
altNames.push({ type: 7, ip: '::1' });            // IPv6

cert.setExtensions([
  {
    name: 'subjectAltName',
    altNames,
  },
]);

// 4. 自签
console.log('  签名证书...');
cert.sign(keys.privateKey, forge.md.sha256.create());

// 5. 导出 PEM
const certPem = forge.pki.certificateToPem(cert);
const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

// 6. 写入文件（私钥仅当前用户可读写）
fs.writeFileSync(CERT_FILE, certPem, 'utf-8');
fs.writeFileSync(KEY_FILE, keyPem, { mode: 0o600, encoding: 'utf-8' });

const sanText = altNames
  .map((a) => (a.value !== undefined ? `DNS:${a.value}` : `IP:${a.ip}`))
  .join(', ');

console.log(`  证书主体: CN=${cn}`);
console.log(`  证书 SAN : ${sanText}`);
console.log(`  证书已生成: ${CERT_FILE}`);
console.log(`  私钥已生成: ${KEY_FILE}`);
