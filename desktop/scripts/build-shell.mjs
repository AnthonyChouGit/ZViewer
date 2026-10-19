// 构建原生壳：编译进程监管宿主（C#），再编译 Wails/Go 主程序。
// 产物默认 desktop/build/bin/ZViewerShell.exe，可用 ZVIEWER_OUT_DIR 改写目录。
//
// 用法：
//   node scripts/build-shell.mjs                开发构建（带符号，隐藏控制台窗口）
//   node scripts/build-shell.mjs --release      发布构建（-s -w 去符号）
//   node scripts/build-shell.mjs --console      保留控制台窗口，便于观察 panic
//   node scripts/build-shell.mjs --rebuild-host 强制重新编译 ProcessHost.exe
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const flags = new Set(process.argv.slice(2));
const outDir = process.env.ZVIEWER_OUT_DIR || join(root, 'build', 'bin');
const out = join(outDir, 'ZViewerShell.exe');
const hostSource = join(root, 'native', 'ProcessHost.cs');
const hostExe = join(root, 'assets', 'ZViewer.ProcessHost.exe');

function hostUpToDate() {
  if (!existsSync(hostExe)) return false;
  return statSync(hostExe).mtimeMs >= statSync(hostSource).mtimeMs;
}

// ProcessHost 是受管子进程的父进程，负责 Job Object 回收；缺失时壳仍能启动，
// 但子进程会变成孤儿，所以构建阶段尽力编译，失败只告警。
function buildHost() {
  if (!flags.has('--rebuild-host') && hostUpToDate()) {
    console.log('ProcessHost: 已是最新');
    return;
  }
  const windowsDir = process.env.WINDIR || 'C:\\Windows';
  const compiler = join(windowsDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!existsSync(compiler)) {
    console.warn('ProcessHost: 找不到 .NET Framework 4.x 编译器，沿用现有 assets/ZViewer.ProcessHost.exe');
    return;
  }
  mkdirSync(dirname(hostExe), { recursive: true });
  execFileSync(compiler, [
    '/nologo', '/target:exe', '/platform:x64', '/optimize+', '/debug-',
    `/out:${hostExe}`,
    `/win32icon:${join(root, 'assets', 'app.ico')}`,
    hostSource
  ], { stdio: 'inherit', windowsHide: true });
  console.log('ProcessHost: 已编译');
}

buildHost();

mkdirSync(outDir, { recursive: true });
const linker = [`-X main.appVersion=${pkg.version}`];
// 没有 -H windowsgui 会带出控制台窗口，用户看到的就是一个黑框加窗口。
if (!flags.has('--console')) linker.push('-H', 'windowsgui');
if (flags.has('--release')) linker.push('-s', '-w');

const goArgs = ['build', '-tags', 'desktop,production', '-trimpath', '-ldflags', linker.join(' '), '-o', out, '.'];
console.log(`go ${goArgs.join(' ')}`);
execFileSync('go', goArgs, { cwd: root, stdio: 'inherit' });

console.log(`built ${out} (${pkg.version}, ${(statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
