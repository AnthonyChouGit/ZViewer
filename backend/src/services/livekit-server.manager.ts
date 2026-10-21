/**
 * 嵌入式 LiveKit 服务管理器。
 *
 * livekit-server 是独立 Go 二进制，无法内嵌进 pkg 产物；本管理器把它
 * 作为「伴生进程」随主进程启动/停止：
 *
 * - 单文件部署：build-all 打包时已把二进制分发到 exe 旁，启动时自动拉起
 * - 开发模式（npm run dev）：二进制缺失时自动从 GitHub Releases 下载到
 *   backend/dev-bin/ 再启动（仅开发模式；生产包不会静默联网下载）
 * - 外置部署：LIVEKIT_EXTERNAL=1 或 .env 显式配置 LiveKit 地址时跳过
 *
 * 生命周期：随主进程退出而终止子进程（SIGINT/SIGTERM/exit 三挂钩）。
 * 环境变量缺省值在启动早期注入，.env 显式配置优先：
 * LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_API_HOST / LIVEKIT_BIND
 * （客户端地址不在此配置——由 voice.routes 按请求头推导，跟随页面域名）。
 */
import { spawn, ChildProcess, execSync } from 'child_process';
import fs from 'fs';
import https from 'https';
import net from 'net';
import os from 'os';
import path from 'path';

const DEFAULT_API_KEY = 'devkey';
const DEFAULT_API_SECRET = 'zviewer-dev-secret';
const HTTP_PORT = 3336;
/**
 * 媒体传输 UDP 端口：项目 TCP 侧未使用 3333/udp，故媒体与信令反代
 * 共用 3333 端口号（tcp=页面/API/信令反代，udp=RTP 媒体），防火墙
 * 只需放行一条 3333。
 */
const UDP_PORT = 3333;
/**
 * ICE/TCP 直连端口（LiveKit 原生 rtc.tcp_port，官方默认 7881）：UDP 被墙
 * （运营商/企业防火墙、代理 TUN 吞包）时客户端经此端口以 TCP 直连媒体，
 * 是唯一不需要证书的兜底通道。默认为 3337，部署侧需放行 3337/tcp
 * （compose 已含映射）。
 *
 * 管理端不提供 UDP / TCP 切换：LiveKit 无法禁用 UDP 候选，服务端同时发布
 * UDP（3333）与本端口，客户端 ICE 自动择优——UDP 直连 > TCP 直连 > TURN
 * 中继（3338）。UDP 被运营商/企业防火墙或代理拦截时浏览器自行改连 TCP，
 * 无需人工切换；要彻底关掉本监听才需要显式设 0（见下）。
 *
 * 绝不能「不设」这个值：不设时 LiveKit 回落到默认 7881，而 7881 从未做过
 * 端口映射，客户端只会拿到必然连不上的候选（社区实测反馈：UDP 模式回退
 * TCP 时用的还是 7881）。要关闭回退必须显式设 0，不能删除环境变量。
 * 可用环境变量 LIVEKIT_RTC_TCP_PORT 覆盖端口或设 0 关闭。
 */
const CONFIGURED_TCP_PORT = process.env.LIVEKIT_RTC_TCP_PORT?.trim();
const TCP_PORT = Number(CONFIGURED_TCP_PORT) || 3337;
/** 用户显式 LIVEKIT_RTC_TCP_PORT=0：主动关闭 ICE/TCP 回退（仅 UDP） */
const TCP_DISABLED_BY_USER = CONFIGURED_TCP_PORT === '0';
/**
 * TURN/TLS 中继端口（默认 3338）：与 TCP 直连分成两个端口，因此**可以
 * 同时开启**——客户端 ICE 择优：UDP 直连 > TCP 直连 > TURN 中继（中继多
 * 一跳，延迟略高，但穿透最差网络：代理 TUN、多层 NAT、服务端 IP 不可达）。
 * 之所以不沿用官方 5349、也不与 3337 同号：TURN 与 ICE/TCP 都是 TCP 监听，
 * 同号时 LiveKit 直接 bind 失败退出（实测），拆开才能并存。
 * 可用环境变量 LIVEKIT_TURN_TLS_PORT 覆盖（如想回到官方 5349）。
 */
