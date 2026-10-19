const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const base = path.join(__dirname, 'ui');
const port = Number(process.env.ZVIEWER_PREVIEW_PORT || 17839);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname); } catch { res.writeHead(400).end(); return; }
  const file = path.resolve(base, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
server.on('error', error => { console.error(`Preview server: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`ZViewer GUI preview: http://127.0.0.1:${port}`));
