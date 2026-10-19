/**
 * 本地自签 SSL 证书生成（HTTPS 模式使用）。
 *
 * 单文件版已将自签能力内置到后端 exe（`zviewer-backend --gen-cert`），
 * 替代原独立的 zviewer-cert 工具（省一份内嵌 Node 运行时，约 60-100MB）。
 * 原 Let's Encrypt ACME 可信证书签发已移除：公网部署请使用
 * Cloudflare / Nginx / Caddy / 宝塔 / 1Panel 等反代签发可信证书。
 *
 * 使用 node-forge 生成自签 X.509 证书（RSA 2048，10 年有效期），
 * SAN 始终包含 localhost / 127.0.0.1 / ::1，可额外附加指定 host。
 */

import forge from 'node-forge';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { CONFIG_DIR } from '../paths';

export interface SslCertPaths {
  certPath: string;
  keyPath: string;
}

/** SAN 条目（@types/node-forge 未提供精确类型，此处本地定义） */
interface AltNameEntry {
  type: number;
  value?: string;
  ip?: string;
}

interface SubjectAltNameExtension {
  altNames?: AltNameEntry[];
}

export interface EnsureSelfSignedCertOptions {
  /** 要写入 SAN 的主机名 / IP（缺省 localhost） */
  host?: string | null;
  /** 强制重新生成（忽略已有证书检查） */
  force?: boolean;
  /** 证书输出目录，默认 <CONFIG_DIR>/ssl */
  sslDir?: string;
}

export interface EnsureSelfSignedCertResult extends SslCertPaths {
  /** 本次是否实际生成了新证书 */
  generated: boolean;
  /** 跳过生成的原因（generated=false 时有值） */
  reason?: string;
}

/** 解析证书/私钥输出路径（支持 SSL_CERT_PATH / SSL_KEY_PATH 环境变量覆盖） */
export function getSslCertPaths(sslDir = path.join(CONFIG_DIR, 'ssl')): SslCertPaths {
  return {
    certPath: process.env.SSL_CERT_PATH || path.join(sslDir, 'cert.pem'),
    keyPath: process.env.SSL_KEY_PATH || path.join(sslDir, 'key.pem'),
  };
}

/**
 * 校验并归类 host：'ip' | 'dns' | null（localhost / 未指定）。
 * 非法输入抛错。
 */
function parseHostKind(host: string | null | undefined): {
  host: string | null;
  hostKind: 'ip' | 'dns' | null;
} {
  if (!host || host.toLowerCase() === 'localhost') {
    return { host: host || null, hostKind: null };
  }
  const ipv = net.isIP(host);
  if (ipv === 4 || ipv === 6) return { host, hostKind: 'ip' };
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
    throw new Error(`非法 IPv4 地址: ${host}`);
  }
  if (host.includes(':')) {
    throw new Error(`非法 IPv6 地址: ${host}`);
  }
  if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(host)) {
    return { host, hostKind: 'dns' };
  }
  throw new Error(`无法识别的域名或 IP 地址: ${host}`);
}

/** 读取证书 SAN 列表（解析失败返回空数组） */
export function readCertSanHosts(certFile: string): string[] {
  try {
    const pem = fs.readFileSync(certFile, 'utf-8');
    const cert = forge.pki.certificateFromPem(pem);
    const ext = cert.getExtension('subjectAltName') as unknown as
      | SubjectAltNameExtension
      | undefined;
    if (!ext || !ext.altNames) return [];
    return ext.altNames.map((a) => (a.ip !== undefined ? a.ip : a.value!));
  } catch {
    return [];
  }
}

/** 证书是否未过期 */
export function isCertNotExpired(certFile: string): boolean {
  try {
    const pem = fs.readFileSync(certFile, 'utf-8');
    const cert = forge.pki.certificateFromPem(pem);
    return cert.validity.notAfter > new Date();
  } catch {
    return false;
  }
}

/** 判断已有证书是否为自签（签发者主体哈希 == 证书主体哈希） */
export function isSelfSignedCert(certFile: string): boolean {
  try {
    const pem = fs.readFileSync(certFile, 'utf-8');
    const cert = forge.pki.certificateFromPem(pem);
    return cert.issuer.hash === cert.subject.hash;
  } catch {
    return false;
  }
}

/**
 * 生成自签证书并写入指定路径（覆盖已有文件）。
 * 私钥以 0o600 权限写入。
 */
export function generateSelfSignedCert(
  certPath: string,
  keyPath: string,
  host?: string | null,
): void {
  const { hostKind } = parseHostKind(host);

  // 1. 生成 RSA 密钥对
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // 2. 创建证书
  const cert = forge.pki.createCertificate();
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

  // 扩展: SubjectAltName（始终包含本机地址；host 与之重复时不重复添加）
  const baseHosts = ['localhost', '127.0.0.1', '::1'];
  const altNames: AltNameEntry[] = [];
  if (host && hostKind && !baseHosts.includes(host.toLowerCase())) {
    if (hostKind === 'ip') {
      altNames.push({ type: 7, ip: host });
    } else {
      altNames.push({ type: 2, value: host });
    }
  }
  altNames.push({ type: 2, value: 'localhost' });
  altNames.push({ type: 7, ip: '127.0.0.1' });
  altNames.push({ type: 7, ip: '::1' });

  cert.setExtensions([{ name: 'subjectAltName', altNames }]);

  // 3. 自签并导出 PEM
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

  fs.mkdirSync(path.dirname(certPath), { recursive: true });
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(certPath, certPem, 'utf-8');
  fs.writeFileSync(keyPath, keyPem, { mode: 0o600, encoding: 'utf-8' });

  const sanText = altNames
    .map((a) => (a.value !== undefined ? `DNS:${a.value}` : `IP:${a.ip}`))
    .join(', ');
  console.log(`  证书主体: CN=${cn}`);
  console.log(`  证书 SAN : ${sanText}`);
  console.log(`  证书已生成: ${certPath}`);
  console.log(`  私钥已生成: ${keyPath}`);
}

/**
 * 确保存在可用的自签证书：
 * - 已有证书且覆盖 host 且未过期 → 跳过（除非 force）
 * - 否则生成新证书
 */
export function ensureSelfSignedCert(
  options: EnsureSelfSignedCertOptions = {},
): EnsureSelfSignedCertResult {
  const { host = null, force = false } = options;
  const { certPath, keyPath } = options.sslDir
    ? {
        certPath: process.env.SSL_CERT_PATH || path.join(options.sslDir, 'cert.pem'),
        keyPath: process.env.SSL_KEY_PATH || path.join(options.sslDir, 'key.pem'),
      }
    : getSslCertPaths();

  if (!force && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const existingHosts = readCertSanHosts(certPath).map((h) => h.toLowerCase());
    const hostExists = host
      ? existingHosts.includes(host.toLowerCase())
      : existingHosts.includes('localhost');
    if (hostExists && isCertNotExpired(certPath)) {
      return {
        certPath,
        keyPath,
        generated: false,
        reason: `证书已存在（已包含 ${host || 'localhost'}），如需重新生成请加 --force`,
      };
    }
  }

  generateSelfSignedCert(certPath, keyPath, host);
  return { certPath, keyPath, generated: true };
}
