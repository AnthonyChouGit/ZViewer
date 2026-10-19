const {test} = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const {CliProxy} = require('../lib/cli.cjs');
const {Controller} = require('../lib/controller.cjs');

test('CLI port conflict preserves the unrelated listener and does not spawn a process', async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const port = server.address().port;
  const cli = new CliProxy({executable:__filename,hostExe:__filename});
  try {
    await assert.rejects(cli.start(port),/已被占用/);
    assert.equal(cli.snapshot().pid,null);
    assert.equal(server.address().port,port);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('CLI setup URLs are local and encode prefill values without running connection commands', () => {
  const cli = new CliProxy();
  assert.throws(() => cli.url(),/先启动/);
  cli.state = 'running'; cli.activePort = 9333;
  const url = new URL(cli.url({serverUrl:'https://localhost:3333/',user:'viewer & friend'}));
  assert.equal(url.origin,'http://127.0.0.1:9333');
  assert.equal(url.searchParams.get('server'),'https://localhost:3333/');
  assert.equal(url.searchParams.get('user'),'viewer & friend');
  assert.throws(() => cli.url({serverUrl:'file:///C:/data'}),/HTTP/);
  assert.throws(() => cli.url({serverUrl:'https://user:password@localhost/'}),/HTTP/);
  assert.deepEqual(Object.keys(cli.snapshot()).sort(),['activePort','available','connected','pid','state','version']);
});

test('CLI backend address is filled without an account and follows the running service', async () => {
  const controller = Object.create(Controller.prototype);
  controller.store = {value:{port:34431,https:true,cli:{port:9333,user:''}}};
  controller.active = {port:33331,https:false};
  controller.cli = new CliProxy();
  controller.cli.state = 'running'; controller.cli.activePort = 9333;
  controller.startCli = async () => {};
  const running = new URL(await controller.cliSettingsUrl());
  assert.equal(running.searchParams.get('server'),'http://localhost:33331/');
  assert.equal(running.searchParams.has('user'),false);
  assert.equal(running.searchParams.get('desktop'),'1');
  // Pending saved settings must not replace the address of an active backend.
  controller.active = null;
  const nextStart = new URL(await controller.cliSettingsUrl());
  assert.equal(nextStart.searchParams.get('server'),'https://localhost:34431/');
  controller.store.value.cli.user = 'viewer & friend';
  const optionalAccount = new URL(await controller.cliSettingsUrl());
  assert.equal(optionalAccount.searchParams.get('user'),'viewer & friend');
});

test('embedded CLI accepts only its owned loopback setup page', () => {
  const cli = new CliProxy();
  cli.state = 'running'; cli.activePort = 9333;
  assert.equal(cli.allowsFrame('http://127.0.0.1:9333/?desktop=1'),true);
  for (const url of ['https://127.0.0.1:9333/','http://127.0.0.1:9334/','http://localhost:9333/','http://127.0.0.1:9333/api/config','http://user:password@127.0.0.1:9333/','https://example.com/','file:///C:/config','not-a-url']) assert.equal(cli.allowsFrame(url),false,url);
  cli.state = 'stopped'; assert.equal(cli.allowsFrame('http://127.0.0.1:9333/'),false);
});