const TURN_PORT = Number(process.env.LIVEKIT_TURN_TLS_PORT?.trim()) || 3338;

/**
 * TURN/TLS 三件套（域名 + 证书 + 私钥）是否齐全——三者缺一不算启用。
 * 自签证书浏览器 WebRTC 不信任，故必须正式证书；域名需与证书一致。
 * 供「端口分配判定」与「子进程参数注入」共用，避免两处口径不一致。
 */
function readTurnConfig(): { domain: string; cert: string; key: string } | null {
  const domain = process.env.LIVEKIT_TURN_DOMAIN?.trim();
  const cert = process.env.LIVEKIT_TURN_CERT?.trim();
  const key = process.env.LIVEKIT_TURN_KEY?.trim();
  return domain && cert && key ? { domain, cert, key } : null;
}

/**
 * 监听地址：默认 `::`（Go dual-stack，同时收 IPv4/IPv6——IPv4 连接以
 * v4-mapped 形式进入，127.0.0.1 回环依然可达）。绑 0.0.0.0 会只收
 * IPv4，公网 IPv6 用户的媒体流无法建立。特殊环境可用 LIVEKIT_BIND 覆盖。
 */
const BIND_ADDRESS = process.env.LIVEKIT_BIND?.trim() || '::';
const READY_TIMEOUT_MS = 15_000;
/** 开发模式自动下载的 pinned 版本（与 build-all 打包版本保持一致） */
const LIVEKIT_VERSION = 'v1.13.7';

let child: ChildProcess | null = null;

function binName(): string {
  return process.platform === 'win32' ? 'livekit-server.exe' : 'livekit-server';
}

/** 是否为 pkg 单文件运行（生产包不自动联网下载） */
function isPkgRuntime(): boolean {
  return Boolean((process as { pkg?: unknown }).pkg);
}

function isDevMode(): boolean {
  return !isPkgRuntime();
}

function candidatePaths(): string[] {
  const name = binName();
  return [
    // pkg 产物：exe 同目录（build-all 打包时随产物分发）
    path.join(path.dirname(process.execPath), name),
    // 开发环境：backend/dev-bin（自动下载/手动放置均可）
    path.join(process.cwd(), 'dev-bin', name),
  ];
}

function isEmbeddedLivekitAvailable(): boolean {
  return candidatePaths().some((p) => fs.existsSync(p));
}

// ==================== 开发模式自动下载 ====================

/** https 下载（跟随重定向；GitHub releases 会 302 到对象存储） */
function httpsDownload(url: string, dest: string, depth = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('重定向次数过多'));
    https
      .get(url, { headers: { 'User-Agent': 'zviewer-dev-setup' } }, (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          httpsDownload(
            new URL(res.headers.location, url).toString(),
            dest,
            depth + 1
          ).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

/** 解压到 dev-bin（win: zip→Expand-Archive；nix: tar.gz→tar） */
function extractLivekit(archive: string, destDir: string): void {
  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Force -Path ${JSON.stringify(
        archive
      )} -DestinationPath ${JSON.stringify(destDir)}"`,
      { stdio: 'pipe' }
    );
  } else {
    execSync(`tar -xzf ${JSON.stringify(archive)} -C ${JSON.stringify(destDir)}`, {
      stdio: 'pipe',
    });
  }
}

/**
 * 开发模式：二进制缺失时自动下载到 backend/dev-bin/。
 * 成功返回二进制路径；失败（网络不通等）返回 null 并给出手动放置指引。
 */
