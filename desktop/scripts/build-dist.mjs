// 组装可分发目录：原生壳 + 进程监管宿主 + 运行包 + CLI/FRP 与许可证。
// 产物默认 desktop/dist-gui/zviewer-windows-x64-GUI，可用 ZVIEWER_OUT_DIR 改写。
// 目录名与命令行包一致，仅追加 GUI 后缀，使同一次发布里两个包一眼可辨。
//
// 用法：
//   node scripts/build-dist.mjs               完整打包（CLI 直接取 frontend/public 那份）
//   node scripts/build-dist.mjs --skip-cli    public 缺 CLI 时也不去源码重建，直接报错
//   node scripts/build-dist.mjs --skip-tools  跳过 FRP 下载（缓存已就绪时）
//   node scripts/build-dist.mjs --allow-missing-cli  允许打出不含 CLI 的包（默认报错）
// CLI 一律落在 runtime/；缺失时可用 ZVIEWER_CLI_EXE 指定已有二进制。
import { execFileSync } from 'node:child_process';
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHELL_EXE_NAME } from './shell-entry.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const desktop = root;
const repo = dirname(desktop);
const pkg = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
const flags = new Set(process.argv.slice(2));
const tools = join(desktop, '.runtime', 'tools');
const frpDir = join(tools, 'frp_0.71.1_windows_amd64');
const cliDir = join(tools, 'zviewer-cli');
const runtimeSource = process.env.ZVIEWER_RUNTIME_ROOT || join(repo, 'dist', 'win');
// CLI 来源（按优先级）：
//   1. desktop/zviewer-cli-windows-amd64.exe —— 本地放置点，换版本直接丢这里
//   2. frontend/public/zviewer-cli-windows-amd64.exe —— 入库版，网页「下载 CLI」、
//      单文件运行包与 CI 都用它（本地那份不进库，两份内容应一致）
// 壳只从 runtime/<名字> 拉起高画质代理，所以打包时复制过去。
const desktopCli = join(desktop, 'zviewer-cli-windows-amd64.exe');
const publicCli = join(repo, 'frontend', 'public', 'zviewer-cli-windows-amd64.exe');
const cliFallbacks = [
  process.env.ZVIEWER_CLI_EXE,
  desktopCli,
  publicCli,
  join(runtimeSource, 'frontend', 'dist', 'zviewer-cli-windows-amd64.exe'),
  join(runtimeSource, 'zviewer-cli-windows-amd64.exe')
].filter(Boolean);
const outRoot = process.env.ZVIEWER_OUT_DIR || join(desktop, 'dist-gui');
const distribution = join(outRoot, 'zviewer-windows-x64-GUI');

function requireFile(file, hint) {
  if (!existsSync(file)) throw new Error(`缺少 ${file}${hint ? '：' + hint : ''}`);
  return file;
}

requireFile(join(runtimeSource, 'zviewer-backend.exe'), '先用 node build-all.js --win 生成运行包，或设置 ZVIEWER_RUNTIME_ROOT');
requireFile(join(runtimeSource, 'livekit-server.exe'));

if (!flags.has('--skip-tools')) {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(desktop, 'scripts', 'prepare-tools.ps1')], { stdio: 'inherit', windowsHide: true });
}
// 常态直接从 desktop/ 或 frontend/public 取（两份内容应一致）。都缺失、且没加
// --skip-cli 时，才去 ZViewerCLI 源码仓库重建一份并落到 frontend/public。
if (!existsSync(desktopCli) && !existsSync(publicCli) && !flags.has('--skip-cli')) {
  execFileSync(process.execPath, [join(desktop, 'scripts', 'prepare-cli.mjs'), '--publish'], { stdio: 'inherit', windowsHide: true });
}
if (existsSync(desktopCli) && existsSync(publicCli) && sha256(desktopCli) !== sha256(publicCli)) {
  console.warn('CLI: desktop/ 与 frontend/public/ 两份副本内容不同，本次按 desktop/ 那份打包，请同步后提交');
}
const cliSource = cliFallbacks.find((file) => existsSync(file));
if (!cliSource && !flags.has('--allow-missing-cli')) {
  throw new Error(
    '缺少 zviewer-cli-windows-amd64.exe：放到 desktop/ 或 frontend/public/ 即可（网页下载、单文件版与桌面端共用），' +
    '或用 ZVIEWER_CLI_EXE 指定已有二进制；确实要打不含 CLI 的包时加 --allow-missing-cli'
  );
}
if (!cliSource) console.warn('CLI: 未找到 zviewer-cli，分发包将不含高画质代理（--allow-missing-cli）');
else if (cliSource !== desktopCli && cliSource !== publicCli) console.warn(`CLI: 使用其他副本 ${cliSource}（清单标记 verified:false）`);

if (existsSync(distribution)) throw new Error(`拒绝覆盖已存在的分发包：${distribution}`);
mkdirSync(distribution, { recursive: true });

const shell = join(distribution, SHELL_EXE_NAME);
execFileSync(process.execPath, [join(desktop, 'scripts', 'build-shell.mjs'), '--release'], {
  cwd: desktop, stdio: 'inherit', env: { ...process.env, ZVIEWER_OUT_DIR: distribution }
});
statSync(shell);

