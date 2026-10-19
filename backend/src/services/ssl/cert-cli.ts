/**
 * `--gen-cert` CLI 编排：本地自签 / ACME 可信 CA 双模式。
 *
 * 签发方式自动选择（与原独立 zviewer-cert 工具行为一致）：
 * - 域名（含点）或公网 IP → Let's Encrypt 可信证书（ACME HTTP-01，需 80 端口公网可达）
 * - localhost / 内网 IP / 单标签主机名 → 本地自签证书
 *
 * 用法：zviewer-backend --gen-cert [host] [选项]
 *   host            域名、公网 IP 或 localhost（缺省 localhost）
 *   --force/-f      强制重新生成，不检查已有证书
 *   --selfsigned    强制自签（即使指定的是域名或公网 IP）
 *   --staging       使用 Let's Encrypt 测试环境（staging，无速率限制）
 *   --email <邮箱>  ACME 账号邮箱（可选）
 *   --directory <url> 自定义 ACME 目录 URL（高级选项）
 */

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { requestCertificate } from './acme-client';
import {
  ensureSelfSignedCert,
  getSslCertPaths,
  isCertNotExpired,
  isSelfSignedCert,
  readCertSanHosts,
} from './self-signed-cert';

const DIRECTORY_LETSENCRYPT = 'https://acme-v02.api.letsencrypt.org/directory';
const DIRECTORY_STAGING = 'https://acme-staging-v02.api.letsencrypt.org/directory';

const KNOWN_FLAGS = new Set([
  '--gen-cert',
  '--force',
  '-f',
  '--selfsigned',
  '--staging',
  '--email',
  '--directory',
]);

/**
 * 判断 IP 地址是否为公网地址（非私有/环回/链路本地）。
 * Let's Encrypt 自 2025 年起支持为公网 IP 签发可信证书。
 */
function isPublicIP(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const parts = ip.split('.').map(Number);
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8,
    // 169.254.0.0/16, 0.0.0.0/8, 100.64.0.0/10 (CGNAT)
    if (parts[0] === 10) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    if (parts[0] === 127) return false;
    if (parts[0] === 169 && parts[1] === 254) return false;
    if (parts[0] === 0) return false;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return false;
    return true;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    // ::1/128 (loopback), fc00::/7 (unique local), fe80::/10 (link-local)
    if (lower === '::1') return false;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return false;
    if (lower.startsWith('fe8') || lower.startsWith('fe9') ||
        lower.startsWith('fea') || lower.startsWith('feb')) return false;
    return true;
  }
  return false;
}

/** 校验并归类 host：'ip' | 'dns' | null（localhost / 未指定），非法输入抛错 */
function parseHostKind(host: string | null): { host: string | null; hostKind: 'ip' | 'dns' | null } {
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

interface GenCertArgs {
  host: string | null;
  force: boolean;
  selfsigned: boolean;
  staging: boolean;
  email: string | null;
  directoryOverride: string | null;
}

/** 解析 --gen-cert 之后的参数 */
function parseGenCertArgs(args: string[]): GenCertArgs {
  const genIdx = args.indexOf('--gen-cert');
  const rest = args.slice(genIdx + 1);

  const readValueArg = (name: string): string | null => {
    const idx = rest.indexOf(name);
    if (idx >= 0) {
      if (rest[idx + 1] !== undefined && !rest[idx + 1].startsWith('-')) return rest[idx + 1];
      throw new Error(`参数 ${name} 缺少值`);
    }
    for (const a of rest) {
      if (a.startsWith(`${name}=`)) return a.slice(name.length + 1);
    }
    return null;
  };

  let host: string | null = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (KNOWN_FLAGS.has(a)) {
      if (a === '--email' || a === '--directory') i++; // 跳过其值
      continue;
    }
    if (a.startsWith('--') && a.includes('=')) continue; // --key=value 形式
    if (a.startsWith('-')) {
      throw new Error(`无法识别的参数: ${a}（用法见 zviewer-backend --gen-cert --help）`);
    }
    if (host === null) {
      host = a;
    } else {
      throw new Error(`参数过多: ${a}`);
    }
  }

  return {
    host,
    force: rest.includes('--force') || rest.includes('-f'),
    selfsigned: rest.includes('--selfsigned'),
    staging: rest.includes('--staging'),
    email: readValueArg('--email'),
    directoryOverride: readValueArg('--directory'),
  };
}