async function downloadDevBinary(): Promise<string | null> {
  const destDir = path.join(process.cwd(), 'dev-bin');
  const isWin = process.platform === 'win32';
  const asset = isWin
    ? `livekit_${LIVEKIT_VERSION.slice(1)}_windows_amd64.zip`
    : `livekit_${LIVEKIT_VERSION.slice(1)}_linux_amd64.tar.gz`;
  const url = `https://github.com/livekit/livekit-server/releases/download/${LIVEKIT_VERSION}/${asset}`;
  const archive = path.join(destDir, asset);
  fs.mkdirSync(destDir, { recursive: true });
  try {
    console.log(`[voice] 开发模式：自动下载 livekit-server ${LIVEKIT_VERSION} ...`);
    await httpsDownload(url, archive);
    extractLivekit(archive, destDir);
    const bin = path.join(destDir, binName());
    if (!fs.existsSync(bin)) throw new Error(`解压后未找到 ${bin}`);
    if (!isWin) {
      try {
        fs.chmodSync(bin, 0o755);
      } catch {
        /* ignore */
      }
    }
    console.log('[voice] livekit-server 下载完成');
    return bin;
  } catch (err) {
    console.warn(
      `[voice] livekit-server 自动下载失败（${err instanceof Error ? err.message : err}）。` +
        `可手动下载 ${url} 放置到 ${destDir} 后重启`
    );
    return null;
  } finally {
    try {
      fs.rmSync(archive, { force: true });
    } catch {
      /* ignore */
    }
  }
}

// ==================== 启动 / 就绪 / 停止 ====================

/** 轮询等待 LiveKit HTTP 端口可连接 */
function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error(`LiveKit 端口 ${port} 等待超时`));
        } else {
          setTimeout(tryOnce, 300);
        }
      });
    };
    tryOnce();
  });
}

function killChild(): void {
  if (!child) return;
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  child = null;
}

let exitHooksInstalled = false;
function installExitHooks(): void {
  if (exitHooksInstalled) return;
  exitHooksInstalled = true;
  process.once('exit', killChild);
  process.once('SIGINT', () => {
    killChild();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    killChild();
    process.exit(0);
  });
}

/**
 * 判断 IP 是否为非公网地址（RFC1918 私网 / 回环 / 链路本地 / CGNAT / IPv6 ULA）。
 */
function isNonPublicAddress(ip: string, family: string): boolean {
  if (family === 'IPv4') {
    if (/^10\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
    if (/^127\./.test(ip)) return true;
    if (/^169\.254\./.test(ip)) return true;
    // CGNAT（运营商级 NAT，100.64.0.0/10）：无端口映射时同样不可达
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;
    return false;
  }
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6.startsWith('fe80')) return true;
  // IPv6 ULA fc00::/7
  if (/^f[cd][0-9a-f]{2}:/.test(v6)) return true;
  return false;
}

/** 枚举本机网卡，返回首个公网地址（无则 null） */
function probePublicInterfaceIp(): string | null {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.internal) continue;
      if (!isNonPublicAddress(net.address, net.family)) return net.address;
    }
  }
  return null;
}

/**
 * 启动嵌入式 LiveKit 服务（幂等；不具备条件时静默跳过）。
 *
 * 调用时机：bootstrap 早期 fire-and-forget（不阻塞主服务启动；
 * 下载期间 /api/voice/token 会 503，前端提示「语音服务未就绪」）。
 */
