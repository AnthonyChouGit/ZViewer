(() => {
  'use strict';
  const ui = window.ZViewerUI;
  if (!ui || !window.zviewerDesktop) return;
  const { state, icon, esc, heading, button, notice, tutorial } = ui;
  const $ = selector => document.querySelector(selector);
  const labels = { stopped: '未启动', starting: '启动中', running: '运行中', stopping: '停止中', error: '异常', degraded: '待检查', connecting: '连接中', registered: '代理已注册' };
  let initialized = false, busy = false, serviceDraft = null, cliEmbedPending = false, ipv6Pending = false, ipv6Tried = false;
  function current() { return state.server.active || state.config; }
  function pill(status) { return `<span class="pill ${['running','registered'].includes(status) ? 'green' : ''}"><i></i>${labels[status] || status}</span>`; }
  function activity() {
    return state.events.slice(0, 3).map(e => `<div class="activity"><span class="activity-dot"></span><div><strong>${esc({ console: '控制台', backend: '主服务', voice: 'LiveKit 语音', cert: 'HTTPS 证书', frp: 'FRP 穿透', tunnel: 'Cloudflare 隧道', cli: '高画质代理', update: '软件更新' }[e.source] || e.source)}</strong><p>${esc(e.message)}</p></div><time>${esc(e.time)}</time></div>`).join('');
  }
  function overview() {
    const s = state.server, c = current();
    const card = (title, text, name, status, info, pid = s.pid) => `<article class="service-card"><div class="service-top"><span class="icon-box">${icon(name)}</span>${pill(status)}</div><div><h3>${title}</h3><p>${text}</p></div><div class="service-meta"><span>${info}</span><code>${status === 'running' && pid ? `PID ${pid}` : labels[status] || status}</code></div></article>`;
    return heading('服务总览', '本机服务、证书与穿透的运行状态。') +
      `<section class="hero"><div class="hero-copy"><h2>${s.backend === 'running' ? '服务运行中' : s.backend === 'starting' ? '服务启动中' : '服务未启动'}</h2><p>${c.https ? 'https' : 'http'}://localhost:${esc(c.port)}<br>${c.bindHost === '127.0.0.1' ? '仅本机访问' : '局域网监听'} · ${s.backend === 'running' ? '健康检查通过' : '等待启动'}</p><div class="hero-actions">${button(s.pid ? '停止服务' : '启动服务', 'toggle-run', s.pid ? 'stop' : 'play', 'primary')}${button('打开网页端','open-web','globe','primary')}<button class="text-button" data-action="open-manager">打开管理页面 ${icon('external')}</button></div></div></section>` +
      `<div class="section-title"><h2>服务状态</h2><button class="text-button" data-nav="settings">监听端口 ${esc(c.port)} · 修改设置 ${icon('arrow')}</button></div><div class="service-grid">${card('ZViewer 主服务','网页与 API','server',s.backend,`${c.port} / TCP`)}${card('语音与推流','LiveKit 进程','mic',s.voice,`语音 UDP ${c.port} / RTMP ${c.rtmpPort}`,s.voicePid)}${card('FRP 穿透','frpc 代理','network',s.frp,s.frpcAvailable ? 'frpc 0.71.1' : '未找到 frpc')}</div>` +
      `<div class="bottom-grid"><section><div class="section-title"><h2>常用操作</h2><small>快捷入口</small></div><div class="setup-list"><button class="setup-row" data-nav="cert"><span class="step">${icon('lock')}</span><div><strong>签发本机 HTTPS 证书</strong><p>签发 localhost 证书并启用 HTTPS</p></div>${icon('arrow')}</button><button class="setup-row" data-nav="frp"><span class="step">${icon('network')}</span><div><strong>配置 FRP 服务器</strong><p>填写 VPS 地址与端口映射</p></div>${icon('arrow')}</button><button class="setup-row" data-nav="settings"><span class="step">${icon('settings')}</span><div><strong>修改监听端口</strong><p>保存后下次启动生效</p></div>${icon('arrow')}</button></div></section><section><div class="section-title"><h2>最近活动</h2><button class="text-button" data-nav="logs">全部日志 ${icon('arrow')}</button></div><div class="activity-list">${activity()}</div></section></div><div class="footnote">${icon('info')}显示本地进程状态；FRP 外网访问需在 VPS 部署后验证。</div>`;
  }
  function frpCode(server = false) {
    const f = state.frp, c = state.config;
    const header = 'auth.method = "token"\nauth.token = "{{ .Envs.FRP_TOKEN }}"';
    if (server) return `# VPS 上的 frps.toml\n# 部署前设置与本机一致的 FRP_TOKEN\nbindPort = ${Number(f.port) || 7000}\n${header}\ntransport.tls.force = true\n`;
    const proxy = (name, type, local, remote) => `\n[[proxies]]\nname = "zviewer-${name}"\ntype = "${type}"\nlocalIP = "127.0.0.1"\nlocalPort = ${local}\nremotePort = ${Number(remote)}\n`;
    return `serverAddr = ${JSON.stringify(f.host || 'YOUR_VPS_IP')}\nserverPort = ${Number(f.port) || 7000}\n${header}\ntransport.tls.enable = true\n${proxy('backend','tcp',c.port,f.webPort)}${f.voice ? proxy('voice','udp',c.port,f.voicePort) : ''}${f.rtmp ? proxy('rtmp','tcp',c.rtmpPort,f.rtmpPort) : ''}${f.tcp ? proxy('voice-tcp','tcp',c.livekitTcpPort || 3337,f.tcpPort) : ''}`;
  }
  function frp() {
    return ui.preview.frp()
      .replace('<span class="pill orange"><i></i>未连接</span>', pill(state.server.frp))
      .replace('不保存、不导出明文', state.server.tokenSaved ? '已加密保存，可输入新 Token 替换' : '使用 Windows DPAPI 加密保存')
      .replace('输入内容不会保存。', '留空保留已保存 Token。')
      .replace('<div class="panel-line"></div>', `<label class="field"><span>语音公布地址 <small>VPS 公网 IPv4，修改后重启服务</small></span><input data-frp-field="advertiseIp" value="${esc(state.frp.advertiseIp || '')}" placeholder="例如 203.0.113.10"></label><span class="field-note">外网语音需公布 VPS 地址。UDP 本地端口随网页使用 ${esc(state.config.port)}，TCP 语音使用 ${esc(state.config.livekitTcpPort || 3337)}；公布地址时，语音远端映射需与对应本地端口一致。留空时只建立隧道，语音可达性需另外配置。</span><div class="panel-line"></div>`)
      .replace('传输 TLS 与网页 HTTPS 独立配置。', '点击“连接 FRP”后，程序会先校验配置，再连接服务器。')
      .replace('UDP 语音需放行对应 UDP 端口；选用 TCP 语音时，管理端语音模式需同步设为 TCP。', `UDP 语音跟随网页端口 ${esc(state.config.port)}，RTC TCP 使用 ${esc(state.config.livekitTcpPort)}。请在 VPS 放行所选映射；信令经网页入口转发，无需单独映射内部信令端口。`)
      .replace('<div class="form-actions">', `<div class="form-actions">${button('保存配置','save-frp','check')}${button(['connecting','registered'].includes(state.server.frp) ? '断开 FRP' : '连接 FRP','toggle-frp','network','primary')}`)
      .replaceAll('>3333</code>', `>${esc(state.config.port)}</code>`)
      .replace('>3334</code>', `>${esc(state.config.rtmpPort)}</code>`)
      .replace('>3337</code>', `>${esc(state.config.livekitTcpPort || 3337)}</code>`);
  }
  function cert() {
    const s = state.server.certificate, c = state.config;
    return heading('证书与域名', '签发 localhost 证书、安装当前用户信任，再打开管理页面。', tutorial('cert')) +
      `<div class="form-layout"><section class="panel"><div class="panel-heading"><h2>本机 localhost</h2>${pill(s.valid ? 'running' : 'stopped')}</div><p class="wizard-copy">无需填写域名与 IP。程序将签发 localhost 证书，启用 HTTPS，并保留现有服务端口；局域网与公网设备访问需另行准备证书。</p><div class="dns-example">https://localhost:${esc(c.port)}/admin</div>${notice('证书由本机专用 CA 签发。私钥仅保存在当前用户配置目录；安装信任时将显示证书指纹。')}<div class="check-item">${icon('check')}<div><strong>1. 签发证书并启用 HTTPS</strong><br>已有有效证书直接复用；运行中的服务会重启。</div></div><div class="check-item">${icon('shield')}<div><strong>2. 安装本机信任</strong><br>只安装到当前 Windows 用户，可撤销。</div></div><div class="check-item">${icon('external')}<div><strong>3. 打开管理页面</strong><br>直接访问 /admin，由服务端处理登录。</div></div><div class="live-toolbar">${button('签发并启用 HTTPS','local-cert','lock','primary')}${s.valid && !s.trusted ? button('安装本机信任','trust-cert','shield') : ''}${s.trusted ? button('打开管理页面','open-manager','external') : ''}</div></section><aside class="panel"><div class="certificate">${icon('shield')}<div class="eyebrow">证书预览</div><h3>${esc(s.exists ? c.domain : 'localhost')}</h3><p>${s.valid ? `有效期至 ${esc(s.validTo)}` : '尚未签发证书'}<br>${s.trusted ? '当前用户已信任' : '当前用户尚未安装信任'}</p></div><div class="meta-list"><div class="meta-line"><span>监听端口</span><span>${esc(c.port)}</span></div><div class="meta-line"><span>HTTPS 配置</span><span>${c.https ? '已启用' : '未启用'}</span></div><div class="meta-line"><span>证书 SAN</span><span>${esc(s.san || 'localhost / 127.0.0.1 / ::1')}</span></div></div>${s.fingerprint ? `<p class="certificate-fingerprint">CA SHA-256<br>${esc(s.fingerprint)}</p>` : ''}<div class="live-toolbar">${s.valid ? button('导出公开 CA','export-ca','download') : ''}${s.trusted ? button('撤销本机信任','untrust-cert','shield') : ''}</div></aside></div>`;
  }
  function serviceValues() {
    return {
      port: $('#service-port').value,
      rtmpPort: $('#rtmp-port').value,
      flvPort: $('#flv-port').value,
      bindHost: $('#bind-host').value,
      https: $('#service-https').getAttribute('aria-checked') === 'true',
      livekitPort: $('#livekit-port').value,
      livekitTcpPort: $('#livekit-tcp-port').value
    };
  }
  function settings() {
    const c = { ...state.config, ...serviceDraft };
    function field(id, label, value) { return `<label class="field"><span>${label}</span><input id="${id}" type="number" min="1" max="65535" value="${esc(value)}"></label>`; }
    function toggle(key, label, help) { return `<div class="switch-row"><div><strong>${label}</strong><p>${help}</p></div><button class="switch" role="switch" aria-label="${label}" aria-checked="${state.config[key]}" data-live-pref="${key}"></button></div>`; }
    return heading('应用设置','调整监听端口与启动行为，保存后生效。') +
      `<div class="settings-grid"><section><div class="panel network-settings"><div class="panel-heading"><h2>监听端口与网络</h2><span class="pill">保存后下次启动生效</span></div>
        <div class="settings-form">
          <div class="form-row triple">${field('service-port','网页 / 管理页面',c.port)}${field('rtmp-port','RTMP 推流',c.rtmpPort)}${field('flv-port','HTTP-FLV',c.flvPort)}</div>
          <label class="field"><span>网页与信令监听范围</span><select id="bind-host"><option value="127.0.0.1" ${c.bindHost === '127.0.0.1' ? 'selected' : ''}>仅本机 · 127.0.0.1</option><option value="0.0.0.0" ${c.bindHost === '0.0.0.0' ? 'selected' : ''}>局域网 IPv4 · 0.0.0.0</option><option value="::" ${c.bindHost === '::' ? 'selected' : ''}>IPv4 / IPv6 · 双栈</option></select></label>
          <div class="switch-row service-https-row"><div><strong id="service-https-title">使用 HTTPS</strong><p id="service-https-help">首次启动时自动签发本机证书；浏览器信任可在“本机 HTTPS”中单独安装。</p></div><button type="button" class="switch" id="service-https" role="switch" aria-labelledby="service-https-title" aria-describedby="service-https-help" aria-checked="${Boolean(c.https)}"></button></div>
          <div class="livekit-settings"><div class="settings-subheading"><h3>LiveKit 高级端口</h3><span>语音与实时通信</span></div>
            <div class="form-row triple"><div class="field udp-follow-field"><span>语音 UDP</span><output id="livekit-udp-port" for="service-port">${esc(c.port)}</output><small>跟随网页端口</small></div>${field('livekit-port','信令 / WebSocket',c.livekitPort ?? 3336)}${field('livekit-tcp-port','语音 RTC TCP',c.livekitTcpPort ?? 3337)}</div>
            <p class="field-note livekit-settings-note">UDP 与网页使用相同端口号，协议不同可同时监听。信令和 RTC TCP 可分别调整，保存后重启服务生效；使用 FRP 时请同步检查语音映射。</p>
          </div>
          <div class="form-actions">${button('保存配置','save-service','check','primary')}${state.server.pid ? button('重启使配置生效','restart','refresh') : ''}</div>
        </div>
      </div><div class="panel section-title"><div><h2>窗口与系统托盘</h2>${toggle('closeToTray','关闭窗口时隐藏到托盘','从通知区域恢复窗口。')}${toggle('launchAtLogin','登录 Windows 后启动','仅对当前用户生效，可关闭。')}${toggle('autoStart','打开控制台时自动启动服务','使用上次保存的端口、HTTPS 与监听范围。')}</div></div></section>
      <aside class="panel"><div class="about-mark"><img src="app-icon.png" alt="ZViewer"><div><h2>ZViewer</h2><p>WINDOWS DESKTOP</p></div></div><div class="version">${esc(state.info.version)} <small>LOCAL BUILD</small></div><p class="settings-description">配置自动保存在当前 Windows 用户目录。FRP Token 由 Windows DPAPI 加密保存。</p><div class="panel-line"></div><div class="subheading">当前运行包</div><p class="runtime-path">${esc(state.server.root)}</p><div class="file-check"><span>后端</span><span>${state.info.runtime.backend ? '已检测到' : '缺失'}</span></div><div class="file-check"><span>FRP 0.71.1</span><span>${state.server.frpcAvailable ? '已检测到' : '缺失'}</span></div><div class="file-check"><span>ZViewerCLI</span><span>${state.server.cli?.available ? '已检测到' : '缺失'}</span></div><div class="live-toolbar">${button('配置文件夹','open-data','folder')}${button('托盘菜单','tray-preview','tray')}</div></aside></div>`;
  }
  function logs() {
    return ui.preview.logs().replace('查看控制台操作记录；后端日志在服务接入后显示。','查看控制台、后端、证书、FRP 与高画质代理的运行记录。')
      .replaceAll('操作记录','运行日志').replace('仅演示事件，未读取服务日志','已屏蔽已知凭据，日志最大保留 500 条')
      .replace('按来源分流，达到 2 MB 后滚动保存；导出前屏蔽 Token、JWT 与私钥。','日志按来源过滤，单文件达到 2 MB 后滚动保存。LiveKit 日志显示为 voice 来源，高画质代理显示为 cli 来源。')
      .replace('>INFO</option>','>INFO</option><option value="ERROR">ERROR</option>');
  }
  function cliViewKey(snapshot) { const c = snapshot?.active || snapshot?.config; return JSON.stringify([snapshot?.cli, snapshot?.webUrl, c?.port, c?.https, snapshot?.config?.cli?.user]); }
  function validatedCliUrl(value) {
    if (typeof value !== 'string' || value.length > 4096) throw new Error('无效的本机 CLI 设置地址');
    const url = new URL(value), port = Number(url.port || 80);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.hash || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CLI 设置仅允许本机 HTTP 地址');
    url.searchParams.set('desktop', '1');
    return url.href;
  }
  function syncCliEmbed(snapshot) {
    if (!state.cliEmbedUrl) return false;
    const previous = state.cliEmbedUrl;
    if (!['starting', 'running'].includes(snapshot.cli?.state)) state.cliEmbedUrl = '';
    else {
      // The iframe origin comes from cli-open; these query values come only from native state.
      const url = new URL(previous), c = snapshot.active || snapshot.config;
      const backend = snapshot.webUrl || `${c.https ? 'https' : 'http'}://localhost:${c.port}/`;
      url.searchParams.set('server', backend);
      const user = snapshot.config?.cli?.user || '';
      if (user) url.searchParams.set('user', user); else url.searchParams.delete('user');
      state.cliEmbedUrl = validatedCliUrl(url.href);
    }
    return previous !== state.cliEmbedUrl;
  }
  function sync(snapshot, initial = false) {
    const cliBefore = cliViewKey(state.server), tunnelBefore = tunnelKey(state.server), entryBefore = entryKey(state.server);
    const embedChanged = syncCliEmbed(snapshot);
    state.server = snapshot; state.events = snapshot.events; state.info.runtime = snapshot.runtime;
    // 配置随快照更新，端口或 HTTPS 改变后连接方式页不会残留旧地址。
    state.config = structuredClone(snapshot.config);
    if (initial) state.frp = structuredClone(snapshot.config.frp);
    if (initial || state.page === 'overview' || state.page === 'cli' && (embedChanged || cliBefore !== cliViewKey(snapshot)) || state.page === 'connect' && (tunnelBefore !== tunnelKey(snapshot) || entryBefore !== entryKey(snapshot))) ui.render();
    else if (state.page === 'logs' && !state.paused) ui.refreshLogs();
    else if (state.page === 'connect') ensureIPv6();
    ui.preview.syncUpdate(snapshot);
    ui.syncWorkspace?.();
    $('#footer-status').textContent = snapshot.backend === 'running' ? `本地服务运行中 · ${current().port}` : `本地服务 · ${labels[snapshot.backend]}`;
  }
  function tunnelKey(snapshot) { const t = snapshot?.tunnel; return t ? `${t.available}|${t.state}|${t.url}` : ''; }
  // 外部访问地址由主服务端口与 HTTPS 决定，两者变化都要重绘入口卡片。
  function entryKey(snapshot) { const c = snapshot?.active || snapshot?.config || {}; return `${c.port}|${c.https}`; }
  // 首次进入“连接方式”页时探测公网 IPv6；结果缓存在 state.ipv6，手动刷新时重新探测。
  function ensureIPv6() {
    if (state.ipv6 !== null || ipv6Pending || ipv6Tried || state.page !== 'connect') return;
    ipv6Pending = true; ipv6Tried = true;
    window.zviewerDesktop.command('probe-ipv6', {})
      .then(report => { state.ipv6 = report; if (state.page === 'connect') ui.render(); })
      .catch(error => ui.toast(error.message.replace(/^.*Error: /, '')))
      .finally(() => { ipv6Pending = false; });
  }
  async function command(action, payload) {
    if (busy) { ui.toast('正在处理上一项操作，请稍后'); return; }
    busy = true; document.body.classList.add('live-busy');
    try {
      const result = await window.zviewerDesktop.command(action, payload);
      const snapshot = await window.zviewerDesktop.info(); sync(snapshot, true);
      return result;
    } finally { busy = false; document.body.classList.remove('live-busy'); if (action !== 'cli-open') setTimeout(ensureCliEmbed, 0); }
  }
  function ensureCliEmbed() {
    if (cliEmbedPending || busy || state.page !== 'cli' || state.server?.cli?.state !== 'running' || state.cliEmbedUrl) return;
    cliEmbedPending = true;
    act('cli-open').catch(error => ui.toast(error.message.replace(/^.*Error: /, ''))).finally(() => { cliEmbedPending = false; });
  }
  window.addEventListener('zviewer-cli-visible', () => setTimeout(ensureCliEmbed, 0));
  async function act(action) {
    if (action === 'toggle-run') { await command(state.server.pid ? 'stop' : 'start'); ui.toast(state.server.backend === 'running' ? '服务已启动' : '服务已停止'); }
    else if (action === 'restart') { await command('restart'); ui.toast('服务已使用保存的配置重启'); }
    else if (action === 'open-manager') await command('open-manager');
    else if (action === 'open-web') await command('open-web');
    else if (action === 'cli-start' || action === 'cli-open') {
      const result = await command('cli-open');
      if (result?.url) { state.cliEmbedUrl = validatedCliUrl(result.url); ui.render(); if (action === 'cli-start') ui.toast('高画质代理已启动，可在右侧完成配置'); }
    }
    else if (action === 'cli-stop') { await command('cli-stop'); ui.toast('高画质代理已停止'); }
    else if (action === 'cli-save') { await command('cli-save', cliValues()); state.cliDraft = null; ui.render(); ui.toast('代理配置已保存，内置设置会自动带入后端地址'); }
    else if (action === 'local-cert') {
      await command('https',{domain:'localhost',ip:''}); ui.render(); ui.toast('HTTPS 已就绪，请安装本机信任后打开管理页面');
    } else if (action === 'trust-cert' || action === 'untrust-cert') { const result = await command(action === 'trust-cert' ? 'trust' : 'untrust'); ui.render(); ui.toast(result?.canceled ? '已取消安装信任' : '本机信任状态已更新'); }
    else if (action === 'save-service') {
      const config = serviceValues();
      await command('save',{config}); serviceDraft = null; ui.render(); ui.toast('配置已保存，下次启动服务自动使用；运行中可点击重启生效');
    } else if (action === 'save-frp') {
      const token = $('#frp-token').value;
      await command('save',{config:{frp:state.frp},token:token || undefined}); ui.render(); ui.toast('FRP 配置已保存，Token 已通过 Windows 加密保护');
    } else if (action === 'toggle-frp') { await command(['connecting','registered'].includes(state.server.frp) ? 'frp-stop' : 'frp-start'); ui.render(); }
    else if (action === 'export-frp') await command('export',{kind:state.frpTab === 'server' ? 'frps' : 'frpc'});
    else if (action === 'probe-ipv6') {
      const report = await window.zviewerDesktop.command('probe-ipv6', {});
      state.ipv6 = report; ui.render();
      ui.toast(report.ok ? `公网 IPv6：${report.address}` : '没有探测到公网 IPv6');
    }
    else if (action === 'tunnel-start') { await command('tunnel-start'); ui.render(); ui.toast('正在建立 Cloudflare 隧道，地址显示后即可使用'); }
    else if (action === 'tunnel-stop') { await command('tunnel-stop'); ui.render(); ui.toast('Cloudflare 隧道已停止'); }
    else if (action === 'export-logs') await command('export',{kind:'logs'});
    else if (action === 'export-ca') await command('export',{kind:'ca'});
    else if (action === 'open-data') await command('open-data');
  }
  const actions = new Set(['toggle-run','restart','open-manager','open-web','cli-start','cli-stop','cli-open','cli-save','local-cert','trust-cert','untrust-cert','save-service','save-frp','toggle-frp','export-frp','export-logs','export-ca','open-data','probe-ipv6','tunnel-start','tunnel-stop']);
  function cliValues() { return { port: $('#cli-port').value, autoStart: $('#cli-auto-start').getAttribute('aria-checked') === 'true', user: $('#cli-user').value.trim() }; }
  document.addEventListener('click',event => {
    if (!state.live) return;
    const cliSwitch = event.target.closest('#cli-auto-start');
    if (cliSwitch) {
      event.preventDefault(); event.stopImmediatePropagation();
      cliSwitch.setAttribute('aria-checked', String(cliSwitch.getAttribute('aria-checked') !== 'true'));
      state.cliDraft = cliValues(); return;
    }
    const httpsSwitch = event.target.closest('#service-https');
    if (httpsSwitch) {
      event.preventDefault(); event.stopImmediatePropagation();
      httpsSwitch.setAttribute('aria-checked', String(httpsSwitch.getAttribute('aria-checked') !== 'true'));
      serviceDraft = serviceValues(); return;
    }
    const pref = event.target.closest('[data-live-pref]');
    if (pref) {
      event.preventDefault(); event.stopImmediatePropagation();
      if ($('#service-port')) serviceDraft = serviceValues();
      command('save',{config:{[pref.dataset.livePref]:!state.config[pref.dataset.livePref]}}).then(()=>ui.render()).catch(error=>ui.toast(error.message.replace(/^.*Error: /,''))); return;
    }
    const btn=event.target.closest('[data-action]');
    if (btn && actions.has(btn.dataset.action)) {
      event.preventDefault(); event.stopImmediatePropagation();
      act(btn.dataset.action).catch(error=>ui.toast(error.message.replace(/^.*Error: /,'')));
    }
  },true);
  document.addEventListener('input', event => {
    if (state.live && event.target.matches('#cli-port,#cli-user')) { state.cliDraft = cliValues(); return; }
    if (!state.live || !event.target.matches('#service-port,#rtmp-port,#flv-port,#bind-host,#livekit-port,#livekit-tcp-port')) return;
    serviceDraft = serviceValues();
    $('#livekit-udp-port').textContent = $('#service-port').value || '—';
  });
  function init(info) {
    if (initialized) return; initialized = true;
    state.live = true; state.info = info; state.native = true;
    state.views = { overview, connect: ui.preview.connect, frp, cert, cli: ui.preview.cli, logs, settings }; state.frpConfigOverride = frpCode;
    const buildLabel = $('.build-label');
    if (buildLabel) buildLabel.textContent = `WINDOWS DESKTOP · ${info.version}`;
    const status = $('.statusbar > span:last-child');
    if (status) status.innerHTML = `Windows 桌面控制台<span class="footer-separator">/</span>版本 ${esc(info.version)}`;
    sync(info,true);
    ensureIPv6();
    window.zviewerDesktop.onUpdate(snapshot => sync(snapshot));
  }
  window.addEventListener('hashchange', () => setTimeout(ensureIPv6, 0));
  window.addEventListener('zviewer-ready',event=>init(event.detail));
  if (state.info?.live) init(state.info);
})();
