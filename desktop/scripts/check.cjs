// 对壳外的 JS 做语法检查：预览服务器、构建脚本、界面脚本与 CLI 补丁。
// Go 侧用 `go vet ./...`，不在这里重复。
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
function check(dir) {
  for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) check(file);
    else if (/\.(?:cjs|mjs|js)$/.test(item.name)) execFileSync(process.execPath, ['--check', path.join(root, file)], { stdio: 'inherit' });
  }
}
for (const name of ['preview-server.cjs']) execFileSync(process.execPath, ['--check', path.join(root, name)], { stdio: 'inherit' });
for (const dir of ['scripts', 'ui', 'patches']) if (fs.existsSync(path.join(root, dir))) check(dir);
console.log('JavaScript syntax checks passed');