/** 拉起 livekit 子进程并等待 HTTP 端口就绪；超时/退出返回 false */
async function spawnAndAwait(
  bin: string,
  bind: string,
  nodeIp: string | undefined
): Promise<boolean> {
  const args = [
    '--dev',
    // dual-stack 监听（IPv4+IPv6），见 BIND_ADDRESS 注释
    '--bind',
    bind,
    // HTTP/信令端口：默认 7880，统一改为 3336 避开常见端口占用
    '--port',
    String(HTTP_PORT),
    '--udp-port',
    String(UDP_PORT),
    // 注意：livekit-server CLI 没有 --tcp-port flag（v1.13.7 实测报
    // "flag provided but not defined"），rtc.tcp_port 只能经 config 环
    // 境变量 LIVEKIT_RTC_TCP_PORT 下发（在 startEmbeddedLivekit 注入区
    // 写具体端口或 '0'，机制同 LIVEKIT_RTC_USE_EXTERNAL_IP）。
    // --keys 格式硬性要求 "key: secret"（冒号后必须带空格），缺空格
    // livekit 会直接退出（冒烟实测踩坑）
    '--keys',
    `${process.env.LIVEKIT_API_KEY}: ${process.env.LIVEKIT_API_SECRET}`,
  ];
  // 广播给客户端的 ICE 地址：显式 LIVEKIT_NODE_IP 直接指定；容器内未
  // 指定时由 LIVEKIT_RTC_USE_EXTERNAL_IP 驱动 LiveKit 自行 STUN 探测
  // 公网 IP（bridge NAT 下枚举网卡只得 172.x 内网地址，浏览器不可达）。
  if (nodeIp) args.push('--node-ip', nodeIp);
  // TURN/TLS 中继：域名寻址 + 正式证书，浏览器经 TCP 主动连服务器中继媒体，
  // 彻底不依赖 IP 广播与对端可达性——防火墙拦 UDP / 多层 NAT / 服务端 IP 被
  // 封时的最终兜底。端口默认 3338（与 ICE/TCP 3337 分离，可并存，见 TURN_PORT），
  // 部署侧需放行 3338/tcp。UDP 直连（host/srflx 候选）仍并行尝试，可通时
  // 优先走低延迟 UDP。三个 env 齐全才启用。
  const turn = readTurnConfig();
  if (turn) {
    process.env.LIVEKIT_TURN_ENABLED ??= 'true';
    process.env.LIVEKIT_TURN_TLS_PORT ??= String(TURN_PORT);
    process.env.LIVEKIT_TURN_EXTERNAL_TLS ??= 'false';
    args.push('--turn-cert', turn.cert, '--turn-key', turn.key);
    console.log(
      `[voice] TURN/TLS 已启用: ${turn.domain}:${TURN_PORT} (TCP 中继兜底)`
    );
  } else if (
    process.env.LIVEKIT_TURN_DOMAIN?.trim() ||
    process.env.LIVEKIT_TURN_CERT?.trim() ||
    process.env.LIVEKIT_TURN_KEY?.trim()
  ) {
    console.warn(
      '[voice] TURN 配置不完整（需 LIVEKIT_TURN_DOMAIN + LIVEKIT_TURN_CERT + LIVEKIT_TURN_KEY 三者），已忽略'
    );
  }

  child = spawn(bin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(`[livekit] ${chunk}`);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[livekit] ${chunk}`);
  });
  child.once('exit', (code) => {
    console.warn(`[voice] 嵌入式 LiveKit 进程退出 (code=${code})`);
    child = null;
  });

  installExitHooks();

  try {
    await waitForPort(HTTP_PORT, READY_TIMEOUT_MS);
    console.log(`[voice] 嵌入式 LiveKit 已就绪 (bind ${bind})`);
    return true;
  } catch {
    // 等待失败时若进程仍在（如启动过慢）先终止，避免残留占端口
    killChild();
    return false;
  }
}

export async function startEmbeddedLivekit(): Promise<void> {
  if (child) return;
  if (process.env.LIVEKIT_EXTERNAL === '1') return;

  // 环境变量缺省值先注入（显式配置 ??= 不覆盖），下载期间路由即可用
  process.env.LIVEKIT_API_KEY ??= DEFAULT_API_KEY;
  process.env.LIVEKIT_API_SECRET ??= DEFAULT_API_SECRET;
  process.env.LIVEKIT_API_HOST ??= `http://127.0.0.1:${HTTP_PORT}`;
  // 默认开启 LiveKit 原生 STUN 外部 IP 发现（未显式 LIVEKIT_NODE_IP 时）：
  // 容器 bridge / 云服务器 EIP（网卡只有内网 IP）等 NAT 场景下枚举网卡
  // 只得不可达的内网地址，STUN 探测拿到真实公网 IP（v4+v6 均支持）。
  // 显式 LIVEKIT_NODE_IP 时跳过注入（手填地址优先级最高，二者不叠加）。
  // STUN 失败（纯内网部署）时 LiveKit 回落枚举网卡，行为与不开一致。
  if (!process.env.LIVEKIT_NODE_IP?.trim()) {
    process.env.LIVEKIT_RTC_USE_EXTERNAL_IP ??= 'true';
    console.log('[voice] 已启用 LiveKit 原生 STUN 外部 IP 发现');
  }
  // 内外网双候选：只开 STUN 时，LiveKit 会用 NAT1To1 把本地候选「替换」成
  // 探测到的外网 IP，于是同一个部署只能服务一侧——局域网用户拿到公网地址后
  // 常因路由器不支持 NAT 回环（hairpin）而连不上，反之亦然。
  // advertise_internal_ip 会保留本地网卡地址、再追加映射后的外网地址（官方
  // 原文：clients connect from both private and public networks），两侧各自
  // 选中可达的那条候选。
  // 注意：bridge 网络下「本地地址」是容器 172.x，对局域网客户端不可达，多出来
  // 的只是 ICE 并发探测；host 网络（推荐）下它就是真实局域网 IP，才真正有用。
  // 可用 LIVEKIT_RTC_ADVERTISE_INTERNAL_IP=false 关闭。
  process.env.LIVEKIT_RTC_ADVERTISE_INTERNAL_IP ??= 'true';
  if (process.env.LIVEKIT_RTC_ADVERTISE_INTERNAL_IP !== 'false') {
    console.log('[voice] 已启用内外网双 IP 候选（advertise_internal_ip）');
  }
  // 端口分配（UDP 媒体 3333、ICE/TCP 直连 3337、TURN/TLS 中继 3338）：
  // - ICE/TCP 默认开启，与 UDP 一起发布候选，由客户端 ICE 自动择优（UDP 通时
  //   不会走 TCP）。关闭必须显式写 0，不能 delete——delete 会让 LiveKit 回落
  //   到默认 7881，而 7881 未做端口映射，等于广播一条必死的候选。
  // - TURN 三件套齐全时中继常开，与直连不同端口可并存。
  // - 唯一冲突：TURN 与 ICE/TCP 被手工配成同号——两个 TCP 监听无法共存
  //   （实测同端口启动直接 bind 失败退出），此时让给中继并关闭直连。
  const turn = readTurnConfig();
  if (turn) process.env.LIVEKIT_TURN_TLS_PORT ??= String(TURN_PORT);

  if (turn && TURN_PORT === TCP_PORT) {
    process.env.LIVEKIT_RTC_TCP_PORT = '0';
    console.warn(
      `[voice] TURN 与 ICE/TCP 端口同号（${TCP_PORT}），同端口无法并存，已让给 TURN/TLS 中继并关闭 ICE/TCP 直连；` +
        '如需两者共存，请把 LIVEKIT_TURN_TLS_PORT 设为 3338 之类的独立端口'
    );
  } else if (TCP_DISABLED_BY_USER) {
    process.env.LIVEKIT_RTC_TCP_PORT = '0';
    console.log(
      `[voice] ICE/TCP 已关闭（LIVEKIT_RTC_TCP_PORT=0，仅 3333/udp）` +
        (turn ? `，TURN 中继仍在 ${TURN_PORT}/tcp` : '') +
        '；UDP 被拦的网络将无法建立媒体'
    );
  } else {
    process.env.LIVEKIT_RTC_TCP_PORT = String(TCP_PORT);
    console.log(
      `[voice] ICE/TCP 已启用: ${TCP_PORT}/tcp（UDP 不通时自动回退）` +
        (turn ? `；TURN 中继并存于 ${TURN_PORT}/tcp` : '')
    );
  }
  // 注意：此处不设置 LIVEKIT_URL——客户端地址由 voice.routes 按请求头
  // 推导（跟随页面域名与协议）。在容器/多网卡环境探测本机 IP 会得到
  // 内部地址（如 Docker bridge 172.24.x.x），浏览器不可达。

  let bin = candidatePaths().find((p) => fs.existsSync(p));
  if (!bin) {
    if (!isDevMode()) {
      console.warn(
        '[voice] 未找到 livekit-server 伴生二进制且未配置外置 LiveKit——语音功能不可用。' +
          '容器部署：请用最新 Dockerfile.linux-single 重建镜像（内嵌 livekit-server，' +
          '构建前先跑 node build-all.js --linux 生成 dist/linux/livekit-server）；' +
          '单文件部署：请使用完整 build-all 产物包（含 livekit-server）'
      );
      return;
    }
    const downloaded = await downloadDevBinary();
    if (!downloaded) return;
    bin = downloaded;
  }

  console.log(
    `[voice] 启动嵌入式 LiveKit: ${bin} (bind ${BIND_ADDRESS}, HTTP ${HTTP_PORT}, UDP ${UDP_PORT}, URL=${process.env.LIVEKIT_URL})`
  );

  // 广播地址：显式 LIVEKIT_NODE_IP 最高优先级；未指定时由上面注入的
  // LIVEKIT_RTC_USE_EXTERNAL_IP 驱动 LiveKit 自行 STUN 探测公网 IP。
  const nodeIp = process.env.LIVEKIT_NODE_IP?.trim() || undefined;

  let ok = await spawnAndAwait(bin, BIND_ADDRESS, nodeIp);
  // 无 IPv6 协议栈的环境绑 :: 会直接退出（缺少 IPv6 支持时）——回退纯
  // IPv4 重试一次，代价是 IPv6 媒体不可用，但语音整体可用
  if (!ok && BIND_ADDRESS === '::') {
    console.warn('[voice] bind :: 启动失败，回退 0.0.0.0 (仅 IPv4) 重试');
    ok = await spawnAndAwait(bin, '0.0.0.0', nodeIp);
  }
  if (!ok) {
    console.error(
      '[voice] 嵌入式 LiveKit 启动失败——语音将不可用，请检查端口占用与二进制完整性'
    );
    return;
  }

  // 外网可达性自检：本机网卡全为私网地址且未配置 NODE_IP/TURN 时，
  // LiveKit 广播的 ICE 候选（host=私网地址；STUN srflx=NAT 出口 IP 但
  // 无端口映射时同样不可达）对外网用户不可达。经 EdgeOne / CDN / 反向
  // 代理等七层服务暴露外网时，页面与信令正常（HTTP/WS 走代理），但
  // WebRTC 媒体（UDP/TCP）不经过七层代理——把这种静默失败变成启动
  // 日志里的显式警告，避免「局域网语音正常、外网连不上」难以排查。
  // 例外：云服务器 EIP 场景网卡是私网但 STUN 可探测到公网 IP（需安全组
  // 放行 3333/udp），此警告可忽略。
  if (
    !nodeIp &&
    !process.env.LIVEKIT_TURN_DOMAIN?.trim() &&
    probePublicInterfaceIp() === null
  ) {
    console.warn(
      '[voice] ⚠️ 语音媒体外网可达性警告：本机网卡均为私网地址，且未配置 LIVEKIT_NODE_IP 与 TURN。\n' +
        '[voice] 局域网内语音正常；外网用户经 EdgeOne/CDN/反向代理访问时页面与信令正常，但 WebRTC 媒体（UDP/TCP）不经过七层代理，语音将无法连接。\n' +
        '[voice] 解决路径（三选一）：\n' +
        '[voice]   ① 部署到有公网 IP 的主机，安全组/防火墙放行 3333/udp（容器场景 docker-compose 已含映射）；\n' +
        '[voice]   ② 用支持端口转发的穿透（frp 等）把 3333/udp 映射到公网，并设 LIVEKIT_NODE_IP=穿透公网地址；\n' +
        '[voice]   ③ 配置 TURN/TLS 中继：LIVEKIT_TURN_DOMAIN + LIVEKIT_TURN_CERT + LIVEKIT_TURN_KEY 三项，' +
        '并把 3338/tcp 映射到公网（需正式证书，浏览器不信任自签）。'
    );
  }
}