/** 打印 --gen-cert 用法 */
export function printGenCertUsage(): void {
  console.log('用法: zviewer-backend --gen-cert [host] [选项]');
  console.log('  host            域名、公网 IP 或 localhost（缺省 localhost）');
  console.log('                  域名和公网 IP 默认通过 Let\'s Encrypt 申请可信 CA 证书；');
  console.log('                  localhost / 内网 IP 使用自签证书');
  console.log('  --force/-f      强制重新生成，不检查已有证书');
  console.log('  --selfsigned    强制自签（即使指定的是域名或公网 IP）');
  console.log('  --staging       使用 Let\'s Encrypt 测试环境（staging，无速率限制）');
  console.log('  --email <邮箱>  ACME 账号邮箱（可选）');
  console.log('  --directory <url> 自定义 ACME 目录 URL（高级选项）');
}

/** ACME 可信 CA 签发路径 */
async function issueCaCert(
  host: string,
  hostKind: 'ip' | 'dns',
  opts: GenCertArgs,
): Promise<void> {
  const idLabel = hostKind === 'ip' ? 'IP 地址' : '域名';
  const directoryUrl =
    opts.directoryOverride || (opts.staging ? DIRECTORY_STAGING : DIRECTORY_LETSENCRYPT);
  const envName = opts.staging ? "Let's Encrypt 测试环境(staging)" : "Let's Encrypt";
  const { certPath, keyPath } = getSslCertPaths();
  const accountKeyFile = path.join(path.dirname(certPath), 'acme-account.key');

  // CA 模式：已有证书是 CA 签发的、含该主机且未过期 → 跳过申请
  if (!opts.force && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const existingHosts = readCertSanHosts(certPath).map((h) => h.toLowerCase());
    const hostExists = existingHosts.includes(host.toLowerCase());
    const notExpired = isCertNotExpired(certPath);
    const selfSigned = isSelfSignedCert(certPath);
    if (hostExists && notExpired && !selfSigned) {
      console.log(`  可信证书已存在（已包含 ${host}），跳过申请（如需重新申请请加 --force）`);
      return;
    }
    if (hostExists && notExpired && selfSigned) {
      console.log("  现有证书为自签证书，将重新申请 Let's Encrypt 可信证书...");
    } else if (hostExists && !notExpired) {
      console.log('  现有证书已过期，自动重新申请...');
    } else if (hostExists) {
      console.log(`  现有证书未包含 ${host}，自动重新申请...`);
    }
  }

  console.log(`  通过 ${envName} 申请可信 CA 证书（${idLabel}: ${host}）...`);
  console.log('  提示: 需满足以下条件才能成功：');
  console.log(`        1) ${idLabel}已指向本机且公网可达`);
  console.log('        2) 80 端口空闲且防火墙/安全组已放行（HTTP-01 验证）');

  // 账号密钥 / 证书输出目录可能不存在（首次签发），先建目录
  fs.mkdirSync(path.dirname(certPath), { recursive: true });

  const { fullchainPem, keyPem } = await requestCertificate({
    domain: host,
    directoryUrl,
    accountKeyFile,
    email: opts.email || undefined,
    identifierType: hostKind === 'ip' ? 'ip' : 'dns',
    challengePort: Number(process.env.ZVIEWER_CERT_CHALLENGE_PORT) || 80,
    log: (msg) => console.log(msg),
  });

  fs.mkdirSync(path.dirname(certPath), { recursive: true });
  fs.writeFileSync(certPath, fullchainPem, 'utf-8');
  fs.writeFileSync(keyPath, keyPem, { mode: 0o600, encoding: 'utf-8' });

  console.log(`  可信证书已生成: ${certPath}（完整证书链）`);
  console.log(`  私钥已生成: ${keyPath}`);
  if (hostKind === 'ip') {
    console.log('  公网 IP 证书有效期约 6 天，到期后请重新签发');
  } else {
    console.log('  证书有效期约 90 天，到期前请重新运行本命令续期');
  }
}

/**
 * 执行 --gen-cert 命令（成功返回后由调用方 process.exit(0)，抛错则 exit(1)）。
 */
export async function runGenCertCli(args: string[]): Promise<void> {
  const opts = parseGenCertArgs(args);
  const { host, hostKind } = parseHostKind(opts.host);

  // 该次签发是否走 ACME 可信 CA（与原 zviewer-cert 行为一致）：
  // - 域名（含点）→ Let's Encrypt
  // - 公网 IP → Let's Encrypt（2025 年起支持）
  // - localhost / 内网 IP / 单标签主机名 → 自签
  const useAcme =
    host !== null && !opts.selfsigned &&
    ((hostKind === 'dns' && host.includes('.')) ||
     (hostKind === 'ip' && isPublicIP(host)));

  if (useAcme && host && hostKind) {
    await issueCaCert(host, hostKind, opts);
    return;
  }

  // 自签模式（localhost / 内网 IP / 单标签主机名 / --selfsigned）
  const result = ensureSelfSignedCert({ host, force: opts.force });
  if (!result.generated) {
    console.log(`  ${result.reason}`);
  }
}
