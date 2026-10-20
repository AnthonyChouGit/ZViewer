// 开发运行：编译带 DevTools 与控制台的壳，用独立配置目录启动，日志直接输出到当前终端。
// UI 是 go:embed 编进 EXE 的，改 ui/ 下的文件必须重新编译；只想看样式用 `npm run preview`。
//
// 用法：
//   node scripts/dev.mjs                          编译后启动（窗口内 F12 打开 DevTools）
//   node scripts/dev.mjs --no-build               跳过编译，直接运行已有 EXE
//   node scripts/dev.mjs --state-dir=D:\tmp\zs    指定配置目录
//   node scripts/dev.mjs --runtime-root=D:\dist\win
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = dirname(root);
const flags = process.argv.slice(2);
const has = name => flags.includes(name);
const option = (name, fallback) => {
  const hit = flags.find(item => item.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
};

const exe = join(root, 'build', 'bin', 'ZViewerShell.exe');
const stateDir = resolve(option('--state-dir', process.env.ZVIEWER_STATE_DIR || join(root, '.runtime', 'dev-state')));
const runtimeRoot = resolve(option('--runtime-root', process.env.ZVIEWER_RUNTIME_ROOT || join(repo, 'dist', 'win')));

if (!has('--no-build')) {
  execFileSync(process.execPath, [join(root, 'scripts', 'build-shell.mjs'), '--dev', '--console'], { cwd: root, stdio: 'inherit' });
}
if (!existsSync(exe)) throw new Error(`缺少 ${exe}，先执行 npm run shell:build`);

// 开发实例与日常安装共用同一个单实例锁，正式实例在跑时会聚焦已有窗口而不是新开。
console.log(`开发配置目录：${stateDir}`);
if (existsSync(runtimeRoot)) console.log(`运行包：      ${runtimeRoot}`);
else console.warn(`运行包目录不存在：${runtimeRoot}（界面可以打开，但服务无法启动）`);
console.log('如果窗口没有出现，先退出正在运行的 ZViewer 正式实例（单实例锁）。');
console.log('窗口内按 F12（或右键 → 检查）打开 WebView2 DevTools。');

mkdirSync(stateDir, { recursive: true });
const args = ['--state-dir', stateDir];
if (existsSync(runtimeRoot)) args.push('--runtime-root', runtimeRoot);

// stdio 继承：壳自己写控制台的日志、panic 栈都留在当前终端里。
const child = spawn(exe, args, { stdio: 'inherit', env: { ...process.env, ZVIEWER_STATE_DIR: stateDir } });
child.on('error', error => { console.error(`启动失败：${error.message}`); process.exit(1); });
child.on('exit', code => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
