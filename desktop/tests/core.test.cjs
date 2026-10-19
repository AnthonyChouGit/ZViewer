const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');
const dgram = require('node:dgram');
const {udpAvailable} = require('../lib/controller.cjs');
const { ConfigStore, validate } = require('../lib/config.cjs');
const { Certificates } = require('../lib/certificates.cjs');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(),'zviewer-gui-test-'));
const cipher = { encrypt: text => Buffer.from(text).map(v=>v^0x5a).toString('base64'), decrypt: text => Buffer.from(text,'base64').map(v=>v^0x5a).toString() };

test('custom ports and encrypted Token persist without rewriting the existing env', () => {
  const root=temp(),dir=temp(); fs.writeFileSync(path.join(root,'.env'),'# keep me\nPORT=34123\nJWT_ACCESS_SECRET=private-existing-value\n');
  const before=fs.readFileSync(path.join(root,'.env'));
  const store=new ConfigStore(dir,root,cipher); assert.equal(store.value.port,34123);
  store.save({port:34221,https:true,livekitPort:34226,livekitTcpPort:34227,cli:{port:34333,autoStart:true,user:'viewer & friend'},frp:{host:'frp.example.com'}},'test-sensitive-token');
  const reopened=new ConfigStore(dir,root,cipher);
  assert.equal(reopened.value.port,34221);assert.equal(reopened.value.https,true);assert.equal(reopened.value.frp.host,'frp.example.com');assert.equal(reopened.token(),'test-sensitive-token');
  assert.equal(reopened.value.livekitPort,34226);assert.equal(reopened.value.livekitTcpPort,34227);
  assert.equal(reopened.value.cli.port,34333);assert.equal(reopened.value.cli.autoStart,true);
  assert.equal(reopened.value.cli.user,'viewer & friend');
  reopened.save({cli:{port:34334}});assert.equal(reopened.value.cli.autoStart,true);
  assert.throws(()=>reopened.save({cli:{port:34221}}),/代理端口/);
  assert.equal(reopened.value.frp.voicePort,34221);assert.equal(reopened.value.frp.tcpPort,34227);
  assert(!fs.readFileSync(path.join(dir,'settings.json'),'utf8').includes('test-sensitive-token'));
  assert.deepEqual(fs.readFileSync(path.join(root,'.env')),before);
});
test('invalid and conflicting service ports are rejected', () => {
  for(const port of [0,65536,'80;calc',3336,3337,3334]) assert.throws(()=>validate({port}));
  assert.equal(validate({port:4444}).port,4444);
  assert.throws(()=>validate({frp:{webPort:3334,rtmp:true,rtmpPort:3334}}));
  assert.equal(validate({port:3336,livekitPort:4336}).port,3336);
  assert.throws(()=>validate({livekitPort:3334}));
  assert.throws(()=>validate({livekitTcpPort:3336}));
  assert.throws(()=>validate({port:4333,frp:{advertiseIp:'203.0.113.1',voicePort:3333}}));
});
test('old settings migrate UDP and new settings preserve manual remote mappings', () => {
  const root=temp(),dir=temp();
  fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({schema:1,config:{port:4343,frp:{voicePort:3333}},frpToken:''}));
  const store=new ConfigStore(dir,root,cipher);
  assert.equal(store.value.frp.voicePort,4343);assert.equal(store.value.livekitPort,3336);
  store.save({port:4443,livekitTcpPort:4447});
  assert.equal(store.value.frp.voicePort,4443);assert.equal(store.value.frp.tcpPort,4447);
  store.save({frp:{voicePort:54321,tcpPort:54322}});store.save({port:4543,livekitTcpPort:4547});
  assert.equal(store.value.frp.voicePort,54321);assert.equal(store.value.frp.tcpPort,54322);
  const oldDir=temp();
  fs.writeFileSync(path.join(oldDir,'settings.json'),JSON.stringify({schema:2,config:{port:9333,rtmpPort:9334},frpToken:''}));
  const migrated=new ConfigStore(oldDir,root,cipher);
  assert.equal(migrated.value.port,9333);assert.equal(migrated.value.rtmpPort,9334);assert.equal(migrated.value.cli.port,9335);
  assert.throws(()=>migrated.save({cli:{port:9333}}),/代理端口/);
});
test('UDP conflict detection preserves the unrelated socket', async () => {
  const socket=dgram.createSocket('udp4');
  await new Promise(resolve=>socket.bind(0,'127.0.0.1',resolve));
  const port=socket.address().port;
  try { await assert.rejects(udpAvailable(port),/UDP.*已被占用/);assert.equal(socket.address().port,port); }
  finally { await new Promise(resolve=>socket.close(resolve)); }
  await udpAvailable(port);
});
test('local CA issues localhost + custom DNS + IP certificates and validates a real TLS connection', async () => {
  const certs=new Certificates(temp(),()=>{});
  const local=await certs.ensure();assert(local.valid);assert(local.ca);assert(local.san.includes('localhost'));
  const originalCA=local.fingerprint;
  const custom=await certs.ensure('zviewer.home.arpa','192.168.1.100');assert.equal(custom.fingerprint,originalCA);
  const p=certs.paths(),cert=new crypto.X509Certificate(fs.readFileSync(p.cert));assert(cert.checkHost('zviewer.home.arpa'));assert(cert.checkIP('192.168.1.100'));
  assert(await certs.ensure('zviewer.home.arpa','192.168.1.100'));
  const server=https.createServer({key:fs.readFileSync(p.key),cert:fs.readFileSync(p.cert)},(_req,res)=>res.end('ok'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const result=await new Promise((resolve,reject)=>https.get({host:'127.0.0.1',port:server.address().port,servername:'localhost',ca:fs.readFileSync(p.ca),rejectUnauthorized:true},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject));
    assert.equal(result,200);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
