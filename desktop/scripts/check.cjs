const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname,'..');
function check(dir) { for(const item of fs.readdirSync(path.join(root,dir),{withFileTypes:true})) { const file=path.join(dir,item.name); if(item.isDirectory()) check(file); else if(/\.(?:cjs|mjs|js)$/.test(item.name)) execFileSync(process.execPath,['--check',path.join(root,file)],{stdio:'inherit'}); } }
for(const name of ['main.cjs','preload.cjs','preview-server.cjs']) execFileSync(process.execPath,['--check',path.join(root,name)],{stdio:'inherit'});
for(const dir of ['lib','scripts','ui','tests','patches']) if(fs.existsSync(path.join(root,dir))) check(dir);
console.log('JavaScript syntax checks passed');
