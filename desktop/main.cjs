const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, safeStorage, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Controller } = require('./lib/controller.cjs');
const { resolveRuntime } = require('./lib/runtime.cjs');
const arg = key => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
app.setName('ZViewer Desktop');
app.setPath('userData', arg('state-dir') || (app.isPackaged ? path.join(app.getPath('appData'), 'ZViewerDesktop') : path.join(__dirname, '.runtime', 'profile-live')));
app.setAppUserModelId('xyz.zviewer.desktop');
const root = resolveRuntime(__dirname, { packaged: app.isPackaged, override: arg('runtime-root') });
function companion(name, development) {
  if (!app.isPackaged) return path.join(__dirname, '.runtime', 'tools', ...development);
  const candidates = [path.join(path.dirname(process.execPath), 'runtime', name), path.join(root, name)];
  return candidates.find(file => fs.existsSync(file)) || candidates[0];
}
const frpc = companion('frpc.exe', ['frp_0.71.1_windows_amd64','frpc.exe']);
const cliExecutable = companion('zviewer-cli-windows-amd64.exe', ['zviewer-cli','zviewer-cli-windows-amd64.exe']);
const uiFile = path.join(__dirname, 'ui', 'index.html');
const locked = app.requestSingleInstanceLock();
let win, tray, controller, quitting = false, exited = false;
const icon = () => nativeImage.createFromPath(path.join(__dirname, 'ui', 'app-icon.png'));
function show(page) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore(); win.show(); win.focus();
  if (page) win.webContents.send('navigate', page);
}
function updateTray() {
  if (!tray || !controller) return;
  const status = { stopped: '未启动', starting: '启动中', running: '运行中', stopping: '停止中', error: '异常' }[controller.backendState];
  tray.setToolTip(`ZViewer · ${status}`);
  const command = task => task().catch(error => { controller.log(error.message, 'console', 'ERROR'); show('logs'); });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `ZViewer · ${status}`, enabled: false }, { type: 'separator' },
    { label: '显示控制台', click: () => show() },
    { label: controller.backend ? '停止服务' : '启动服务', enabled: !controller.operation, click: () => command(() => controller.backend ? controller.stop() : controller.start()) },
    { label: '重启服务', enabled: !controller.operation && !!controller.backend, click: () => command(() => controller.restart()) },
    { label: '打开网页端', click: () => command(() => openLocalPage()) },
    { label: '高画质代理', click: () => show('cli') },
    { label: '查看运行日志', click: () => show('logs') }, { type: 'separator' },
    { label: '退出并停止受管服务', click: () => app.quit() }
  ]));
}
async function openLocalPage(manager = false) {
  if (controller.backendState !== 'running') await controller.start();
  if (controller.active.https && !controller.trusted) { show('cert'); throw new Error('HTTPS 已就绪，请先在证书页安装本机 CA 信任，再打开管理页面'); }
  await shell.openExternal(manager ? controller.managementUrl() : controller.webUrl());
}
async function openManager() { return openLocalPage(true); }
async function exportFile(kind) {
  const formats = {
    frpc: ['frpc.toml', () => controller.frpConfig()], frps: ['frps.toml', () => controller.frpConfig(true)],
    logs: ['zviewer-desktop.log', () => controller.events.map(e => `${e.at} ${e.level} [${e.source}] ${e.message}`).reverse().join('\n')],
    ca: ['ZViewer-Local-CA.crt', () => fs.readFileSync(controller.certificates.paths().ca)],
    hosts: ['zviewer-lan-domain.txt', () => `${controller.store.value.lanIp} ${controller.store.value.domain}\n\n在访问设备 hosts 或内网 DNS 配置以上记录。修改 hosts 需要管理员权限。\nhttps://${controller.store.value.domain}:${controller.store.value.port}/admin\n其他设备仅安装公开 CA 证书，禁止分享 CA 私钥。\n`]
  };
  if (!Object.hasOwn(formats, kind)) throw new Error('不支持的导出类型');
  const [name, contents] = formats[kind];
  const result = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), name) });
  if (!result.canceled && result.filePath) fs.writeFileSync(result.filePath, contents());
  return !result.canceled;
}
if (!locked) app.quit();
else {
  app.on('second-instance', () => show());
  app.whenReady().then(async () => {
    const cipher = {
      encrypt(value) { if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据保护不可用，Token 未保存'); return safeStorage.encryptString(value).toString('base64'); },
      decrypt(value) { if (!safeStorage.isEncryptionAvailable()) throw new Error('无法解密 FRP Token'); return safeStorage.decryptString(Buffer.from(value, 'base64')); }
    };
    try { controller = new Controller({ root, stateDir: app.getPath('userData'), frpc, cliExecutable, cipher }); }
    catch (error) { dialog.showErrorBox('ZViewer 配置读取失败', `${error.message}\n配置目录：${app.getPath('userData')}`); exited = true; app.quit(); return; }
    Menu.setApplicationMenu(null);
    tray = new Tray(icon().resize({ width: 32, height: 32 }));
    tray.on('click', () => show()); tray.on('double-click', () => show());
    win = new BrowserWindow({ width: 1320, height: 910, minWidth: 1040, minHeight: 740, frame: false, show: false, backgroundColor: '#eaf0fb', icon: icon(), title: 'ZViewer · Windows 控制台', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== pathToFileURL(uiFile).href) event.preventDefault(); });
    const guardNavigation = event => {
      if (event.isMainFrame) {
        if (event.url.split('#')[0] !== pathToFileURL(uiFile).href) event.preventDefault();
      } else if (event.url !== 'about:blank' && !controller.cli.allowsFrame(event.url)) event.preventDefault();
    };
    win.webContents.on('will-frame-navigate', guardNavigation);
    win.webContents.on('will-redirect', guardNavigation);
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.webContents.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && ((input.control && input.key.toLowerCase() === 'r') || input.key === 'F5')) { event.preventDefault(); win.webContents.reloadIgnoringCache(); } });
    win.on('close', event => { event.preventDefault(); if (controller.store.value.closeToTray && !quitting) win.hide(); else app.quit(); });
    win.once('ready-to-show', () => show());
    function trusted(event) { if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url.split('#')[0] !== pathToFileURL(uiFile).href) throw new Error('Invalid IPC sender'); }
    ipcMain.handle('desktop-info', event => { trusted(event); return { native: true, live: true, tray: true, version: app.getVersion(), ...controller.snapshot() }; });
    ipcMain.handle('window-action', (event, action) => {
      trusted(event);
      if (action === 'minimize') win.minimize();
      else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
      else if (action === 'close') win.close();
      else if (action === 'tray') win.hide();
      else if (action === 'tray-menu') tray.popUpContextMenu();
    });
    ipcMain.handle('open-docs', event => { trusted(event); return shell.openExternal('https://docx.zviewer.zero251.xyz/'); });
    ipcMain.handle('desktop-command', async (event, action, payload = {}) => {
      trusted(event); if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('无效参数');
      try {
        switch (action) {
          case 'start': return await controller.start();
          case 'stop': return await controller.stop();
          case 'restart': return await controller.restart();
          case 'save': {
            if (!app.isPackaged && payload.config?.launchAtLogin) throw new Error('开机启动请在已构建的桌面程序中设置');
            const result = controller.save(payload.config || {}, payload.token);
            if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: result.launchAtLogin, path: process.env.ZVIEWER_GUI_LAUNCHER || process.execPath, args: [] });
            return result;
          }
          case 'https': return await controller.enableHttps(payload.domain || 'localhost', payload.ip || '');
          case 'trust': {
            const cert = controller.certificates.inspect();
            const answer = await dialog.showMessageBox(win, { type: 'question', buttons: ['取消', '安装本机 CA 信任'], defaultId: 0, cancelId: 0, title: '信任 ZViewer 本机证书', message: '安装到当前 Windows 用户的受信任根证书存储？', detail: `仅信任本机 ZViewer CA。\nSHA-256：${cert.fingerprint || '无有效证书'}` });
            if (answer.response !== 1) return { canceled: true };
            await controller.certificates.trust(true); controller.trusted = true; controller.emit('update', controller.snapshot()); return { trusted: true };
          }
          case 'untrust': await controller.certificates.trust(false); controller.trusted = false; controller.emit('update', controller.snapshot()); return { trusted: false };
          case 'open-manager': await openManager(); return true;
          case 'open-web': await openLocalPage(); return true;
          case 'cli-start': return await controller.startCli();
          case 'cli-stop': return await controller.stopCli();
          case 'cli-save': return controller.saveCli(payload);
          case 'cli-open': {
            return { url: await controller.cliSettingsUrl() };
          }
          case 'frp-start': return await controller.startFrp();
          case 'frp-stop': await controller.stopFrp(); controller.emit('update', controller.snapshot()); return true;
          case 'export': return await exportFile(payload.kind);
          case 'open-data': return shell.openPath(app.getPath('userData'));
          default: throw new Error('不支持的操作');
        }
      } catch (error) { controller.log(error.message, 'console', 'ERROR'); throw new Error(error.message); }
    });
    controller.on('update', snapshot => { updateTray(); if (win && !win.isDestroyed()) win.webContents.send('desktop-update', snapshot); });
    updateTray(); await win.loadFile(uiFile);
    const cert = controller.certificates.inspect();
    if (cert.valid) require('node:child_process').execFile('certutil.exe', ['-user', '-store', 'Root', cert.thumbprint], { windowsHide: true }, error => { controller.trusted = !error; controller.emit('update', controller.snapshot()); });
    if (controller.store.value.autoStart) controller.start().catch(error => controller.log(error.message, 'backend', 'ERROR'));
  }).catch(error => { dialog.showErrorBox('ZViewer 启动失败', error.message); exited = true; app.quit(); });
  app.on('before-quit', event => {
    if (exited || !controller) { tray?.destroy(); return; }
    event.preventDefault(); if (quitting) return; quitting = true;
    (async () => {
      for (let i = 0; controller.operation && i < 600; i++) await new Promise(resolve => setTimeout(resolve, 100));
      await controller.shutdown(); exited = true; tray?.destroy(); win?.destroy(); app.quit();
    })().catch(error => { quitting = false; dialog.showErrorBox('无法停止受管服务', error.message); show('logs'); });
  });
}
