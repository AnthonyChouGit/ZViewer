// 组装可分发目录：原生壳 + 进程监管宿主 + 运行包 + CLI/FRP 与许可证。
// 产物默认 desktop/dist-gui/ZViewer-Windows-v<version>-x64，可用 ZVIEWER_OUT_DIR 改写。
//
// 用法：
//   node scripts/build-dist.mjs               准备工具并完整打包
//   node scripts/build-dist.mjs --skip-cli    跳过 CLI 构建（离线或仅验证壳层）
//   node scripts/build-dist.mjs --skip-tools  跳过 FRP 下载（缓存已就绪时）
import { execFileSync } from 'node:child_process';
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const desktop = root;
const repo = dirname(desktop);
const pkg = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
const flags = new Set(process.argv.slice(2));
const tools = join(desktop, '.runtime', 'tools');
const frpDir = join(tools, 'frp_0.71.1_windows_amd64');
const cliDir = join(tools, 'zviewer-cli');
const cliExe = join(cliDir, 'zviewer-cli-windows-amd64.exe');
const runtimeSource = process.env.ZVIEWER_RUNTIME_ROOT || join(repo, 'dist', 'win');
const outRoot = process.env.ZVIEWER_OUT_DIR || join(desktop, 'dist-gui');
const distribution = join(outRoot, `ZViewer-Windows-v${pkg.version}-x64`);

function requireFile(file, hint) {
  if (!existsSync(file)) throw new Error(`缺少 ${file}${hint ? '：' + hint : ''}`);
  return file;
}

requireFile(join(runtimeSource, 'zviewer-backend.exe'), '先用 node build-all.js --win 生成运行包，或设置 ZVIEWER_RUNTIME_ROOT');
requireFile(join(runtimeSource, 'livekit-server.exe'));

if (!flags.has('--skip-tools')) {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(desktop, 'scripts', 'prepare-tools.ps1')], { stdio: 'inherit', windowsHide: true });
}
if (!flags.has('--skip-cli')) {
  execFileSync(process.execPath, [join(desktop, 'scripts', 'prepare-cli.mjs')], { stdio: 'inherit', windowsHide: true });
}
const hasCli = existsSync(cliExe);
if (!hasCli) console.warn('CLI: 未找到已构建的 zviewer-cli，分发包将不含高画质代理');

if (existsSync(distribution)) throw new Error(`拒绝覆盖已存在的分发包：${distribution}`);
mkdirSync(distribution, { recursive: true });

const shell = join(distribution, 'ZViewerShell.exe');
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

// 网页里可能带 CLI 下载副本，统一替换成同一次构建的受管 CLI，避免版本分叉。
if (hasCli) {
  copyFileSync(cliExe, join(runtime, 'zviewer-cli-windows-amd64.exe'));
  const webCli = join(runtime, 'frontend', 'dist', 'zviewer-cli-windows-amd64.exe');
  if (existsSync(webCli)) copyFileSync(cliExe, webCli);
  for (const [source, target] of [
    ['LICENSE', 'LICENSE-ZViewerCLI.txt'],
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
  'ZViewerShell.exe',
  'assets/ZViewer.ProcessHost.exe',
  'runtime/zviewer-backend.exe',
  'runtime/livekit-server.exe',
  'runtime/frpc.exe',
  'runtime/frps.exe',
  ...(hasCli ? ['runtime/zviewer-cli-windows-amd64.exe'] : [])
];
const files = tracked.filter(name => existsSync(join(distribution, name))).map(name => ({
  file: name,
  bytes: statSync(join(distribution, name)).size,
  sha256: sha256(join(distribution, name))
}));
const manifest = {
  version: pkg.version,
  format: 'directory',
  entry: 'ZViewerShell.exe',
  shell: 'wails-v2 / go',
  runtime: 'runtime',
  installation: false,
  selfExtracting: false,
  singleInstance: true,
  signed: false,
  iconEmbedded: true,
  frp: '0.71.1',
  cli: hasCli ? JSON.parse(readFileSync(join(cliDir, 'provenance.json'), 'utf8')) : null,
  fileCount: walk(distribution).length,
  files
};
const manifestPath = join(distribution, 'BUILD-MANIFEST.json');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`分发包：${distribution}`);
console.log(`  入口：${relative(outRoot, shell)}  文件数：${manifest.fileCount}`);
