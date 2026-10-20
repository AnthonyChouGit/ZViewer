(() => {
  'use strict';
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    network: '<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v6M5 17v-4h14v4"/>',
    shield: '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
    settings: '<path d="m9 3-1 3-3 1-2 4 2 3v4l4 2 3-1 3 1 4-2v-4l2-3-2-4-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
    monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    book: '<path d="M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-3-1-7-2-10 1v15"/>',
    tray: '<path d="M4 15h4l2 3h4l2-3h4l-2-9H6Z"/><path d="M4 15v6h16v-6M12 2v9m-3-3 3 3 3-3"/>',
    play: '<path d="m8 4 12 8-12 8Z"/>',
    watch: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4Z"/>',
    screenShare: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4m0-7V7m-3 3 3-3 3 3"/>',
    music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
    danmaku: '<rect x="3" y="4" width="18" height="15" rx="3"/><path d="M7 8h5m3 0h2M7 12h2m3 0h5M7 16h7"/>',
    chat: '<path d="M21 11a8 8 0 0 1-8 8H8l-5 3 1-6a8 8 0 0 1-1-5 9 9 0 0 1 18 0Z"/><path d="M8 11h.01m4 0h.01m4 0h.01"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    external: '<path d="M14 3h7v7m0-7L10 14m0-10H4v16h16v-6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
    cloud: '<path d="M6 19a5 5 0 1 1 0-10 7 7 0 0 1 13-2 6 6 0 0 1 0 12Z"/>',
    server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01m5-11h5m-5 11h5"/>',
    mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5m-5-1a8 8 0 0 1 14-6l2 3M4 16l2 3a8 8 0 0 0 14-6"/>',
    pause: '<path d="M8 4v16M16 4v16"/>',
    folder: '<path d="M3 6h7l2 3h9v12H3Zm0 0V3h7l2 3h9v3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = selector => document.querySelector(selector);
  const titles = { overview: '服务总览', frp: 'FRP 穿透', cert: '证书与域名', cli: '高画质代理', logs: '运行日志', settings: '应用设置' };
  let prefs = { closeToTray: true, remember: true };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('zviewer-ui-prefs') || '{}') }; } catch { /* Use safe defaults if storage is unavailable. */ }
  const state = {
    page: 'overview', running: false, certReady: false, native: false, info: null,
    frpTab: 'client', certMode: 'local', certStep: 1, certDomain: 'zviewer.home.arpa', certIp: '192.168.1.100',
    frp: { host: '', port: 7000, voice: true, rtmp: true, tcp: false, webPort: 3333, voicePort: 3333, rtmpPort: 3334, tcpPort: 3337 },
    logLevel: 'all', logSource: 'all', logSearch: '', paused: false, cliDraft: null, cliEmbedUrl: '',
    events: [], prefs
  };
  function clock() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }
  function addEvent(message, source = 'console', level = 'INFO') { state.events.unshift({ time: clock(), source, level, message }); state.events.length = Math.min(state.events.length, 100); }
  addEvent('控制台已就绪，未改动后端与网络配置。');
  addEvent('本机 HTTPS 默认使用 localhost。', 'cert');
  addEvent('FRP 模板已生成，未连接服务器。', 'frp');
  function icons() { document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('visible'), 4000); }
  function heading(title, subtitle, right = '') { return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${right}</div>`; }
  function button(label, action, name, cls = '') { return `<button class="btn ${cls}" data-action="${action}">${name ? icon(name) : ''}${label}</button>`; }
  function notice(text, warm = false) { return `<div class="notice ${warm ? 'warm' : ''}">${icon('info')}<div>${text}</div></div>`; }
  function download(name, text, mime = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function modal(content) { $('#modal-content').innerHTML = content; $('#modal').showModal(); }
  function setRunning(running, notify = true) {
    state.running = !!running;
    if (notify) window.zviewerDesktop?.demoState(state.running).catch(() => toast('托盘状态同步失败，请重新打开窗口。'));
    addEvent(state.running ? '演示状态已开启，未运行实际后端。' : '演示状态已停止。', 'backend');
    render();
    toast(state.running ? '演示状态：未启动后端' : '演示已停止');
  }
  function activity() { return state.events.slice(0, 3).map(e => `<div class="activity"><span class="activity-dot"></span><div><strong>${esc(e.source === 'frp' ? '穿透配置' : e.source === 'cert' ? '本机 HTTPS' : e.source === 'backend' ? '演示状态' : '控制台')}</strong><p>${esc(e.message)}</p></div><time>${esc(e.time)}</time></div>`).join(''); }
  function overview() {
    const service = (name, subtitle, ico, color, status, left, right) => `<article class="service-card"><div class="service-top"><span class="icon-box ${color}">${icon(ico)}</span><span class="pill ${status.includes('演示') ? 'green' : ''}"><i></i>${status}</span></div><div><h3>${name}</h3><p>${subtitle}</p></div><div class="service-meta"><span>${left}</span><code>${right}</code></div></article>`;
    return heading('服务总览', '本机服务、证书与穿透的运行状态。') +
      `<section class="hero"><div class="hero-copy"><h2>${state.running ? '演示运行中' : '服务未启动'}</h2><p>${state.running ? '界面演示，未连接真实后端。' : '启动本机服务后，可访问网页端与管理页面。'}</p><div class="hero-actions">${button(state.running ? '停止演示' : '启动演示', 'toggle-run', state.running ? 'stop' : 'play', 'primary')}<button class="text-button" data-action="open-manager">打开管理页面 ${icon('external')}</button></div></div></section>` +
      `<div class="section-title"><h2>服务状态</h2><small>演示数据</small></div><div class="service-grid">${service('ZViewer 主服务', '网页与 API', 'server', 'orange', state.running ? '演示运行' : '未启动', '默认监听端口', ':3333 / TCP')}${service('语音与推流', '语音与 RTMP 推流', 'mic', 'green', state.running ? '演示待就绪' : '未启动', '默认语音 / 推流', ':3333 / :3334')}${service('FRP 穿透', '经 VPS 转发', 'network', '', '待配置', '穿透客户端', 'frpc → frps')}</div>` +
      `<div class="bottom-grid"><section><div class="section-title"><h2>常用操作</h2><small>快捷入口</small></div><div class="setup-list"><button class="setup-row" data-nav="cert"><span class="step">${icon('lock')}</span><div><strong>签发本机 HTTPS 证书</strong><p>为 localhost 签发证书并启用 HTTPS</p></div>${icon('arrow')}</button><button class="setup-row" data-nav="frp"><span class="step">${icon('network')}</span><div><strong>配置 FRP 服务器</strong><p>填写 VPS 地址与端口映射</p></div>${icon('arrow')}</button><button class="setup-row" data-nav="settings"><span class="step">${icon('tray')}</span><div><strong>关闭到托盘</strong><p>关闭窗口后在通知区域保留图标</p></div>${icon('arrow')}</button></div></section><section><div class="section-title"><h2>最近活动</h2><button class="text-button" data-nav="logs">全部日志 ${icon('arrow')}</button></div><div class="activity-list">${activity()}</div></section></div><div class="footnote">${icon('info')}界面原型：服务、连接与证书操作均为演示。</div>`;
  }
  function validPort(value) { return /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 65535; }
  function validHost(value) {
    if (/^[\d.]+$/.test(value)) return value.split('.').length === 4 && value.split('.').every(v => /^\d{1,3}$/.test(v) && Number(v) <= 255);
    if (value.includes(':')) { try { return new URL(`http://[${value}]`).hostname.includes(':'); } catch { return false; } }
    return value.length <= 253 && value.split('.').every(v => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(v));
  }
  function frpError() {
    const c = state.frp;
    if (!c.host || !validHost(c.host)) return '请填写合法 VPS IP 或域名，不包含协议、路径与端口。';
    if (!validPort(c.port)) return '控制端口应为 1–65535 的整数。';
    const items = [['webPort', 'tcp'], ...(c.voice ? [['voicePort', 'udp']] : []), ...(c.rtmp ? [['rtmpPort', 'tcp']] : []), ...(c.tcp ? [['tcpPort', 'tcp']] : [])];
    if (items.some(([k]) => !validPort(c[k]))) return '远端端口应为 1–65535 的整数。';
    const ids = items.map(([k, proto]) => `${proto}:${Number(c[k])}`);
    if (new Set(ids).size !== ids.length) return '同一协议的远端端口存在冲突，请使用不同端口。';
    return '';
  }
  function frpConfig(server = false) {
    if (state.live && state.frpConfigOverride) return state.frpConfigOverride(server);
    const c = state.frp, token = 'auth.method = "token"\nauth.token = "{{ .Envs.FRP_TOKEN }}"';
    if (server) return `# VPS 上的 frps.toml · 部署前设置 FRP_TOKEN\n# 此模板未包含真实 Token\nbindPort = ${validPort(c.port) ? Number(c.port) : 7000}\n${token}\ntransport.tls.force = true\n\n# 在 VPS 安全组与防火墙放行：\n# ${validPort(c.port) ? Number(c.port) : 7000}/tcp（控制端口）\n# ${Number(c.webPort)}/tcp（网页）${c.voice ? `\n# ${Number(c.voicePort)}/udp（语音）` : ''}${c.rtmp ? `\n# ${Number(c.rtmpPort)}/tcp（RTMP）` : ''}${c.tcp ? `\n# ${Number(c.tcpPort)}/tcp（TCP语音）` : ''}\n`;
    const proxy = (name, type, localPort, remotePort) => `\n[[proxies]]\nname = "zviewer-${name}"\ntype = "${type}"\nlocalIP = "127.0.0.1"\nlocalPort = ${localPort}\nremotePort = ${validPort(remotePort) ? Number(remotePort) : localPort}\n`;
    return `# 本机 frpc.toml · 部署前设置 FRP_TOKEN\n# 传输 TLS ≠ 浏览器 HTTPS\nserverAddr = ${JSON.stringify(c.host || 'YOUR_VPS_IP')}\nserverPort = ${validPort(c.port) ? Number(c.port) : 7000}\n${token}\ntransport.tls.enable = true\n${proxy('backend', 'tcp', 3333, c.webPort)}${c.voice ? proxy('voice', 'udp', 3333, c.voicePort) : ''}${c.rtmp ? proxy('rtmp', 'tcp', 3334, c.rtmpPort) : ''}${c.tcp ? proxy('voice-tcp', 'tcp', 3337, c.tcpPort) : ''}`;
  }
  function frp() {
    const c = state.frp;
    function row(title, field, type, local, remote, checked, fixed = false) { return `<div class="mapping"><label><input class="checkbox" type="checkbox" data-frp-check="${field}" ${checked ? 'checked' : ''} ${fixed ? 'disabled' : ''}>${title}</label><span class="proto">${type}</span><code>${local}</code><span class="muted">→</span><input aria-label="${title}远端端口" type="number" min="1" max="65535" data-frp-field="${remote}" value="${esc(c[remote])}"></div>`; }
    return heading('FRP 穿透', '通过自有 VPS 转发本机服务。', '<span class="pill orange"><i></i>未连接</span>') +
      `<div class="form-layout"><section class="panel"><div class="panel-heading"><div class="panel-heading-title"><span class="icon-box">${icon('cloud')}</span><h2>FRP 服务器</h2></div><small>自建 frps</small></div><div class="form-row"><label class="field"><span>VPS 地址</span><input id="frp-host" data-frp-field="host" value="${esc(c.host)}" placeholder="例如 frp.example.com" autocomplete="off" maxlength="253"></label><label class="field"><span>控制端口</span><input data-frp-field="port" aria-label="FRP 控制端口" type="number" value="${esc(c.port)}" min="1" max="65535"></label></div><label class="field"><span>认证 Token <small>不保存、不导出明文</small></span><input id="frp-token" type="password" placeholder="与 VPS 上的 frps 保持一致" autocomplete="off"></label><span class="field-note">导出模板从 FRP_TOKEN 环境变量读取凭据。输入内容不会保存。</span><div class="panel-line"></div><div class="panel-heading no-margin"><h2>端口映射</h2><small>本地 → 公网 VPS</small></div><div class="mapping mapping-head"><span>服务</span><span>协议</span><span>本地</span><span></span><span>远端</span></div>${row('网页服务', 'web', 'TCP', 3333, 'webPort', true, true)}${row('UDP 语音', 'voice', 'UDP', 3333, 'voicePort', c.voice)}${row('RTMP 推流', 'rtmp', 'TCP', 3334, 'rtmpPort', c.rtmp)}${row('TCP 语音', 'tcp', 'TCP', 3337, 'tcpPort', c.tcp)}<div class="help-card"><strong>语音需单独放行</strong><p>UDP 语音需放行对应 UDP 端口；选用 TCP 语音时，管理端语音模式需同步设为 TCP。</p></div><div class="validation" id="frp-error" role="alert"></div><div class="form-actions">${button('查看文档', 'docs', 'book')}${button('导出配置模板', 'export-frp', 'download', 'primary')}</div></section><section><div class="panel"><div class="panel-heading"><h2>配置预览</h2><span class="tag-caption">TOML · 自动生成</span></div><div class="tabs"><button data-frp-tab="client" class="${state.frpTab === 'client' ? 'active' : ''}">本机 frpc.toml</button><button data-frp-tab="server" class="${state.frpTab === 'server' ? 'active' : ''}">VPS frps.toml</button></div><pre class="codebox" id="frp-code">${esc(frpConfig(state.frpTab === 'server'))}</pre><div class="code-footer"><span>凭据采用环境变量占位，未写入明文</span><button class="text-button" data-action="copy-frp">${icon('copy')}复制</button></div><div class="path-flow"><div class="flow-item">${icon('globe')}外网设备</div><span>→</span><div class="flow-item">${icon('cloud')}VPS / frps</div><span>→</span><div class="flow-item">${icon('monitor')}本机 / frpc</div></div></div><div class="help-card"><strong>部署步骤</strong><p>两台机器使用同一 FRP_TOKEN；部署 frps 并放行端口，再用 frpc verify 校验配置。传输 TLS 与网页 HTTPS 独立配置。</p></div></section></div>`;
  }
  function certPreview() {
    const local = state.certMode === 'local', domain = local ? 'localhost' : state.certDomain;
    return `<div class="certificate">${icon('shield')}<div class="eyebrow">证书预览</div><h3 id="cert-preview-domain">${esc(domain)}</h3><p>${local ? '本机访问，无需配置 DNS 或 hosts。' : '用于内网设备，需额外配置域名解析。'}<br>本地自签，尚未签发</p></div><div class="meta-list"><div class="meta-line"><span>管理页面地址</span><span id="cert-preview-url">https://${esc(domain)}:3333</span></div><div class="meta-line"><span>签发方式</span><span>${local ? '现有 zviewer-cert.exe · localhost' : '本地 CA · 高级配置'}</span></div><div class="meta-line"><span>证书状态</span><span>${state.certReady ? '已演示' : '未签发'}</span></div><div class="meta-line"><span>浏览器信任</span><span>首次使用需要单独安装信任</span></div></div><div class="check-item">${icon('check')}<div><strong>localhost 仅用于本机</strong><br>打开管理页面不需要路由器或公网域名。</div></div><div class="check-item">${icon('lock')}<div><strong>私钥仅保存在本机</strong><br>只导出公开证书，根 CA 私钥不可分享。</div></div>`;
  }
  function cert() {
    const local = state.certMode === 'local';
    let content;
    if (local) {
      content = `<div class="panel-heading"><div class="panel-heading-title"><span class="icon-box orange">${icon('monitor')}</span><h2>本机 localhost</h2></div><span class="pill green">推荐</span></div><p class="wizard-copy">无需填写域名与 IP。为 localhost 签发自签证书，启用 HTTPS 后打开管理页面。</p><div class="dns-example">https://localhost:3333</div><div class="panel-line"></div><div class="check-item">${icon('check')}<div><strong>1. 检查并签发证书</strong><br>已有有效证书时直接复用。</div></div><div class="check-item">${icon('shield')}<div><strong>2. 安装当前用户信任</strong><br>安装信任后，浏览器不再提示证书错误。</div></div><div class="check-item">${icon('external')}<div><strong>3. 打开管理页面</strong><br>由默认浏览器打开。</div></div><div class="panel-line"></div>${notice('演示流程：不签发证书，不修改系统信任。')}<div class="form-actions">${state.certReady ? button('演示打开管理页面', 'open-manager', 'external') : ''}${button(state.certReady ? '重新演示' : '演示签发本机证书', 'local-cert', 'lock', 'primary')}</div>`;
    } else {
      const steps = `<div class="steps">${['访问地址', '解析与信任', '完成预览'].map((label, i) => `${i ? '<span class="step-line"></span>' : ''}<div class="wizard-step ${state.certStep === i + 1 ? 'current' : ''}"><b>${i + 1}</b>${label}</div>`).join('')}</div>`;
      if (state.certStep === 1) content = steps + `<label class="field"><span>自定义内网域名 <small>高级选项</small></span><input id="cert-domain" value="${esc(state.certDomain)}" placeholder="zviewer.home.arpa" maxlength="253"></label><label class="field"><span>本机内网 IP <small>当前为示例，请修改</small></span><input id="cert-ip" value="${esc(state.certIp)}" placeholder="192.168.1.100"></label><div class="mini-label">证书将包含这些名称（SAN）</div><div class="san-list" id="san-list">${[state.certDomain, state.certIp, 'localhost', '127.0.0.1', '::1'].map(s => `<span class="san">${esc(s)}</span>`).join('')}</div><div class="validation" id="cert-error" role="alert"></div><div class="form-actions">${button('下一步：解析与信任', 'cert-next', 'arrow', 'primary')}</div>`;
      else if (state.certStep === 2) content = steps + notice('内网域名需要在访问设备上解析。<strong>签发证书不会创建 DNS 记录。</strong>') + `<h3>本机 hosts 记录预览</h3><div class="dns-example">${esc(state.certIp)}&nbsp;&nbsp;${esc(state.certDomain)}</div><p class="wizard-copy">该记录仅对本机生效。其他设备需配置内网 DNS 或各自的 hosts，并安装并信任根证书。</p><div class="help-card"><strong>不修改路由器配置</strong><p>hosts 修改支持备份与撤销；路由器 DNS 需手动配置。</p></div><div class="form-actions">${button('上一步', 'cert-back')}${button('完成方案预览', 'cert-next', 'check', 'primary')}</div>`;
      else content = steps + `<div class="big-check">${icon('check')}</div><h2>方案已生成</h2><p class="wizard-copy">域名与 SAN 已生成，未签发证书，也未安装信任。</p><div class="dns-example">https://${esc(state.certDomain)}:3333</div><div class="form-actions">${button('返回修改', 'cert-reset')}${button('下载配置清单', 'export-cert', 'download', 'primary')}</div>`;
    }
    return heading('证书与域名', '默认使用 localhost 自签证书；内网域名需自行配置解析。') + `<div class="tabs"><button data-cert-mode="local" class="${local ? 'active' : ''}">本机 localhost</button><button data-cert-mode="lan" class="${!local ? 'active' : ''}">高级：内网域名</button></div><div class="form-layout"><section class="panel">${content}</section><aside class="panel" id="cert-preview">${certPreview()}</aside></div>`;
  }
  function cli() {
    const live = Boolean(state.live), saved = state.config?.cli || { port: 9333, autoStart: false, user: '' };
    const c = { ...saved, ...state.cliDraft }, s = state.server?.cli || { state: 'stopped', available: false };
    const labels = { stopped: '未启动', starting: '启动中', running: '运行中', stopping: '停止中', error: '异常' };
    const activePort = s.activePort || saved.port, running = ['starting', 'running', 'stopping'].includes(s.state);
    const backend = state.server?.active || state.config || { https: false, port: 3333 };
    const backendUrl = state.server?.webUrl || `${backend.https ? 'https' : 'http'}://localhost:${backend.port || 3333}/`;
    const status = live ? labels[s.state] || '未启动' : '界面预览';
    return heading('高画质代理', '内置 ZViewerCLI，为本机哔哩哔哩高画质播放提供代理。') +
      `<div class="cli-layout"><section class="panel cli-settings"><div class="panel-heading"><div class="panel-heading-title"><span class="icon-box">${icon('watch')}</span><div><h2>ZViewerCLI</h2><p class="cli-caption">哔哩哔哩高画质代理</p></div></div><span class="pill ${s.state === 'running' && live ? 'green' : ''}"><i></i>${esc(status)}</span></div>
        <p class="cli-copy">在右侧完成代理配置、扫码登录与服务器连接，后端地址自动填入。网页账号可选，用于识别代理归属。</p>
        <div class="cli-address"><span>${icon('monitor')}仅本机访问</span><code>http://127.0.0.1:${esc(activePort)}</code></div>
        ${live ? `<p class="cli-binding-status">${icon(s.connected ? 'check' : 'info')}${s.connected ? '已关联服务器' : s.state === 'running' ? '未关联；请在代理设置页完成' : '启动后在代理设置页关联服务器'}</p>` : ''}
        <div class="cli-actions">${button(running ? '停止代理' : '启动代理', running ? 'cli-stop' : 'cli-start', running ? 'stop' : 'play', 'primary')}</div>
        <div class="panel-line"></div><div class="settings-subheading"><h3>代理配置</h3><span>端口与自动启动在下次启动时生效</span></div>
        <label class="field"><span>后端地址 · 自动跟随本地服务</span><input id="cli-backend-url" type="text" value="${esc(backendUrl)}" readonly autocomplete="off" spellcheck="false"><small>运行中使用当前服务地址；尚未启动时使用已保存的协议和端口。</small></label>
        <label class="field"><span>ZViewer 网页账号（可选）</span><input id="cli-user" type="text" maxlength="120" value="${esc(c.user || '')}" placeholder="可选，与网页端登录账号一致" autocomplete="off"><small>保存后会自动传给右侧设置，用于识别代理归属；留空也可配置。</small></label>
        <label class="field cli-port-field"><span>代理监听端口</span><input id="cli-port" type="number" min="1" max="65535" value="${esc(c.port)}"><small>默认 9333，需与其他 TCP 服务使用不同端口。</small></label>
        <div class="switch-row cli-auto-row"><div><strong id="cli-auto-title">随 ZViewer 服务启动</strong><p id="cli-auto-help">启动主服务时一同启动代理；退出控制台时自动停止。</p></div><button type="button" id="cli-auto-start" class="switch" role="switch" aria-labelledby="cli-auto-title" aria-describedby="cli-auto-help" aria-checked="${Boolean(c.autoStart)}"></button></div>
        <div class="form-actions">${button('保存代理配置', 'cli-save', 'check', 'primary')}</div>
        <p class="cli-config-note">登录由内置 ZViewerCLI 处理，控制台不读取 Cookie。</p>
      </section><section class="panel cli-embed-panel"><div class="cli-embed-heading"><div><h2>内置代理设置</h2><p>扫码登录后，点击连接服务器</p></div><span class="pill">${icon('lock')}本机</span></div>
        ${live && state.cliEmbedUrl ? `<iframe id="cli-settings-frame" src="${esc(state.cliEmbedUrl)}" title="ZViewerCLI 设置" sandbox="allow-scripts allow-forms allow-same-origin" referrerpolicy="no-referrer"></iframe>` : `<div class="cli-embed-placeholder"><span class="cli-placeholder-icon">${icon('settings')}</span><h3>${live ? '在控制台内完成配置' : '内置设置预览'}</h3><p>${!live ? '在桌面版中配置代理与扫码登录；预览不连接本机代理。' : !s.available ? '未检测到内置 CLI，请使用包含 ZViewerCLI 的完整运行包。' : s.state === 'running' ? '正在载入内置设置，后端地址会自动填写。' : '点击左侧“启动代理”后，设置显示在此处并自动填入后端地址。'}</p></div>`}
        <div class="cli-embed-hint">启动代理 → 扫码登录 → 连接服务器，然后回到网页端使用高画质代理。</div>
      </section></div>`;
  }
  function filteredEvents() { return state.events.filter(e => (state.logLevel === 'all' || e.level === state.logLevel) && (state.logSource === 'all' || e.source === state.logSource) && `${e.message} ${e.source}`.toLowerCase().includes(state.logSearch.toLowerCase())); }
  function logLines() { return filteredEvents().map(e => `<div class="log-line"><span class="log-time">${esc(e.time)}</span><span class="log-level ${e.level}">${esc(e.level)}</span><span class="log-source">${esc(e.source)}</span><span class="log-message">${esc(e.message)}</span></div>`).join('') || '<div class="empty">没有匹配的日志</div>'; }
  function logs() {
    return heading('运行日志', '查看控制台操作记录；后端日志在服务接入后显示。', button('导出日志', 'export-logs', 'download')) + `<section class="panel"><div class="log-toolbar"><input class="search-input" id="log-search" aria-label="搜索日志" placeholder="搜索日志内容…" value="${esc(state.logSearch)}"><select id="log-source" aria-label="服务筛选"><option value="all">全部服务</option>${['console', 'backend', 'voice', 'cert', 'frp', 'cli'].map(s => `<option ${s === state.logSource ? 'selected' : ''}>${s}</option>`).join('')}</select><select id="log-level" aria-label="日志级别"><option value="all">全部级别</option><option ${state.logLevel === 'INFO' ? 'selected' : ''}>INFO</option><option ${state.logLevel === 'WARN' ? 'selected' : ''}>WARN</option></select>${button(state.paused ? '继续显示' : '暂停显示', 'pause-logs', state.paused ? 'play' : 'pause')}</div><div class="log-view" id="log-lines">${logLines()}</div><div class="code-footer"><span id="log-count">${filteredEvents().length} 条 · ${state.paused ? '已暂停显示' : '操作记录'}</span><span class="log-caption">${icon('info')}仅演示事件，未读取服务日志</span></div></section><div class="help-card"><strong>日志保存方式</strong><p>按来源分流，达到 2 MB 后滚动保存；导出前屏蔽 Token、JWT 与私钥。</p></div>`;
  }
  function settings() {
    const info = state.info?.runtime;
    function toggle(key, title, text) { return `<div class="switch-row"><div><strong>${title}</strong><p>${text}</p></div><button class="switch" role="switch" aria-label="${title}" aria-checked="${state.prefs[key]}" data-pref="${key}"></button></div>`; }
    return heading('应用设置', '调整窗口、托盘与启动行为。') + `<div class="settings-grid"><section><div class="panel"><div class="panel-heading"><h2>窗口与系统托盘</h2><span class="pill ${state.native ? 'green' : ''}">${state.native ? '原生托盘已启用' : '浏览器预览'}</span></div>${toggle('closeToTray', '关闭窗口时最小化到托盘', '从通知区域恢复窗口。')}${toggle('remember', '记住界面偏好', '在本机保存界面偏好，不保存认证 Token。')}<div class="switch-row"><div><strong>登录 Windows 后启动</strong><p>原型未修改系统自启。</p></div><span class="pill">后续接入</span></div><div class="switch-row"><div><strong>启动时自动运行服务</strong><p>与登录启动相互独立。</p></div><span class="pill">后续接入</span></div></div><div class="panel section-title"><div><h2>托盘交互</h2><p class="settings-description">${state.native ? '关闭按钮按上方偏好处理。' : '桌面窗口使用系统托盘；浏览器中可预览菜单。'}</p></div>${button('预览菜单', 'tray-preview', 'tray')}</div><div class="help-card"><strong>系统托盘与系统服务</strong><p>桌面程序可隐藏窗口并常驻通知区域，无需安装系统服务。</p></div></section><aside class="panel"><div class="about-mark"><img src="app-icon.png" alt="ZViewer 标志"><div><h2>ZViewer</h2><p>WINDOWS DESKTOP</p></div></div><div class="version">0.1.0 <small>LOCAL BUILD</small></div><p class="settings-description">Windows 桌面控制台 · 界面原型<br>网页端与命令行运行包独立部署。</p><div class="panel-line"></div><div class="subheading">本地运行包</div>${[['backend', 'zviewer-backend.exe'], ['cert', 'zviewer-cert.exe'], ['livekit', 'livekit-server.exe'], ['web', 'frontend/dist']].map(([key, label]) => `<div class="file-check"><code>${label}</code><span>${info ? (info[key] ? '已检测到' : '未找到') : '桌面版中检测'}</span></div>`).join('')}<p class="certificate-note">文件存在表示运行包可用，不代表进程已启动。</p></aside></div>`;
  }
  function navigate(page) { if (!titles[page]) page = 'overview'; state.page = page; if (location.hash !== `#${page}`) location.hash = page; else render(); }
  function render() {
    const main = $('#main'), pageView = $('#page-view'), cliView = $('#cli-view');
    const frame = cliView.querySelector('#cli-settings-frame');
    main.dataset.view = state.page;
    pageView.hidden = state.page === 'cli'; cliView.hidden = state.page !== 'cli';
    $('#crumb').textContent = titles[state.page];
    document.querySelectorAll('[data-page]').forEach(a => { const active = a.dataset.page === state.page; a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const markup = (state.live && state.views ? state.views : { overview, frp, cert, cli, logs, settings })[state.page]();
    // Both containers stay attached. Hiding the CLI view preserves its browsing context across navigation.
    if (frame && !state.cliEmbedUrl) frame.remove();
    else if (frame && frame.getAttribute('src') !== state.cliEmbedUrl) frame.setAttribute('src', state.cliEmbedUrl);
    if (state.live && state.page === 'cli' && frame && state.cliEmbedUrl) {
      // Keep the browsing context alive: replacing or reattaching an iframe resets QR/login input.
      const template = document.createElement('template'); template.innerHTML = markup;
      const focused = document.activeElement;
      const focusId = focused?.closest('.cli-settings') ? focused.id : '';
      const selection = focusId && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
      cliView.querySelector('.cli-settings').replaceWith(template.content.querySelector('.cli-settings'));
      if (focusId) { const replacement = document.getElementById(focusId); replacement?.focus({ preventScroll: true }); if (replacement && selection) replacement.setSelectionRange(...selection); }
    } else (state.page === 'cli' ? cliView : pageView).innerHTML = markup;
    $('#tray-label').textContent = state.native ? '收起到托盘' : '托盘预览';
    $('#footer-status').textContent = state.live ? (state.server?.backend === 'running' ? '本地服务运行中' : '原生托盘已启用') : state.native ? '原生托盘已启用' : '本地界面预览';
    icons();
    if (state.live && state.page === 'cli') window.dispatchEvent(new Event('zviewer-cli-visible'));
  }
  function readCert() {
    const domain = $('#cert-domain'), ip = $('#cert-ip');
    if (domain) state.certDomain = domain.value.trim().toLowerCase();
    if (ip) state.certIp = ip.value.trim();
  }
  function localCertDemo() {
    state.certReady = true;
    addEvent('已演示本机证书流程，未实际执行。', 'cert');
    render();
    modal(`<div class="big-check">${icon('check')}</div><h2>本机 HTTPS 流程已演示</h2><p>正式版本会在此复用或签发 localhost 证书、引导安装信任，再启用 HTTPS 并打开管理页面。</p><div class="dns-example">https://localhost:3333</div><p>本次未签发证书、安装信任或启动后端。</p><div class="modal-actions">${button('知道了', 'close-modal', 'check', 'primary')}</div>`);
  }
  async function action(name) {
    if (name === 'toggle-run') setRunning(!state.running);
    else if (name.startsWith('cli-')) toast('请在 Windows 桌面版中启动和配置 ZViewerCLI');
    else if (name === 'open-manager') modal(`<h2>打开本机管理页面</h2><div class="dns-example">https://localhost:3333</div><p>界面原型，服务尚未接入。正式版本会先确认服务与证书就绪，再打开默认浏览器。</p><div class="modal-actions">${button('查看本机 HTTPS', 'go-cert', 'shield')}${button('知道了', 'close-modal', '', 'primary')}</div>`);
    else if (name === 'go-cert') { $('#modal').close(); navigate('cert'); }
    else if (name === 'local-cert') localCertDemo();
    else if (name === 'close-modal') $('#modal').close();
    else if (name === 'docs') { if (window.zviewerDesktop) await window.zviewerDesktop.openDocs(); else window.open('https://docx.zviewer.zero251.xyz/', '_blank', 'noopener,noreferrer'); }
    else if (name === 'export-frp') {
      const error = frpError();
      $('#frp-error').textContent = error;
      if (error) { toast(error); return; }
      const server = state.frpTab === 'server';
      download(server ? 'frps.toml' : 'frpc.toml', frpConfig(server));
      addEvent(`已导出 ${server ? 'frps' : 'frpc'}.toml 模板，未包含输入 Token。`, 'frp');
      toast('已导出当前配置模板；请在运行机器配置 FRP_TOKEN');
    } else if (name === 'copy-frp') {
      try { await navigator.clipboard.writeText(frpConfig(state.frpTab === 'server')); toast('已复制配置模板，未包含输入的 Token'); }
      catch { toast('剪贴板不可用，可使用“导出配置模板”'); }
    } else if (name === 'cert-next') {
      readCert();
      if (state.certStep === 1) {
        const ip = state.certIp.split('.').map(Number);
        const privateV4 = validHost(state.certIp) && /^[\d.]+$/.test(state.certIp) && (ip[0] === 10 || (ip[0] === 192 && ip[1] === 168) || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31));
        const error = !validHost(state.certDomain) || !state.certDomain.includes('.') || /^[\d.]+$/.test(state.certDomain) || state.certDomain.includes(':') ? '请输入合法的内网域名，例如 zviewer.home.arpa。' : !privateV4 ? '请输入 10.x、172.16–31.x 或 192.168.x 范围内的内网 IPv4 地址。' : '';
        if (error) { $('#cert-error').textContent = error; return; }
      }
      state.certStep = Math.min(3, state.certStep + 1); render();
    } else if (name === 'cert-back') { state.certStep = Math.max(1, state.certStep - 1); render(); }
    else if (name === 'cert-reset') { state.certStep = 1; render(); }
    else if (name === 'export-cert') {
      download('zviewer-lan-https-plan.txt', `ZViewer 内网 HTTPS 配置清单（未实际执行）\n\n域名：${state.certDomain}\n内网 IP：${state.certIp}\nURL：https://${state.certDomain}:3333\nSAN：${state.certDomain}, ${state.certIp}, localhost, 127.0.0.1, ::1\n\n1. 使用本地 CA 签发证书，不要把内网域名传给公网 ACME 流程。\n2. 配置内网 DNS，或在访问电脑 hosts 中添加：${state.certIp} ${state.certDomain}\n3. 各访问设备安装并信任公开根证书。不要分享 CA 私钥。\n4. 启用后端 HTTPS，并分别验证网页、WebSocket、语音与共享。\n\n若仅本机使用，直接选择默认 localhost，无需内网 DNS。\n`);
      toast('配置清单已下载，未生成证书或私钥');
    } else if (name === 'export-logs') {
      download('zviewer-preview-events.log', '# ZViewer GUI prototype events only\n' + filteredEvents().map(e => `${e.time} ${e.level} [${e.source}] ${e.message}`).join('\n'));
      toast('已导出当前筛选的日志');
    } else if (name === 'pause-logs') { state.paused = !state.paused; render(); }
    else if (name === 'tray-preview') {
      if (window.zviewerDesktop) { await window.zviewerDesktop.window('tray-menu'); return; }
      modal(`<h2>系统托盘菜单</h2><p>桌面版在通知区域显示 ZViewer 图标，以下为菜单预览。</p><div class="tray-preview"><button data-action="tray-home">${icon('grid')}显示控制台</button><button data-action="tray-toggle">${icon(state.running ? 'stop' : 'play')}${state.running ? '停止演示' : '启动演示'}</button><button data-action="tray-logs">${icon('terminal')}查看日志</button><div class="separator"></div><button data-action="close-modal">关闭菜单预览</button></div>`);
    }
    else if (name === 'tray-home') { $('#modal').close(); navigate('overview'); }
    else if (name === 'tray-toggle') { $('#modal').close(); setRunning(!state.running); }
    else if (name === 'tray-logs') { $('#modal').close(); navigate('logs'); }
  }
  document.addEventListener('click', event => {
    const windowButton = event.target.closest('[data-window]');
    if (windowButton) { if (window.zviewerDesktop) window.zviewerDesktop.window(windowButton.dataset.window); else toast('窗口控制仅在 Windows 桌面版可用'); return; }
    const nav = event.target.closest('[data-nav]'); if (nav) { navigate(nav.dataset.nav); return; }
    const btn = event.target.closest('[data-action]'); if (btn) { action(btn.dataset.action).catch(error => toast(`操作未完成：${error.message}`)); return; }
    const frpTab = event.target.closest('[data-frp-tab]'); if (frpTab) { state.frpTab = frpTab.dataset.frpTab; render(); return; }
    const certTab = event.target.closest('[data-cert-mode]'); if (certTab) { readCert(); state.certMode = certTab.dataset.certMode; render(); return; }
    const pref = event.target.closest('[data-pref]');
    if (pref) {
      state.prefs[pref.dataset.pref] = !state.prefs[pref.dataset.pref];
      try { if (state.prefs.remember) localStorage.setItem('zviewer-ui-prefs', JSON.stringify(state.prefs)); else localStorage.removeItem('zviewer-ui-prefs'); }
      catch { toast('本地存储不可用，偏好仅在本次窗口有效'); }
      window.zviewerDesktop?.closeBehavior(state.prefs.closeToTray);
      render();
    }
  });
  document.addEventListener('input', event => {
    const target = event.target;
    if (target.matches('[data-frp-field]')) { state.frp[target.dataset.frpField] = target.value; $('#frp-code').textContent = frpConfig(state.frpTab === 'server'); $('#frp-error').textContent = ''; }
    if (!state.live && (target.id === 'cert-domain' || target.id === 'cert-ip')) {
      readCert(); $('#cert-preview').innerHTML = certPreview();
      $('#san-list').innerHTML = [state.certDomain, state.certIp, 'localhost', '127.0.0.1', '::1'].map(s => `<span class="san">${esc(s)}</span>`).join('');
      $('#cert-error').textContent = '';
    }
    if (target.id === 'log-search') { state.logSearch = target.value; if (!state.paused) refreshLogs(); }
  });
  document.addEventListener('change', event => {
    const target = event.target;
    if (target.matches('[data-frp-check]')) { state.frp[target.dataset.frpCheck] = target.checked; $('#frp-code').textContent = frpConfig(state.frpTab === 'server'); }
    if (target.id === 'log-source') { state.logSource = target.value; if (!state.paused) refreshLogs(); }
    if (target.id === 'log-level') { state.logLevel = target.value; if (!state.paused) refreshLogs(); }
  });
  function refreshLogs() { $('#log-lines').innerHTML = logLines(); $('#log-count').textContent = `${filteredEvents().length} 条 · ${state.live ? '运行日志' : '操作记录'}`; }
  $('#tray-button').addEventListener('click', () => { if (window.zviewerDesktop) window.zviewerDesktop.window('tray'); else action('tray-preview'); });
  $('#docs-link').addEventListener('click', () => action('docs'));
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey && event.key.toLowerCase() === 'r') || event.key === 'F5') { event.preventDefault(); location.reload(); }
  });
  window.addEventListener('hashchange', () => { state.page = titles[location.hash.slice(1)] ? location.hash.slice(1) : 'overview'; render(); });
  $('#modal').addEventListener('click', event => { if (event.target === $('#modal')) { const r = $('#modal').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('#modal').close(); } });
  state.page = titles[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
  const navToggle = $('#nav-toggle');
  if (navToggle) {
    navToggle.addEventListener('click', () => {
      const collapsed = document.body.classList.toggle('nav-collapsed');
      navToggle.setAttribute('aria-expanded', String(!collapsed));
      navToggle.setAttribute('title', collapsed ? '展开导航' : '折叠导航');
    });
  }
  window.ZViewerUI = { state, icon, esc, heading, button, notice, render, navigate, toast, modal, readCert, preview: { overview, frp, cert, cli, logs, settings }, refreshLogs };
  render();
  if (window.zviewerDesktop) {
    window.zviewerDesktop.info().then(info => {
      state.info = info; state.native = true;
      if (info.live) { window.dispatchEvent(new CustomEvent('zviewer-ready', { detail: info })); return; }
      render();
    }).catch(() => toast('桌面桥接未就绪，请重新打开控制台。'));
    window.zviewerDesktop.onNavigate(navigate);
    window.zviewerDesktop.onUpdate?.(snapshot => {
      // Clear a stopped proxy even while its view is hidden; ordinary updates leave the iframe alone.
      if (snapshot.cli && !['starting', 'running'].includes(snapshot.cli.state)) {
        state.cliEmbedUrl = '';
        $('#cli-settings-frame')?.remove();
      }
    });
  }
})();
