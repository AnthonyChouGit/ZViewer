import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {applyCliPatch,patchInfo} from '../patches/cli-settings-origin.cjs';

const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const directory = path.join(desktop, '.runtime', 'tools', 'zviewer-cli');
const source = path.join(directory, 'source');
const repository = 'https://github.com/Zero-wyc/ZViewerCLI';
const commit = '101659b01a3a9248cea8b32c7eb18b6f76d842f1';
const toolchain = 'go1.26.9';
const executable = 'zviewer-cli-windows-amd64.exe';
const binarySha256 = '2a58c9518829c754719e9b0903baf37ea3f95d0e548075df9710b73d0fca78db';
if (patchInfo().sha256 !== '9e5bba199baca8f84b8d0e88855e528abdbf937bf50ff301fe33c50d9effc92b') throw new Error('Local CLI patch checksum mismatch');
// Upstream dist still reports v0.1.0. Build the pinned v0.2.1 source instead.
const sources = {
  'bilibili.go':'5b48735196e6eed996dee0142543540385ce85d3',
  'config.go':'1812b64a955d24e840b81c071a6d9eeeebfee814',
  'main.go':'8db19e5343756538868c0642fb6253cc1191212f',
  'mp4box.go':'b4bbebac15d8cc36d54a0f677627b719c3afcf9c',
  'page.go':'e3053962f31f91f2dd063e2a6c596ec133a60e62',
  'resolver.go':'ebcb72f1dd52bdde930ce1e42eaf4a29804ffdb2',
  'server.go':'800cc23d6e6252e246991e53852fab8f8224f2da',
  'socket.go':'33cb3ca33cfb9b3fc1f2d01c7c0d01d1136bf8c5',
  'speedlog.go':'75132ec2e56768802dd0a27d7a59ab89ce5f9786',
  'state.go':'ec9c080dfab3ec4eb862479b742b6b7d57bd4292',
  'wbi.go':'567d2c653ed46bcf6efc2e4c03e16cf2af2bcdb6',
  'go.mod':'bc4d7a6a54b0b7f9ab61e5626f2b2ff0508ec585',
  'go.sum':'a78d22816163f19fbc5a170f678de9602a73a349',
  'Nacho.webp':'721de1307e68b57ede12284271850a05d7bf16ef',
  'm4s_head.bin':'7f898a19880d40e650ce0e40b1d836a1037c7d4d',
  'LICENSE':'733edfebe415036e5a357d59c133302d8f20b644'
};
const licenses = [
  {name:'Go',url:'https://raw.githubusercontent.com/golang/go/go1.26.9/LICENSE',sha256:'911f8f5782931320f5b8d1160a76365b83aea6447ee6c04fa6d5591467db9dad'},
  {name:'gorilla/websocket',url:'https://raw.githubusercontent.com/gorilla/websocket/v1.5.3/LICENSE',sha256:'2be1b548b0387ca8948e1bb9434e709126904d15f622cc2d0d8e7f186e4d122d'},
  {name:'rs/cors',url:'https://raw.githubusercontent.com/rs/cors/v1.11.1/LICENSE',sha256:'c21f3b628875c093885ba085d13959b5e78841d64a8fe76c10ba7293aec32fc7'},
  {name:'skip2/go-qrcode',url:'https://raw.githubusercontent.com/skip2/go-qrcode/da1b6568686e/LICENSE',sha256:'4cdab772de606bdf53e174b2f5d6a2c398156380ca1f763122198cece531d02c'}
];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const gitHash = bytes => crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
function download(url) {
  return new Promise((resolve,reject) => {
    const request = https.get(url,{headers:{'User-Agent':'ZViewer-Desktop-Build'},timeout:30000}, response => {
      if(response.statusCode !== 200) { response.resume(); reject(new Error('CLI download returned HTTP '+response.statusCode+': '+url)); return; }
      let size = 0; const chunks = [];
      response.on('data', chunk => { size += chunk.length; if(size > 16*1024*1024) request.destroy(new Error('CLI download exceeded the expected maximum size')); else chunks.push(chunk); });
      response.on('error',reject);
      response.on('end',() => resolve(Buffer.concat(chunks)));
    });
    request.on('timeout',() => request.destroy(new Error('CLI download timed out: '+url)));
    request.on('error',reject);
  });
}
async function verifiedSource(name) {
  const target = path.join(source,name);
  if(fs.existsSync(target)) {
    if(gitHash(fs.readFileSync(target)) !== sources[name]) throw new Error('Cached CLI source checksum mismatch: '+target);
  } else {
    const bytes = await download('https://raw.githubusercontent.com/Zero-wyc/ZViewerCLI/'+commit+'/'+name);
    if(gitHash(bytes) !== sources[name]) throw new Error('Downloaded CLI source checksum mismatch: '+name);
    fs.writeFileSync(target,bytes,{flag:'wx'});
  }
  return target;
}
fs.mkdirSync(source,{recursive:true});
const target = path.join(directory,executable);
if(fs.existsSync(target)) {
  if(hash(fs.readFileSync(target)) !== binarySha256) throw new Error('Cached CLI checksum mismatch: '+target);
} else {
  for(const name of Object.keys(sources)) await verifiedSource(name);
  const buildSource = path.join(directory,'patched-source');
  applyCliPatch(source,buildSource);
  const env = {...process.env,GOTOOLCHAIN:toolchain,GOOS:'windows',GOARCH:'amd64',CGO_ENABLED:'0',GOFLAGS:'',GOAMD64:'v1',GOEXPERIMENT:''};
  const actual = execFileSync('go',['version'],{env,encoding:'utf8',windowsHide:true}).trim();
  if(!actual.includes(' '+toolchain+' ')) throw new Error('CLI build requires '+toolchain+'; got '+actual);
  execFileSync('go',['build','-mod=readonly','-trimpath','-buildvcs=false','-ldflags=-s -w -buildid=','-o',target,'.'],{cwd:buildSource,env,stdio:'inherit',windowsHide:true});
  if(hash(fs.readFileSync(target)) !== binarySha256) throw new Error('Built CLI checksum mismatch: '+target);
}
const license = path.join(directory,'LICENSE');
if(fs.existsSync(license)) {
  if(gitHash(fs.readFileSync(license)) !== sources.LICENSE) throw new Error('Cached CLI LICENSE checksum mismatch');
} else fs.copyFileSync(await verifiedSource('LICENSE'),license);
const notices = [];
for(let i=0;i<licenses.length;i++) {
  const entry = licenses[i], cached = path.join(source,'third-party-license-'+i+'.txt');
  const bytes = fs.existsSync(cached) ? fs.readFileSync(cached) : await download(entry.url);
  if(hash(bytes) !== entry.sha256) throw new Error('CLI third-party license checksum mismatch: '+entry.name);
  if(!fs.existsSync(cached)) fs.writeFileSync(cached,bytes,{flag:'wx'});
  notices.push(entry.name+'\n'+'='.repeat(entry.name.length)+'\n'+bytes.toString('utf8'));
}
fs.writeFileSync(path.join(directory,'THIRD-PARTY-NOTICES.txt'),notices.join('\n\n'));
fs.writeFileSync(path.join(directory,'provenance.json'),JSON.stringify({repository,commit,version:'0.2.1',toolchain,platform:'windows-amd64',source:'Built from pinned upstream source with local settings security and optional desktop embedded theme patches',patch:patchInfo(),files:[{file:executable,sha256:binarySha256},{file:'LICENSE',sha256:hash(fs.readFileSync(license))},{file:'THIRD-PARTY-NOTICES.txt',sha256:hash(fs.readFileSync(path.join(directory,'THIRD-PARTY-NOTICES.txt')))}],sourceBlobs:sources},null,2)+'\n');
console.log('Source-built ZViewerCLI v0.2.1 verified ('+commit+', '+toolchain+')');
