import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { packager } from '@electron/packager';
import { resolveRuntime } from '../lib/runtime.cjs';
const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.dirname(desktop);
const runtimeRoot = resolveRuntime(desktop);
for (const name of ['zviewer-backend.exe','livekit-server.exe','frontend/dist/index.html']) {
  if (!fs.existsSync(path.join(runtimeRoot,name))) throw new Error(`Missing Windows runtime: ${path.join(runtimeRoot,name)}. Build it with node build-all.js --win or set ZVIEWER_RUNTIME_ROOT / --runtime-root=...`);
}
const pkg = JSON.parse(fs.readFileSync(path.join(desktop,'package.json'),'utf8'));
// Outputs default to desktop/release; ZVIEWER_OUT_DIR allows building beside a
// previously generated release folder that is still mapped by another process.
const outRoot = path.resolve(process.env.ZVIEWER_OUT_DIR || path.join(desktop,'release'));
execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(desktop,'scripts','prepare-runtime.ps1')],{stdio:'inherit',windowsHide:true});
execFileSync(process.execPath,[path.join(desktop,'scripts','prepare-cli.mjs')],{stdio:'inherit',windowsHide:true});
const compiler = path.join(process.env.WINDIR || 'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
execFileSync(compiler,['/nologo','/target:exe','/platform:x64','/optimize+','/debug-',`/out:${path.join(desktop,'assets','ZViewer.ProcessHost.exe')}`,`/win32icon:${path.join(desktop,'assets','app.ico')}`,path.join(desktop,'native','ProcessHost.cs')],{stdio:'inherit',windowsHide:true});
const stage = path.join(desktop,'.runtime',`stage-${Date.now()}`);
fs.mkdirSync(stage,{recursive:true});
for(const name of ['main.cjs','preload.cjs','lib','ui','assets','package.json','package-lock.json']) fs.cpSync(path.join(desktop,name),path.join(stage,name),{recursive:true});
execFileSync(process.env.ComSpec || 'cmd.exe',['/d','/s','/c','npm ci --omit=dev --ignore-scripts'],{cwd:stage,stdio:'inherit',windowsHide:true});
const stagedPackage = JSON.parse(fs.readFileSync(path.join(stage,'package.json'),'utf8'));
delete stagedPackage.devDependencies; delete stagedPackage.scripts;
fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify(stagedPackage,null,2));
const paths = await packager({dir:stage,name:'ZViewer',platform:'win32',arch:'x64',electronVersion:'44.9.0',electronZipDir:path.join(desktop,'.runtime'),out:path.join(outRoot,`v${pkg.version}`),overwrite:false,asar:{unpack:'**/*.{exe,ps1}'},icon:path.join(desktop,'assets','app.ico'),appVersion:pkg.version,buildVersion:pkg.version,win32metadata:{CompanyName:'ZViewer',FileDescription:'ZViewer Windows Desktop Console',ProductName:'ZViewer Desktop',InternalName:'ZViewer',OriginalFilename:'ZViewer.exe'},prune:true});
const output=paths[0],runtime=path.join(output,'runtime');fs.mkdirSync(runtime,{recursive:true});
for(const name of ['zviewer-backend.exe','livekit-server.exe']) fs.copyFileSync(path.join(runtimeRoot,name),path.join(runtime,name));
fs.cpSync(path.join(runtimeRoot,'frontend','dist'),path.join(runtime,'frontend','dist'),{recursive:true});
const frp=path.join(desktop,'.runtime','tools','frp_0.71.1_windows_amd64');
const cli=path.join(desktop,'.runtime','tools','zviewer-cli');
fs.copyFileSync(path.join(cli,'zviewer-cli-windows-amd64.exe'),path.join(runtime,'zviewer-cli-windows-amd64.exe'));
// Keep the optional web download consistent with the managed CLI in this package.
const webCli = path.join(runtime,'frontend','dist','zviewer-cli-windows-amd64.exe');
if (fs.existsSync(webCli)) fs.copyFileSync(path.join(cli,'zviewer-cli-windows-amd64.exe'),webCli);
fs.copyFileSync(path.join(cli,'LICENSE'),path.join(output,'LICENSE-ZViewerCLI.txt'));
fs.copyFileSync(path.join(cli,'THIRD-PARTY-NOTICES.txt'),path.join(output,'LICENSE-ZViewerCLI-Third-Party.txt'));
fs.copyFileSync(path.join(cli,'provenance.json'),path.join(output,'ZViewerCLI-PROVENANCE.json'));
for(const name of ['frpc.exe','frps.exe']) fs.copyFileSync(path.join(frp,name),path.join(runtime,name));
fs.copyFileSync(path.join(root,'LICENSE'),path.join(output,'LICENSE-ZViewer.txt'));
if(fs.existsSync(path.join(frp,'LICENSE'))) fs.copyFileSync(path.join(frp,'LICENSE'),path.join(output,'LICENSE-FRP.txt'));
fs.writeFileSync(path.join(runtime,'.env.example'),'# No real credentials are distributed. Desktop generates unique secrets on first start.\nPORT=3333\nHOST=127.0.0.1\nNODE_ENV=production\n');
fs.copyFileSync(path.join(desktop,'README.md'),path.join(output,'使用说明.md'));
const files=['ZViewer.exe','resources/app.asar','runtime/zviewer-backend.exe','runtime/livekit-server.exe','runtime/frpc.exe','runtime/frps.exe','runtime/zviewer-cli-windows-amd64.exe'];
const hashes=files.map(name=>({file:name,bytes:fs.statSync(path.join(output,name)).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(output,name))).digest('hex')}));
fs.writeFileSync(path.join(output,'BUILD-MANIFEST.json'),JSON.stringify({version:pkg.version,electron:'44.9.0',frp:'0.71.1',cli:JSON.parse(fs.readFileSync(path.join(cli,'provenance.json'),'utf8')),signed:false,reusedRuntime:['zviewer-backend.exe','livekit-server.exe','frontend/dist (except CLI download)'],updatedAssets:fs.existsSync(webCli)?['runtime/frontend/dist/zviewer-cli-windows-amd64.exe']:[],files:hashes},null,2));
// The user-facing package has one EXE entry and a support folder. No SFX/install.
const distribution = path.join(outRoot,`ZViewer-Windows-GUI-v${pkg.version}-x64`);
if (fs.existsSync(distribution)) throw new Error(`Refusing to overwrite existing distribution: ${distribution}`);
fs.mkdirSync(distribution,{recursive:true});
fs.cpSync(output,path.join(distribution,'app'),{recursive:true});
const python = process.env.ZVIEWER_PYTHON || 'python';
execFileSync(python,[path.join(desktop,'scripts','build-launcher.py'),'--output',path.join(distribution,'ZViewer.exe'),'--version',pkg.version],{stdio:'inherit',windowsHide:true});
fs.copyFileSync(path.join(desktop,'README.md'),path.join(distribution,'使用说明.md'));
const entryFile=path.join(distribution,'ZViewer.exe');
fs.writeFileSync(path.join(distribution,'BUILD-MANIFEST.json'),JSON.stringify({version:pkg.version,format:'directory',entry:'ZViewer.exe',gui:'app/ZViewer.exe',runtime:'app/runtime',installation:false,selfExtracting:false,singleInstance:true,files:[{file:'ZViewer.exe',bytes:fs.statSync(entryFile).size,sha256:crypto.createHash('sha256').update(fs.readFileSync(entryFile)).digest('hex')},...hashes.map(file=>({...file,file:`app/${file.file}`}))]},null,2));
console.log(`Ready-to-run folder: ${distribution}`);
