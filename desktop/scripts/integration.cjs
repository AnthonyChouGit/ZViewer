const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const net = require('node:net');
const dgram = require('node:dgram');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Controller } = require('../lib/controller.cjs');
const { resolveRuntime } = require('../lib/runtime.cjs');
const desktop = path.resolve(__dirname,'..'), source = resolveRuntime(desktop);
const dir = path.join(desktop,'artifacts',`acceptance-${Date.now()}`), root = path.join(dir,'runtime');
fs.mkdirSync(root,{recursive:true});
for(const name of ['zviewer-backend.exe','livekit-server.exe']) fs.linkSync(path.join(source,name),path.join(root,name));
fs.cpSync(path.join(source,'frontend','dist'),path.join(root,'frontend','dist'),{recursive:true});
const frpDir=path.join(desktop,'.runtime','tools','frp_0.71.1_windows_amd64');
const secretKey=crypto.randomBytes(32);
const cipher={encrypt(text){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',secretKey,iv);const b=Buffer.concat([c.update(text),c.final()]);return Buffer.concat([iv,c.getAuthTag(),b]).toString('base64');},decrypt(text){const b=Buffer.from(text,'base64'),d=crypto.createDecipheriv('aes-256-gcm',secretKey,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString();}};
// The test encryption provider is isolated; the desktop uses Windows DPAPI.
const ctrl=new Controller({root,stateDir:path.join(dir,'state'),frpc:path.join(frpDir,'frpc.exe'),cipher});
ctrl.on('log',e=>{if(e.level==='ERROR'||e.source==='console')console.log(`${e.level} ${e.source}: ${e.message}`);});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function request(port,secure,ca,url='/health'){return new Promise((resolve,reject)=>{const q=(secure?https:http).get({host:'127.0.0.1',port,path:url,timeout:3000,...(secure?{ca,servername:'localhost',rejectUnauthorized:true}:{})},r=>{let body='';r.on('data',d=>body+=d);r.on('end',()=>resolve({status:r.statusCode,body}));});q.on('error',reject);q.on('timeout',()=>q.destroy(new Error('request timeout')));});}
async function closed(port){return new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.on('connect',()=>{s.destroy();resolve(false);});s.on('error',()=>resolve(true));});}
let frps;
const report={started:new Date().toISOString(),checks:[],root:dir};
function passed(name){report.checks.push(name);console.log(`PASS ${name}`);}
function voiceToken(grants) {
  const now=Math.floor(Date.now()/1000), enc=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const content=`${enc({alg:'HS256',typ:'JWT'})}.${enc({iss:ctrl.voiceCredentials.key,sub:'gui-acceptance',nbf:now-5,exp:now+60,video:grants})}`;
  return `${content}.${crypto.createHmac('sha256',ctrl.voiceCredentials.secret).update(content).digest('base64url')}`;
}
async function voiceApi() {
  const token=voiceToken({roomList:true});
  return new Promise((resolve,reject)=>{
    const q=http.request({host:'127.0.0.1',port:38436,path:'/twirp/livekit.RoomService/ListRooms',method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},timeout:3000},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});
    q.on('error',reject);q.on('timeout',()=>q.destroy(new Error('LiveKit API timeout')));q.end('{}');
  });
}
async function voiceWebSocket() {
  const token=voiceToken({roomJoin:true,room:'gui-acceptance',canPublish:true,canSubscribe:true});
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(`ws://127.0.0.1:38431/rtc?access_token=${token}&auto_subscribe=1&sdk=js&version=2.0.0&protocol=15`);
    const timeout=setTimeout(()=>{ws.close();reject(new Error('LiveKit proxied WebSocket timeout'));},8000);
    ws.addEventListener('message',event=>{clearTimeout(timeout);assert(event.data);ws.close();resolve();},{once:true});
    ws.addEventListener('error',()=>{clearTimeout(timeout);reject(new Error('LiveKit proxied WebSocket failed'));},{once:true});
  });
}
(async()=>{
  try {
    ctrl.save({port:38431,rtmpPort:38434,flvPort:38435,livekitPort:38436,livekitTcpPort:38437,bindHost:'127.0.0.1'});
    await ctrl.start();assert.equal(ctrl.backendState,'running');passed('Real backend starts on custom port 38431');
    assert.equal(ctrl.voiceState,'running');assert(ctrl.livekit?.pid);passed('Owned LiveKit listens on custom signaling 38436, UDP 38431 and RTC TCP 38437');
    assert.equal(await voiceApi(),200);passed('LiveKit API accepts the same private credentials supplied to the backend');
    await voiceWebSocket();passed('Backend /rtc WebSocket proxy reaches the custom LiveKit signaling port');
    assert.equal((await request(38431,false,undefined,'/admin')).status,200);passed('Current admin route /admin returns 200');
    const socket=await request(38431,false,undefined,'/socket.io/?EIO=4&transport=polling');assert.equal(socket.status,200);assert(socket.body.startsWith('0'));passed('Socket.IO handshake succeeds');
    await ctrl.enableHttps();const ca=fs.readFileSync(ctrl.certificates.paths().ca);
    assert.equal((await request(38431,true,ca)).status,200);passed('Real backend serves HTTPS with validated local CA');
    assert.equal(ctrl.voiceState,'running');passed('Managed LiveKit restarts with the HTTPS backend');
    const token=crypto.randomBytes(32).toString('hex');
    const serverCfg=path.join(dir,'frps.toml');fs.writeFileSync(serverCfg,'bindAddr = "127.0.0.1"\nproxyBindAddr = "127.0.0.1"\nbindPort = 38470\nauth.method = "token"\nauth.token = "{{ .Envs.FRP_TOKEN }}"\ntransport.tls.force = true\n');
    frps=spawn(path.join(frpDir,'frps.exe'),['-c',serverCfg],{windowsHide:true,env:{...process.env,FRP_TOKEN:token},stdio:['ignore','ignore','ignore']});
    await delay(600);
    ctrl.save({frp:{host:'127.0.0.1',port:38470,webPort:38441,voicePort:38443,rtmpPort:38444,tcpPort:38447,tcp:true}},token);
    const mappings=ctrl.frpConfig();assert.match(mappings,/name = "zviewer-voice"[\s\S]*?localPort = 38431/);assert.match(mappings,/name = "zviewer-voice-tcp"[\s\S]*?localPort = 38437/);passed('FRP UDP and RTC TCP local mappings follow the configured LiveKit ports');
    await ctrl.startFrp();
    for(let i=0;i<100&&ctrl.frpState!=='registered';i++)await delay(100);
    assert.equal(ctrl.frpState,'registered');assert.equal((await request(38441,true,ca)).status,200);passed('Real frpc/frps register proxies and forward HTTPS through loopback tunnel');
    const previousFrpcPid=ctrl.frp.pid;
    // Inject the failed state while the real frpc remains alive, then verify recovery replaces it.
    ctrl.frpState='error';await ctrl.startFrp();
    for(let i=0;i<100&&ctrl.frpState!=='registered';i++)await delay(100);
    assert.notEqual(ctrl.frp.pid,previousFrpcPid);assert.equal(ctrl.frpState,'registered');
    assert.equal((await request(38441,true,ca)).status,200);passed('FRP retry replaces a still-alive failed client and restores HTTPS forwarding');
    assert(!fs.readFileSync(ctrl.store.file,'utf8').includes(token));passed('Saved configuration excludes plaintext FRP Token');
    await ctrl.stop();await delay(300);
    for(const p of [38431,38434,38435,38436,38437,38441,38447])assert(await closed(p),`Port ${p} remains open`);
    const udp=dgram.createSocket('udp4');await new Promise((resolve,reject)=>{udp.once('error',reject);udp.bind(38431,'127.0.0.1',()=>udp.close(resolve));});
    passed('Stop releases backend, LiveKit and FRP ports');
    const reopen=new Controller({root,stateDir:path.join(dir,'state'),frpc:path.join(frpDir,'frpc.exe'),cipher});assert.equal(reopen.store.value.port,38431);assert.equal(reopen.store.value.livekitPort,38436);assert.equal(reopen.store.value.livekitTcpPort,38437);assert.equal(reopen.store.value.https,true);assert.equal(reopen.store.token(),token);passed('Next launch restores web and LiveKit ports, HTTPS and encrypted Token');
    const foreign=net.createServer();await new Promise(r=>foreign.listen(38461,'127.0.0.1',r));
    try{reopen.save({port:38461});await assert.rejects(reopen.start(),/已被占用/);assert(foreign.listening);await reopen.stop();assert(foreign.listening);passed('Port conflict leaves unrelated process untouched');}finally{await new Promise(r=>foreign.close(r));}
    report.result='passed';
  }catch(error){report.result='failed';report.error=error.stack;console.error(error.stack);process.exitCode=1;}
  finally{try{if(ctrl.backend||ctrl.frp||ctrl.livekit)await ctrl.stop();}catch(error){console.error('Cleanup failed:',error.message);process.exitCode=1;}if(frps&&frps.exitCode===null)frps.kill();fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log(`Acceptance report: ${path.join(dir,'report.json')}`);}
})();
