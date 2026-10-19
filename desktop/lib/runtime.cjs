const fs = require('node:fs');
const path = require('node:path');

function resolveRuntime(desktop, { packaged = false, executable = process.execPath, override } = {}) {
  const argument = process.argv.find(value => value.startsWith('--runtime-root='))?.slice('--runtime-root='.length);
  const selected = override || argument || process.env.ZVIEWER_RUNTIME_ROOT;
  if (selected) return path.resolve(selected);
  if (packaged) return path.join(path.dirname(executable), 'runtime');
  const root = path.dirname(desktop);
  const candidates = [path.join(root, 'dist', 'win'), root];
  return candidates.find(dir => fs.existsSync(path.join(dir, 'zviewer-backend.exe')) && fs.existsSync(path.join(dir, 'frontend', 'dist', 'index.html'))) || candidates[0];
}

module.exports = { resolveRuntime };
