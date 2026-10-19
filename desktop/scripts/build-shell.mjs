// 构建 Wails 原生壳：输出 desktop/build/bin/ZViewerShell.exe。
// 与 Electron 版共存，便于逐项对照迁移进度。
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const outDir = process.env.ZVIEWER_OUT_DIR || join(root, 'build', 'bin');
const out = join(outDir, 'ZViewerShell.exe');

mkdirSync(outDir, { recursive: true });
execFileSync('go', [
  'build',
  '-tags', 'desktop,production',
  '-ldflags', `-X main.appVersion=${pkg.version}`,
  '-o', out,
  '.'
], { cwd: root, stdio: 'inherit' });

console.log(`built ${out} (${pkg.version})`);