// 壳在 runtime/ 里找后端与网页，在 exe 同级的 assets/ 里找进程监管宿主。
const runtime = join(distribution, 'runtime');
mkdirSync(runtime, { recursive: true });
mkdirSync(join(distribution, 'assets'), { recursive: true });
for (const name of ['zviewer-backend.exe', 'livekit-server.exe']) {
  copyFileSync(join(runtimeSource, name), join(runtime, name));
}
cpSync(join(runtimeSource, 'frontend', 'dist'), join(runtime, 'frontend', 'dist'), { recursive: true });
for (const name of ['frpc.exe', 'frps.exe']) {
  if (existsSync(join(frpDir, name))) copyFileSync(join(frpDir, name), join(runtime, name));
}
copyFileSync(join(desktop, 'assets', 'ZViewer.ProcessHost.exe'), join(distribution, 'assets', 'ZViewer.ProcessHost.exe'));

// CLI 固定放进 runtime/：壳只从运行包里找它，缺了就等于没有高画质代理。
// 网页同时留一份下载副本，两者必须同源，避免版本分叉。
if (cliSource) {
  copyFileSync(cliSource, join(runtime, 'zviewer-cli-windows-amd64.exe'));
  const webCli = join(runtime, 'frontend', 'dist', 'zviewer-cli-windows-amd64.exe');
  if (existsSync(webCli)) copyFileSync(cliSource, webCli);
  // 只有 prepare-cli 构建过（或本地存在 ZViewerCLI 源码仓库）才拿得到 LICENSE；
  // 直接用 frontend/public 的发布版时没有，需要随包许可证就用 --publish 重建。
  const cliLicense = [join(cliDir, 'LICENSE'), join(repo, '..', 'ZViewerCLI', 'LICENSE')].find((file) => existsSync(file));
  if (cliLicense) copyFileSync(cliLicense, join(distribution, 'LICENSE-ZViewerCLI.txt'));
  for (const [source, target] of [
    ['THIRD-PARTY-NOTICES.txt', 'LICENSE-ZViewerCLI-Third-Party.txt'],
    ['provenance.json', 'ZViewerCLI-PROVENANCE.json']
  ]) {
    const file = join(cliDir, source);
    if (existsSync(file)) copyFileSync(file, join(distribution, target));
  }
}
copyFileSync(join(desktop, 'README.md'), join(distribution, '使用说明.md'));
for (const [source, target] of [['LICENSE', 'LICENSE-ZViewer.txt']]) {
  const file = join(repo, source);
  if (existsSync(file)) copyFileSync(file, join(distribution, target));
}
if (existsSync(join(frpDir, 'LICENSE'))) copyFileSync(join(frpDir, 'LICENSE'), join(distribution, 'LICENSE-FRP.txt'));
// 首次启动由壳自己生成独立 JWT 密钥，分发包里只放样例，绝不带真实 .env。
rmSync(join(runtime, '.env'), { force: true });
writeFileSync(join(runtime, '.env.example'), '# 不含任何真实凭据。桌面端首次启动时生成独立密钥。\nPORT=3333\nHOST=127.0.0.1\nNODE_ENV=production\n');

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}
// 受管构建用 prepare-cli 产出的 provenance；本地兜底副本只记来源与哈希。
function cliMeta(source) {
  if (!source) return null;
  const digest = sha256(source);
  // frontend/public 那份若是 prepare-cli --publish 同步过去的受管构建，就用
  // provenance（版本/提交/工具链/补丁）；否则只记来源与哈希。
  const provenance = join(cliDir, 'provenance.json');
  if (existsSync(provenance)) {
    const meta = JSON.parse(readFileSync(provenance, 'utf8'));
    const known = (meta.files || []).find((f) => f.file === 'zviewer-cli-windows-amd64.exe');
    if (known && known.sha256 === digest) return { ...meta, source: relative(repo, source) };
  }
  return { source: relative(repo, source), sha256: digest, verified: false };
}
function walk(dir) {
  const out = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
const tracked = [
  SHELL_EXE_NAME,
  'assets/ZViewer.ProcessHost.exe',
  'runtime/zviewer-backend.exe',
  'runtime/livekit-server.exe',
  'runtime/frpc.exe',
  'runtime/frps.exe',
  ...(cliSource ? ['runtime/zviewer-cli-windows-amd64.exe'] : [])
];
const files = tracked.filter(name => existsSync(join(distribution, name))).map(name => ({
  file: name,
  bytes: statSync(join(distribution, name)).size,
  sha256: sha256(join(distribution, name))
}));
const manifest = {
  version: pkg.version,
  format: 'directory',
  entry: SHELL_EXE_NAME,
  shell: 'wails-v2 / go',
  runtime: 'runtime',
  installation: false,
  selfExtracting: false,
  singleInstance: true,
  signed: false,
  iconEmbedded: true,
  frp: '0.71.1',
  cli: cliMeta(cliSource),
  fileCount: walk(distribution).length,
  files
};
const manifestPath = join(distribution, 'BUILD-MANIFEST.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`分发包：${distribution}`);
console.log(`  入口：${relative(outRoot, shell)}  文件数：${manifest.fileCount}`);
