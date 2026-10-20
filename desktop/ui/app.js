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
    link: '<path d="M10 13a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 4.3l-1.3 1.3"/><path d="M14 11a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 19.7l1.3-1.3"/>',
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
  const titles = { overview: '服务总览', connect: '连接方式', frp: 'FRP 穿透', cert: '证书与域名', cli: '高画质代理', logs: '运行日志', settings: '应用设置' };
  let prefs = { closeToTray: true, remember: true };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('zviewer-ui-prefs') || '{}') }; } catch { /* Use safe defaults if storage is unavailable. */ }
  const state = {
    page: 'overview', running: false, certReady: false, native: false, info: null,
    frpTab: 'client', ipv6: null,
    frp: { host: '', port: 7000, voice: true, rtmp: true, tcp: false, webPort: 3333, voicePort: 3333, rtmpPort: 3334, tcpPort: 3337 },
    logLevel: 'all', logSource: 'all', logSearch: '', paused: false, cliDraft: null, cliEmbedUrl: '',
    events: [], prefs, updateOpen: false, updateKey: ''
  };
  function clock() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }
  function addEvent(message, source = 'console', level = 'INFO') { state.events.unshift({ time: clock(), source, level, message }); state.events.length = Math.min(state.events.length, 100); }
  addEvent('控制台已就绪，未改动后端与网络配置。');
  addEvent('本机 HTTPS 默认使用 localhost。', 'cert');
  addEvent('FRP 模板已生成，未连接服务器。', 'frp');
  function icons() { document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('visible'), 4000); }
  function heading(title, subtitle, right = '') { return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${right ? `<div class="heading-actions">${right}</div>` : ''}</div>`; }

  // 页面内教程：按钮固定在标题右侧，展开后是按主题折叠的说明文档。
  const tutorials = {
    frp: {
      title: 'FRP 使用教程',
      caption: 'frps + frpc',
      sections: [
        {
          title: 'frp 是什么',
          body: '<p>frp 是反向代理工具，用于把没有公网 IP 的本机服务，经一台公网 VPS 转发到互联网。</p><p>VPS 上运行服务端 <code>frps</code>，本机运行客户端 <code>frpc</code>。</p>'
        },
        {
          title: '使用前需要什么',
          body: '<ul><li>一台有公网 IPv4 的 VPS，Linux 或 Windows 均可。</li><li>在 VPS 安全组与系统防火墙放行控制端口和各映射端口。</li><li>一串自行生成的随机 Token，两端保持一致，只放环境变量，不写进配置文件。</li><li>本机 ZViewer 服务已启动，默认监听 3333。</li></ul>'
        },
        {
          title: '怎么配置',
          body: '<ol><li>在 VPS 写 <code>frps.toml</code>：<code>bindPort</code> 填控制端口，<code>auth.token</code> 从环境变量读取，<code>transport.tls.force = true</code>。</li><li>放行端口：控制端口 TCP、网页 TCP、UDP 语音对应 UDP、RTMP TCP；改用 TCP 语音时再放行对应 TCP 端口。</li><li>在本页填写 VPS 地址与控制端口，勾选需要的映射，核对本地端口。</li><li>导出 <code>frpc.toml</code> 放到本机，设置环境变量 <code>FRP_TOKEN</code> 后启动 frpc。</li><li>状态变为“代理已注册”后，外网用 <code>VPS_IP:远端端口</code> 访问。</li></ol>'
        },
        {
          title: '官方资料',
          body: '<p>GitHub 仓库：<a href="https://github.com/fatedier/frp" data-external="https://github.com/fatedier/frp">github.com/fatedier/frp</a></p><p>官方文档：<a href="https://gofrp.org/zh-cn/docs/" data-external="https://gofrp.org/zh-cn/docs/">gofrp.org/zh-cn/docs</a></p>'
        }
      ]
    },
    cert: {
      title: '证书配置教程',
      caption: '本机 CA · 当前用户信任',
      sections: [
        {
          title: '为什么要配置证书',
          body: '<p>浏览器会把 http 页面标记为不安全，麦克风、剪贴板、Service Worker 等能力只在安全上下文（https 或 localhost）下可用。</p><p>本控制台只为当前电脑签发 localhost 证书；局域网或公网设备访问需要另外准备证书与域名解析。</p>'
        },
        {
          title: '证书覆盖哪些地址',
          body: '<ul><li>只对 <code>localhost</code>、<code>127.0.0.1</code>、<code>::1</code> 生效，不包含内网 IP 与自定义域名。</li><li>不需要配置 DNS、hosts 或路由器。</li><li>证书由本机专用 CA 签发，私钥只留在当前用户配置目录。</li></ul>'
        },
        {
          title: '配置方法',
          body: '<ol><li>点击签发按钮，程序用本机 CA 生成 localhost 证书；已有有效证书时直接复用。</li><li>安装当前用户信任，浏览器不再提示证书错误，可随时撤销。</li><li>在应用设置里确认“使用 HTTPS”已开启，保存并重启服务。</li><li>打开管理页面，地址为 <code>https://localhost:3333</code>。</li></ol>'
        }
      ],
      foot: '根 CA 私钥不可分享；撤销信任后浏览器会重新提示证书错误。'
    },
    cli: {
      title: '高画质代理教程',
      caption: 'ZViewerCLI · 本机 127.0.0.1',
      sections: [
        {
          title: 'ZViewerCLI 是什么',
          body: '<p><code>ZViewerCLI</code> 是随桌面端附带的命令行代理程序，在本机监听一个 HTTP 端口，默认 <code>9333</code>。</p><p>网页端播放器通过它取到哔哩哔哩的高画质播放地址，再由本机转发给浏览器。</p>'
        },
        {
          title: '有什么作用',
          body: '<ul><li>让网页播放器使用更高清晰度，避开浏览器端的解析限制。</li><li>只监听 <code>127.0.0.1</code>，请求不经过第三方服务器。</li><li>登录态由 CLI 自己的设置页处理，桌面控制台不读取 Cookie。</li></ul>'
        },
        {
          title: '如何使用',
          body: '<ol><li>在本页点击“启动代理”，端口默认 9333，需与其他 TCP 服务错开。</li><li>在右侧内置设置中扫码登录哔哩哔哩账号。</li><li>确认后端地址（默认跟随本地服务），点击“连接服务器”。</li><li>回到网页端打开视频，在清晰度菜单中选择高画质。</li><li>需要随服务一起启动时，打开“随 ZViewer 服务启动”后保存。</li></ol>'
        }
      ],
      foot: '代理未启动时网页端仍可正常播放，只是清晰度受浏览器端限制。'
    },
    connect: {
      title: '连接方式教程',
      caption: '五种方式的取舍',
      sections: [
        {
          title: 'IPv6 直连',
          body: '<p>运营商已下发公网 IPv6 时，外网设备直接用本机地址访问，不经过第三方中转。</p><p>页面给出带端口的完整地址，复制到浏览器即可打开。需在路由器与 Windows 防火墙放行该端口；运营商前缀变化后地址随之变化。</p>'
        },
        {
          title: '服务商 FRP',
          body: '<p>在樱花内网穿透、OpenFrp、cpolar、ngrok 这类服务商注册，拿到它分配的服务器地址、端口与 Token，填进本机 FRP 即可。客户端仍是标准 frpc，不用自己维护服务器。</p><p>访问域名、远端端口与带宽由服务商决定；免费节点的域名随机、速度受限，部分服务商需实名或付费才能用自定义域名。</p>'
        },
        {
          title: '自建 FRP',
          body: '<p>租一台有公网 IP 的 VPS，在上面运行服务端 frps，本机运行 frpc，两端用同一 Token 认证。控制台可直接生成 frps.toml 与 frpc.toml 两份配置。</p><p>端口、域名与带宽完全由自己安排，速度和稳定性取决于 VPS 线路；需要自行在安全组与系统防火墙放行映射端口，并自行运维服务器。</p>'
        },
        {
          title: '虚拟局域网',
          body: '<p>相关设备安装同一款虚拟局域网软件（ZeroTier、Tailscale、EasyTier 等），加入同一虚拟网络，再用分配的虚拟 IP 访问本机。</p><p>不向公网开放端口，网络外的设备无法访问；需要每个人都安装虚拟局域网软件。</p>'
        },
        {
          title: 'Cloudflare Tunnel',
          body: '<p><strong>先备一张外国银行卡，每月免费 1000 GB 流量。</strong>固定域名的用法要把自有域名托管到 Cloudflare，开通时须绑定境外支付方式；只取临时地址则不必绑卡。</p><p>cloudflared 由本机向 Cloudflare 边缘发起出站连接，所以不需要公网 IP、端口映射，也不必在路由器或防火墙放行入站端口；外网访问的是 Cloudflare 一侧的地址。</p><p>临时地址走快速隧道（TryCloudflare），形如 <code>xxx.trycloudflare.com</code>，随隧道关闭失效；固定地址走命名隧道，需账号与自有域名。</p>'
        },
        {
          title: '怎么选',
          body: '<ul><li><strong>有公网 IPv6</strong>：选 IPv6 直连，链路最短，带宽不受中转限制。</li><li><strong>没有公网 IP、不想维护服务器</strong>：选服务商 FRP，注册后填地址与 Token 即可，代价是带宽与域名受服务商限制。</li><li><strong>没有公网 IP、手上有 VPS</strong>：选自建 FRP，端口与带宽可自行安排，需自己放行端口并运维。</li><li><strong>访问者固定、人数不多</strong>：选虚拟局域网，不暴露公网，边界最简单，但每个人都要安装软件。</li><li><strong>要固定域名、又不想开放公网端口</strong>：选 Cloudflare Tunnel，需要一张外国银行卡，每月免费 1000 GB 流量。</li></ul>'
        }
      ],
      foot: '五种方式都要求本机 ZViewer 服务已启动；IPv6 与自建 FRP 还需在路由器、防火墙或安全组放行对应端口。'
    }
  };

  function tutorial(key) {
    const data = tutorials[key];
    if (!data) return '';
    const chevron = '<svg class="tutorial-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    const sections = data.sections.map((section, index) => {
      const open = index === 0;
      return `<section class="tutorial-section" data-open="${open}"><button type="button" class="tutorial-section-head" data-tutorial-section aria-expanded="${open}"><span class="tutorial-index">${index + 1}</span><span>${section.title}</span>${chevron}</button><div class="tutorial-section-body">${section.body}</div></section>`;
    }).join('');
    return `<div class="tutorial"><button type="button" class="tutorial-toggle" data-tutorial-toggle aria-expanded="false" aria-haspopup="true" aria-controls="tutorial-${key}">${icon('book')}教程<svg class="tutorial-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div class="tutorial-menu" id="tutorial-${key}" role="dialog" aria-label="${data.title}" hidden><div class="tutorial-head"><div><strong>${data.title}</strong><small>${data.caption}</small></div><button type="button" class="tutorial-close" data-tutorial-close aria-label="关闭教程"><span class="icon-glyph">&#xE8BB;</span></button></div><div class="tutorial-sections">${sections}</div>${data.foot ? `<p class="tutorial-foot">${data.foot}</p>` : ''}</div></div>`;
  }

  function closeTutorials() {
    document.querySelectorAll('.tutorial-toggle[aria-expanded="true"]').forEach(toggle => {
      toggle.setAttribute('aria-expanded', 'false');
      const menu = toggle.parentElement.querySelector('.tutorial-menu');
      if (menu) menu.hidden = true;
    });
  }

  function button(label, action, name, cls = '') { return `<button class="btn ${cls}" data-action="${action}">${name ? icon(name) : ''}${label}</button>`; }
  function notice(text, warm = false) { return `<div class="notice ${warm ? 'warm' : ''}">${icon('info')}<div>${text}</div></div>`; }
  function download(name, text, mime = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function modal(content) { $('#modal-content').innerHTML = content; $('#modal').showModal(); }
  // ---------- 软件更新 ----------
  // 检查与下载都在主进程完成；界面只读快照里的 update 状态，下载期间不退出程序。
  const updateLabels = { idle: '未检查', checking: '检查中', latest: '已是最新', available: '有新版', downloading: '下载中', ready: '待安装', error: '失败' };
  function updateReport() { return state.live ? state.server?.update || null : null; }
  function sizeText(bytes) {
    if (!bytes) return '';
    const mb = bytes / 1024 / 1024;
    return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
  }
  function updateBody(report) {
    const name = report?.state || 'idle';
    if (!state.live) return '检查更新、下载与安装只在 Windows 桌面版中执行；浏览器预览不会访问 GitHub。';
    if (name === 'checking') return '正在查询 GitHub 上的最新正式版本。';
    if (name === 'latest') return '当前已是最新正式版本。';
    if (name === 'available') return `发现新版本 v${esc(report.latest)}，安装包 ${sizeText(report.size)}。下载完成后才会重启安装。`;
    if (name === 'downloading') return `正在下载 v${esc(report.latest)}，已完成 ${report.progress}%。下载期间控制台可以继续使用。`;
    if (name === 'ready') return `v${esc(report.latest)} 已下载并校验完成。点击重启后退出控制台，覆盖运行包并自动重新启动。`;
    if (name === 'error') return esc(report?.error || '检查失败。');
    return '尚未检查更新。';
  }
  function updateActions(report) {
    const name = state.live ? report?.state || 'idle' : 'preview';
    if (name === 'downloading') return `<button class="btn" disabled>${icon('download')}下载中 ${report.progress}%</button>`;
    if (name === 'ready') return `${button('重启并安装', 'update-apply', 'refresh', 'primary')}${button('打开发布页', 'update-page', 'link')}`;
    if (name === 'available') return `${button('下载更新', 'update-download', 'download', 'primary')}${button('打开发布页', 'update-page', 'link')}`;
    return button(name === 'checking' ? '正在检查…' : '检查更新', 'update-check', 'refresh', 'primary');
  }
  function updateModal() {
    const report = updateReport();
    const name = state.live ? report?.state || 'idle' : 'preview';
    const tone = name === 'available' || name === 'ready' ? 'green' : name === 'error' ? 'red' : '';
    const current = state.info?.version || '0.1.0';
    const latest = report?.latest ? `v${report.latest}` : '—';
    const progress = name === 'downloading' ? `<div class="update-progress"><i style="width:${Math.min(100, Math.max(0, report.progress))}%"></i></div>` : '';
    const meta = report?.checkedAt ? `上次检查 ${esc(report.checkedAt)}` : '尚未检查';
    const auto = state.live ? Boolean(state.config?.autoCheckUpdate ?? report?.autoCheck) : true;
    const proxy = state.live ? Boolean(state.config?.updateProxy ?? report?.proxy) : true;
    const proxyURL = state.config?.updateProxyUrl || report?.proxyUrl || 'https://gh-proxy.com';
    const proxyNote = !state.live
      ? '桌面版中检查更新时会先经该前缀转发；浏览器预览不联网。'
      : report?.proxy
        ? `本次检查已由 ${esc(report.proxyUrl || proxyURL)} 转发。`
        : '当前为直连；GitHub 附件下载较慢时再开启。';
    return `<div class="update-head"><div><h2>软件更新</h2><p>发布来源 github.com/Zero-wyc/ZViewer${report?.notes ? ` · ${esc(report.notes)}` : ''}</p></div><span class="pill ${tone}"><i></i>${updateLabels[name] || '未检查'}</span></div>
      <div class="update-grid"><div><span>当前版本</span><strong>v${esc(current)}</strong></div><div><span>最新版本</span><strong>${latest}</strong></div></div>
      <p class="update-state">${updateBody(report)}</p>${progress}
      <div class="modal-actions">${updateActions(report)}</div>
      <div class="switch-row update-auto"><div><strong>自动检查更新</strong><p>启动后检查一次，此后每 6 小时检查；只检查，不自动下载。</p></div><button class="switch" role="switch" aria-label="自动检查更新" aria-checked="${auto}" data-action="update-auto" ${state.live ? '' : 'disabled'}></button></div>
      <div class="switch-row update-proxy"><div><strong>使用前置反代</strong><p>检查和下载都先交给前缀式反代，默认 gh-proxy，可换成其它服务商。${proxyNote}</p></div><button class="switch" role="switch" aria-label="使用前置反代" aria-checked="${proxy}" data-action="update-proxy" ${state.live ? '' : 'disabled'}></button></div>
      <div class="update-proxy-field"><input class="search-input" id="update-proxy-url" aria-label="反代前缀地址" value="${esc(proxyURL)}" placeholder="https://gh-proxy.com" spellcheck="false" ${state.live && proxy ? '' : 'disabled'}></div>
      <p class="update-note">${icon('info')}<span>${meta}。安装包来自 GitHub Release，下载完成后校验 SHA256 与压缩包结构，通过后才允许安装。</span></p>`;
  }
  function openUpdate() {
    state.updateOpen = true; state.updateKey = '';
    modal(updateModal());
    const report = updateReport();
    if (state.live && (!report || report.state === 'idle')) updateCommand('update-check');
  }
  function syncUpdate(snapshot) {
    const report = snapshot?.update || null;
    const dot = $('#update-dot');
    if (dot) dot.hidden = !(report && report.available && report.state !== 'downloading');
    const key = report ? `${report.state}|${report.progress}|${report.latest}|${report.error}|${snapshot?.config?.autoCheckUpdate}|${snapshot?.config?.updateProxy}|${snapshot?.config?.updateProxyUrl}|${report.checkedAt}` : '';
    if (state.updateOpen && $('#modal')?.open && key !== state.updateKey) {
      state.updateKey = key;
      $('#modal-content').innerHTML = updateModal();
    }
  }
  async function updateCommand(name, payload) {
    if (!window.zviewerDesktop?.command) { toast('更新在 Windows 桌面版中可用'); return null; }
    try { return await window.zviewerDesktop.command(name, payload || {}); }
    catch (error) { toast(String(error?.message || error).replace(/^.*Error: /, '')); return null; }
  }
  // 反代状态先本地对齐，避免等快照回来前说明文字仍显示旧地址。
  function patchUpdateProxy(enabled, url) {
    if (!state.server?.update) return;
    state.server.update.proxy = enabled;
    state.server.update.proxyUrl = enabled ? url : '';
  }
  // 反代地址变化后立即保存并重查一次，界面随后显示新链路是否可用。
  async function applyProxyURL(input) {
    if (!state.live) return;
    const fallback = state.config?.updateProxyUrl || 'https://gh-proxy.com';
    const url = input.value.trim();
    if (!url) { toast('反代地址不能为空'); input.value = fallback; return; }
    if (url === state.config?.updateProxyUrl) return;
    toast('正在按该反代重新检查更新…');
    const next = await updateCommand('update-proxy', { enabled: true, url });
    if (!next) { input.value = fallback; return; }
    state.config = { ...state.config, updateProxy: true, updateProxyUrl: url };
    patchUpdateProxy(true, url);
    state.updateKey = '';
    $('#modal-content').innerHTML = updateModal();
  }
  function setRunning(running, notify = true) {
    state.running = !!running;
    if (notify) window.zviewerDesktop?.demoState(state.running).catch(() => toast('托盘状态同步失败，请重新打开窗口。'));
    addEvent(state.running ? '演示状态已开启，未运行实际后端。' : '演示状态已停止。', 'backend');
    render();
    toast(state.running ? '演示状态：未启动后端' : '演示已停止');
  }
  function activity() { return state.events.slice(0, 3).map(e => `<div class="activity"><span class="activity-dot"></span><div><strong>${esc(e.source === 'frp' ? '穿透配置' : e.source === 'cert' ? '本机 HTTPS' : e.source === 'backend' ? '演示状态' : e.source === 'tunnel' ? 'Cloudflare 隧道' : e.source === 'update' ? '软件更新' : '控制台')}</strong><p>${esc(e.message)}</p></div><time>${esc(e.time)}</time></div>`).join(''); }
  function overview() {
    const service = (name, subtitle, ico, color, status, left, right) => `<article class="service-card"><div class="service-top"><span class="icon-box ${color}">${icon(ico)}</span><span class="pill ${status.includes('演示') ? 'green' : ''}"><i></i>${status}</span></div><div><h3>${name}</h3><p>${subtitle}</p></div><div class="service-meta"><span>${left}</span><code>${right}</code></div></article>`;
    return heading('服务总览', '本机服务、证书与穿透的运行状态。') +
      `<section class="hero"><div class="hero-copy"><h2>${state.running ? '演示运行中' : '服务未启动'}</h2><p>${state.running ? '界面演示，未连接真实后端。' : '启动本机服务后，可访问网页端与管理页面。'}</p><div class="hero-actions">${button(state.running ? '停止演示' : '启动演示', 'toggle-run', state.running ? 'stop' : 'play', 'primary')}<button class="text-button" data-action="open-manager">打开管理页面 ${icon('external')}</button></div></div></section>` +
      `<div class="section-title"><h2>服务状态</h2><small>演示数据</small></div><div class="service-grid">${service('ZViewer 主服务', '网页与 API', 'server', 'orange', state.running ? '演示运行' : '未启动', '默认监听端口', ':3333 / TCP')}${service('语音与推流', '语音与 RTMP 推流', 'mic', 'green', state.running ? '演示待就绪' : '未启动', '默认语音 / 推流', ':3333 / :3334')}${service('FRP 穿透', '经 VPS 转发', 'network', '', '待配置', '穿透客户端', 'frpc → frps')}</div>` +
      `<div class="bottom-grid"><section><div class="section-title"><h2>常用操作</h2><small>快捷入口</small></div><div class="setup-list"><button class="setup-row" data-nav="cert"><span class="step">${icon('lock')}</span><div><strong>签发本机 HTTPS 证书</strong><p>为 localhost 签发证书并启用 HTTPS</p></div>${icon('arrow')}</button><button class="setup-row" data-nav="frp"><span class="step">${icon('network')}</span><div><strong>配置 FRP 服务器</strong><p>填写 VPS 地址与端口映射</p></div>${icon('arrow')}</button><button class="setup-row" data-nav="settings"><span class="step">${icon('tray')}</span><div><strong>关闭到托盘</strong><p>关闭窗口后在通知区域保留图标</p></div>${icon('arrow')}</button></div></section><section><div class="section-title"><h2>最近活动</h2><button class="text-button" data-nav="logs">全部日志 ${icon('arrow')}</button></div><div class="activity-list">${activity()}</div></section></div><div class="footnote">${icon('info')}服务、连接与证书操作均为演示。</div>`;
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
    return heading('FRP 穿透', '通过服务商节点或自有 VPS 转发本机服务。', `${tutorial('frp')}<span class="pill orange"><i></i>未连接</span>`) +
      `<div class="form-layout"><section class="panel"><div class="panel-heading"><div class="panel-heading-title"><span class="icon-box">${icon('cloud')}</span><h2>FRP 服务器</h2></div><small>frps 节点</small></div><div class="form-row"><label class="field"><span>服务器地址 <small>VPS 或服务商</small></span><input id="frp-host" data-frp-field="host" value="${esc(c.host)}" placeholder="例如 frp.example.com" autocomplete="off" maxlength="253"></label><label class="field"><span>控制端口</span><input data-frp-field="port" aria-label="FRP 控制端口" type="number" value="${esc(c.port)}" min="1" max="65535"></label></div><label class="field"><span>认证 Token <small>不保存、不导出明文</small></span><input id="frp-token" type="password" placeholder="与 VPS 上的 frps 保持一致" autocomplete="off"></label><span class="field-note">导出模板从 FRP_TOKEN 环境变量读取凭据。输入内容不会保存。</span><div class="panel-line"></div><div class="panel-heading no-margin"><h2>端口映射</h2><small>本地 → 公网 VPS</small></div><div class="mapping mapping-head"><span>服务</span><span>协议</span><span>本地</span><span></span><span>远端</span></div>${row('网页服务', 'web', 'TCP', 3333, 'webPort', true, true)}${row('UDP 语音', 'voice', 'UDP', 3333, 'voicePort', c.voice)}${row('RTMP 推流', 'rtmp', 'TCP', 3334, 'rtmpPort', c.rtmp)}${row('TCP 语音', 'tcp', 'TCP', 3337, 'tcpPort', c.tcp)}<div class="help-card"><strong>语音需单独放行</strong><p>UDP 语音需放行对应 UDP 端口；选用 TCP 语音时，管理端语音模式需同步设为 TCP。</p></div><div class="validation" id="frp-error" role="alert"></div><div class="form-actions">${button('查看文档', 'docs', 'book')}${button('导出配置模板', 'export-frp', 'download', 'primary')}</div></section><section><div class="panel"><div class="panel-heading"><h2>配置预览</h2><span class="tag-caption">TOML · 自动生成</span></div><div class="tabs"><button data-frp-tab="client" class="${state.frpTab === 'client' ? 'active' : ''}">本机 frpc.toml</button><button data-frp-tab="server" class="${state.frpTab === 'server' ? 'active' : ''}">VPS frps.toml</button></div><pre class="codebox" id="frp-code">${esc(frpConfig(state.frpTab === 'server'))}</pre><div class="code-footer"><span>凭据采用环境变量占位，未写入明文</span><button class="text-button" data-action="copy-frp">${icon('copy')}复制</button></div><div class="path-flow"><div class="flow-item">${icon('globe')}外网设备</div><span>→</span><div class="flow-item">${icon('cloud')}VPS / frps</div><span>→</span><div class="flow-item">${icon('monitor')}本机 / frpc</div></div></div><div class="help-card"><strong>部署步骤</strong><p>两台机器使用同一 FRP_TOKEN；部署 frps 并放行端口，再用 frpc verify 校验配置。传输 TLS 与网页 HTTPS 独立配置。</p></div></section></div>`;
  }
  function certPreview() {
    return `<div class="certificate">${icon('shield')}<div class="eyebrow">证书预览</div><h3 id="cert-preview-domain">localhost</h3><p>本机访问，无需配置 DNS 或 hosts。<br>本地自签，尚未签发</p></div><div class="meta-list"><div class="meta-line"><span>管理页面地址</span><span id="cert-preview-url">https://localhost:3333</span></div><div class="meta-line"><span>签发方式</span><span>现有 zviewer-cert.exe · localhost</span></div><div class="meta-line"><span>证书状态</span><span>${state.certReady ? '已演示' : '未签发'}</span></div><div class="meta-line"><span>浏览器信任</span><span>首次使用需要单独安装信任</span></div></div><div class="check-item">${icon('check')}<div><strong>localhost 仅用于本机</strong><br>打开管理页面不需要路由器或公网域名。</div></div><div class="check-item">${icon('lock')}<div><strong>私钥仅保存在本机</strong><br>只导出公开证书，根 CA 私钥不可分享。</div></div>`;
  }
  function cert() {
    const content = `<div class="panel-heading"><div class="panel-heading-title"><span class="icon-box orange">${icon('monitor')}</span><h2>本机 localhost</h2></div><span class="pill green">仅本机</span></div><p class="wizard-copy">为 localhost 签发自签证书，启用 HTTPS 后打开管理页面。局域网与公网设备访问需另行准备证书。</p><div class="dns-example">https://localhost:3333</div><div class="panel-line"></div><div class="check-item">${icon('check')}<div><strong>1. 检查并签发证书</strong><br>已有有效证书时直接复用。</div></div><div class="check-item">${icon('shield')}<div><strong>2. 安装当前用户信任</strong><br>安装信任后，浏览器不再提示证书错误。</div></div><div class="check-item">${icon('external')}<div><strong>3. 打开管理页面</strong><br>由默认浏览器打开。</div></div><div class="panel-line"></div>${notice('演示流程：不签发证书，不修改系统信任。')}<div class="form-actions">${state.certReady ? button('演示打开管理页面', 'open-manager', 'external') : ''}${button(state.certReady ? '重新演示' : '演示签发本机证书', 'local-cert', 'lock', 'primary')}</div>`;
    return heading('证书与域名', '签发 localhost 自签证书，并安装当前用户信任。', tutorial('cert')) + `<div class="form-layout"><section class="panel">${content}</section><aside class="panel" id="cert-preview">${certPreview()}</aside></div>`;
  }
  function cli() {
    const live = Boolean(state.live), saved = state.config?.cli || { port: 9333, autoStart: false, user: '' };
    const c = { ...saved, ...state.cliDraft }, s = state.server?.cli || { state: 'stopped', available: false };
    const labels = { stopped: '未启动', starting: '启动中', running: '运行中', stopping: '停止中', error: '异常' };
    const activePort = s.activePort || saved.port, running = ['starting', 'running', 'stopping'].includes(s.state);
    const backend = state.server?.active || state.config || { https: false, port: 3333 };
    const backendUrl = state.server?.webUrl || `${backend.https ? 'https' : 'http'}://localhost:${backend.port || 3333}/`;
    const status = live ? labels[s.state] || '未启动' : '界面预览';
    return heading('高画质代理', '内置 ZViewerCLI，为本机哔哩哔哩高画质播放提供代理。', tutorial('cli')) +
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
  const connectLinks = {
    frpProvider: [
      ['樱花内网穿透', 'natfrp.com', 'https://www.natfrp.com/'],
      ['OpenFrp', 'openfrp.net', 'https://www.openfrp.net/'],
      ['cpolar', 'cpolar.com', 'https://www.cpolar.com/'],
      ['ngrok', 'ngrok.com', 'https://ngrok.com/']
    ],
    frpSelf: [
      ['frp 下载', 'github.com/fatedier/frp', 'https://github.com/fatedier/frp/releases'],
      ['frp 官方文档', 'gofrp.org', 'https://gofrp.org/zh-cn/docs/']
    ],
    lan: [
      ['ZeroTier', 'zerotier.com', 'https://www.zerotier.com/'],
      ['Tailscale', 'tailscale.com', 'https://tailscale.com/'],
      ['EasyTier', 'easytier.cn', 'https://easytier.cn/']
    ],
    tunnel: [
      ['cloudflared 下载', 'github.com/cloudflare', 'https://github.com/cloudflare/cloudflared/releases/latest'],
      ['Cloudflare 文档', 'developers.cloudflare.com', 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/']
    ]
  };
  function linkList(items) {
    return `<div class="link-list">${items.map(([name, host, url]) => `<a href="${esc(url)}" data-external="${esc(url)}" rel="noreferrer"><span>${esc(name)}</span><small>${esc(host)}</small><span class="link-arrow">↗</span></a>`).join('')}</div>`;
  }
  function connectCard(options) {
    const { name, color = '', title, copy, status, tone = '', body, actions = '' } = options;
    return `<article class="connect-card"><div class="connect-head"><span class="icon-box ${color}">${icon(name)}</span><div class="connect-title"><h2>${title}</h2><p>${copy}</p></div><span class="pill ${tone}"><i></i>${status}</span></div><div class="connect-body">${body}</div>${actions ? `<div class="connect-actions">${actions}</div>` : ''}</article>`;
  }
  function connect() {
    const live = Boolean(state.live), v6 = state.ipv6;
    const config = live ? state.server?.active || state.config || {} : {};
    const port = config.port || 3333;
    // IPv6：地址只来自外部接口，没有则明确显示“没有”；对外给出带端口的完整 URL，可直接粘贴到浏览器。
    const v6Url = v6?.ok ? `${config.https ? 'https' : 'http'}://[${v6.address}]:${port}/` : '';
    const v6Body = (!v6
      ? `<p class="connect-value is-empty">未检测</p><p class="connect-note">打开本页时经外部接口检测本机公网 IPv6，不读取本机网卡。</p>`
      : v6.ok
        ? `<p class="connect-value"><code>${esc(v6Url)}</code></p><p class="connect-note">${esc(v6.source)} · ${esc(v6.checkedAt)} 检测。地址可在公网路由，直接粘贴到浏览器即可访问；路由器与 Windows 防火墙仍需放行 ${esc(port)} 端口。</p>`
        : `<p class="connect-value is-empty">没有</p><p class="connect-note">${esc(v6.reason || '没有探测到公网 IPv6。')}可改用下面的中转方式。</p>`) +
      `<p class="connect-hint">如果你有 IPv4 公网地址，那么应该不需要我教你其他的了。</p>`;
    const v6Actions = `${button(v6 ? '重新检测' : '检测 IPv6', 'probe-ipv6', 'refresh')}${v6?.ok ? `<button class="btn" data-copy="${esc(v6Url)}">${icon('copy')}复制地址</button>` : ''}`;

    const frpState = live ? state.server.frp : '';
    const frpLabels = { registered: '已连通', connecting: '连接中', error: '异常' };
    // 服务商节点与自建服务器共用同一个本机 frpc，状态标签前加 frpc 前缀，避免两张卡片看起来各连一条。
    const frpStatus = live ? `frpc ${frpLabels[frpState] || '未连接'}` : '';

    const tunnel = live ? state.server.tunnel : null;
    const tunnelLabels = { stopped: '未运行', connecting: '连接中', stopping: '停止中', error: '异常' };
    const tunnelStatus = !tunnel || !tunnel.available ? '需安装' : tunnel.state === 'running' ? '已连通' : tunnelLabels[tunnel.state] || '未运行';
    const tunnelBusy = Boolean(tunnel) && ['connecting', 'running'].includes(tunnel.state);
    let tunnelBody;
    if (!tunnel) {
      tunnelBody = `<p class="connect-value is-empty">桌面版中可用</p><p class="connect-note">cloudflared 由本机向外建立隧道，不需要公网 IP 与端口映射；临时地址随隧道关闭失效，固定域名需一张外国银行卡。</p>`;
    } else if (!tunnel.available) {
      tunnelBody = `<p class="connect-value is-empty">未找到 cloudflared</p><p class="connect-note">下载 cloudflared.exe 放到运行包目录（或加入 PATH）后重新打开本页。</p>`;
    } else if (tunnel.url) {
      tunnelBody = `<p class="connect-value"><code>${esc(tunnel.url)}</code></p><p class="connect-note">本机 127.0.0.1:${esc(port)} 经 Cloudflare 中转到该地址，仅本次会话有效。</p>`;
    } else {
      tunnelBody = `<p class="connect-value is-empty">${tunnelLabels[tunnel.state] || '未运行'}</p><p class="connect-note">${tunnel.state === 'error' ? '隧道已退出，请查看运行日志。' : '启动后由 Cloudflare 分配临时地址，稍候片刻。'}</p>`;
    }
    const tunnelActions = !tunnel || !tunnel.available
      ? `<a class="btn" href="https://github.com/cloudflare/cloudflared/releases/latest" data-external="https://github.com/cloudflare/cloudflared/releases/latest">${icon('download')}下载 cloudflared</a>`
      : `${button(tunnelBusy ? '停止隧道' : '启动隧道', tunnelBusy ? 'tunnel-stop' : 'tunnel-start', tunnelBusy ? 'stop' : 'cloud', 'primary')}${tunnel.url ? `<button class="btn" data-copy="${esc(tunnel.url)}">${icon('copy')}复制地址</button>` : ''}`;

    return heading('连接方式', '从外网访问本机服务的五种方式，按需选择一种。', tutorial('connect')) +
      `<div class="connect-grid">${
        connectCard({
          name: 'globe', color: 'orange', title: 'IPv6 直连', copy: '运营商下发公网 IPv6 时，外网设备直接访问该地址。',
          status: !v6 ? '未检测' : v6.ok ? '可用' : '没有', tone: v6?.ok ? 'green' : '',
          body: v6Body, actions: v6Actions
        })
      }${
        connectCard({
          name: 'network', title: '服务商 FRP', copy: '用服务商提供的公网节点做内网穿透，注册即用。',
          status: live ? frpStatus : '需注册', tone: frpState === 'registered' ? 'green' : '',
          body: `<p class="connect-note">注册服务商后，把它给出的服务器地址、端口与 Token 填进本机 FRP，客户端仍是同一个 frpc。访问地址、端口与带宽由服务商决定，免费节点通常限速；本机同一时间只连接一台服务器，换地址即切换。</p>${linkList(connectLinks.frpProvider)}`,
          actions: `<button class="btn primary" data-frp-open="client">${icon('arrow')}配置本机 FRP</button>`
        })
      }${
        connectCard({
          name: 'server', title: '自建 FRP', copy: '在自己的 VPS 上运行 frps，端口与带宽完全自管。',
          status: live ? frpStatus : '需 VPS', tone: frpState === 'registered' ? 'green' : '',
          body: `<p class="connect-note">自己的 VPS 运行 frps，本机 frpc 连自己的服务器。端口、域名与带宽全自管，需在 VPS 安全组与系统防火墙放行映射端口；控制台可生成两端配置。</p>${linkList(connectLinks.frpSelf)}`,
          actions: `<button class="btn primary" data-frp-open="server">${icon('server')}生成 frps 配置</button>`
        })
      }${
        connectCard({
          name: 'link', title: '虚拟局域网', copy: '让外网设备与本机加入同一虚拟网络，再用虚拟 IP 访问。',
          status: '需客户端',
          body: `<p class="connect-note">每台设备都要安装同一款虚拟局域网软件并加入同一网络，用分配的虚拟 IP 访问本机。本机服务需监听局域网或双栈地址。</p>${linkList(connectLinks.lan)}`,
          actions: `<button class="btn" data-nav="settings">${icon('settings')}调整监听范围</button>`
        })
      }${
        connectCard({
          name: 'cloud', title: 'Cloudflare Tunnel', copy: 'cloudflared 从本机向外建立隧道，由 Cloudflare 分配地址。',
          status: tunnelStatus, tone: tunnel?.state === 'running' ? 'green' : '',
          body: tunnelBody + linkList(connectLinks.tunnel), actions: tunnelActions
        })
      }</div>` +
      `<div class="footnote">${icon('info')}没有公网 IPv4 时，服务商 FRP、自建 FRP、虚拟局域网与 Cloudflare Tunnel 都能中转；同一时间建议只保留一条入口。</div>`;
  }
  function filteredEvents() { return state.events.filter(e => (state.logLevel === 'all' || e.level === state.logLevel) && (state.logSource === 'all' || e.source === state.logSource) && `${e.message} ${e.source}`.toLowerCase().includes(state.logSearch.toLowerCase())); }
  function logLines() { return filteredEvents().map(e => `<div class="log-line"><span class="log-time">${esc(e.time)}</span><span class="log-level ${e.level}">${esc(e.level)}</span><span class="log-source">${esc(e.source)}</span><span class="log-message">${esc(e.message)}</span></div>`).join('') || '<div class="empty">没有匹配的日志</div>'; }
  function logs() {
    return heading('运行日志', '查看控制台操作记录；后端日志在服务接入后显示。', button('导出日志', 'export-logs', 'download')) + `<section class="panel"><div class="log-toolbar"><input class="search-input" id="log-search" aria-label="搜索日志" placeholder="搜索日志内容…" value="${esc(state.logSearch)}"><select id="log-source" aria-label="服务筛选"><option value="all">全部服务</option>${['console', 'backend', 'voice', 'cert', 'frp', 'tunnel', 'cli', 'update'].map(s => `<option ${s === state.logSource ? 'selected' : ''}>${s}</option>`).join('')}</select><select id="log-level" aria-label="日志级别"><option value="all">全部级别</option><option ${state.logLevel === 'INFO' ? 'selected' : ''}>INFO</option><option ${state.logLevel === 'WARN' ? 'selected' : ''}>WARN</option></select>${button(state.paused ? '继续显示' : '暂停显示', 'pause-logs', state.paused ? 'play' : 'pause')}</div><div class="log-view" id="log-lines">${logLines()}</div><div class="code-footer"><span id="log-count">${filteredEvents().length} 条 · ${state.paused ? '已暂停显示' : '操作记录'}</span><span class="log-caption">${icon('info')}仅演示事件，未读取服务日志</span></div></section><div class="help-card"><strong>日志保存方式</strong><p>按来源分流，达到 2 MB 后滚动保存；导出前屏蔽 Token、JWT 与私钥。</p></div>`;
  }
  function settings() {
    const info = state.info?.runtime;
    function toggle(key, title, text) { return `<div class="switch-row"><div><strong>${title}</strong><p>${text}</p></div><button class="switch" role="switch" aria-label="${title}" aria-checked="${state.prefs[key]}" data-pref="${key}"></button></div>`; }
    return heading('应用设置', '调整窗口、托盘与启动行为。') + `<div class="settings-grid"><section><div class="panel"><div class="panel-heading"><h2>窗口与系统托盘</h2><span class="pill ${state.native ? 'green' : ''}">${state.native ? '原生托盘已启用' : '浏览器预览'}</span></div>${toggle('closeToTray', '关闭窗口时最小化到托盘', '从通知区域恢复窗口。')}${toggle('remember', '记住界面偏好', '在本机保存界面偏好，不保存认证 Token。')}<div class="switch-row"><div><strong>登录 Windows 后启动</strong><p>尚未接入，未修改系统自启。</p></div><span class="pill">后续接入</span></div><div class="switch-row"><div><strong>启动时自动运行服务</strong><p>与登录启动相互独立。</p></div><span class="pill">后续接入</span></div></div><div class="panel section-title"><div><h2>托盘交互</h2><p class="settings-description">${state.native ? '关闭按钮按上方偏好处理。' : '桌面窗口使用系统托盘；浏览器中可预览菜单。'}</p></div>${button('预览菜单', 'tray-preview', 'tray')}</div><div class="help-card"><strong>系统托盘与系统服务</strong><p>桌面程序可隐藏窗口并常驻通知区域，无需安装系统服务。</p></div></section><aside class="panel"><div class="about-mark"><img src="app-icon.png" alt="ZViewer 标志"><div><h2>ZViewer</h2><p>WINDOWS DESKTOP</p></div></div><div class="version">0.1.0 <small>LOCAL BUILD</small></div><p class="settings-description">Windows 桌面控制台<br>网页端与命令行运行包独立部署。</p><div class="panel-line"></div><div class="subheading">本地运行包</div>${[['backend', 'zviewer-backend.exe'], ['cert', 'zviewer-cert.exe'], ['livekit', 'livekit-server.exe'], ['web', 'frontend/dist']].map(([key, label]) => `<div class="file-check"><code>${label}</code><span>${info ? (info[key] ? '已检测到' : '未找到') : '桌面版中检测'}</span></div>`).join('')}<p class="certificate-note">文件存在表示运行包可用，不代表进程已启动。</p></aside></div>`;
  }
  function navigate(page) { if (!titles[page]) page = 'overview'; state.page = page; if (location.hash !== `#${page}`) location.hash = page; else render(); }
  // 左上角状态卡：绿点=主服务运行中，红点=未启动；按钮与服务总览共用 toggle-run。
  function syncWorkspace() {
    const dot = $('#workspace-dot'), label = $('#workspace-state'), button = $('#workspace-action');
    if (!label || !button) return;
    const backend = state.live ? state.server?.backend || 'stopped' : state.running ? 'running' : 'stopped';
    const running = backend === 'running';
    const busy = backend === 'starting' || backend === 'stopping';
    const port = state.live ? state.server?.active?.port || state.config?.port : '';
    const text = running ? `运行中${port ? ` · ${port}` : ''}` : ({ starting: '启动中', stopping: '停止中', error: '运行异常' })[backend] || '未启动';
    label.textContent = text;
    if (dot) {
      dot.dataset.state = running ? 'running' : 'stopped';
      dot.setAttribute('aria-label', running ? 'ZViewer 运行中' : 'ZViewer 未启动');
    }
    button.textContent = running ? '停止' : '启动';
    button.disabled = busy;
    button.setAttribute('aria-label', running ? '停止 ZViewer 服务' : '启动 ZViewer 服务');
  }
  function render() {
    const main = $('#main'), pageView = $('#page-view'), cliView = $('#cli-view');
    const frame = cliView.querySelector('#cli-settings-frame');
    main.dataset.view = state.page;
    pageView.hidden = state.page === 'cli'; cliView.hidden = state.page !== 'cli';
    $('#crumb').textContent = titles[state.page];
    document.querySelectorAll('[data-page]').forEach(a => { const active = a.dataset.page === state.page; a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    const markup = (state.live && state.views ? state.views : { overview, connect, frp, cert, cli, logs, settings })[state.page]();
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
    syncWorkspace();
    if (state.live && state.page === 'cli') window.dispatchEvent(new Event('zviewer-cli-visible'));
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
    else if (name === 'open-manager') modal(`<h2>打开本机管理页面</h2><div class="dns-example">https://localhost:3333</div><p>服务尚未接入。正式版本会先确认服务与证书就绪，再打开默认浏览器。</p><div class="modal-actions">${button('查看本机 HTTPS', 'go-cert', 'shield')}${button('知道了', 'close-modal', '', 'primary')}</div>`);
    else if (name === 'go-cert') { $('#modal').close(); navigate('cert'); }
    else if (name === 'local-cert') localCertDemo();
    else if (name === 'probe-ipv6') toast('公网 IPv6 检测在 Windows 桌面版中执行');
    else if (name === 'tunnel-start' || name === 'tunnel-stop') toast('Cloudflare Tunnel 在 Windows 桌面版中启动');
    else if (name === 'close-modal') $('#modal').close();
    else if (name === 'open-update') openUpdate();
    else if (name === 'update-check') await updateCommand('update-check');
    else if (name === 'update-download') await updateCommand('update-download');
    else if (name === 'update-apply') { const ok = await updateCommand('update-apply'); if (ok) toast('正在退出并安装更新'); }
    else if (name === 'update-page') await updateCommand('update-page');
    else if (name === 'update-auto') {
      if (!state.live) { toast('自动检查在 Windows 桌面版中生效'); return; }
      await updateCommand('save', { config: { autoCheckUpdate: !updateReport()?.autoCheck } });
      state.updateKey = '';
      $('#modal-content').innerHTML = updateModal();
    }
    else if (name === 'update-proxy') {
      if (!state.live) { toast('前置反代在 Windows 桌面版中生效'); return; }
      const report = updateReport();
      const enabled = !Boolean(state.config?.updateProxy ?? report?.proxy);
      const url = $('#update-proxy-url')?.value.trim() || state.config?.updateProxyUrl || 'https://gh-proxy.com';
      toast(enabled ? '正在按该反代重新检查更新…' : '已关闭前置反代，正在重新检查…');
      const next = await updateCommand('update-proxy', { enabled, url });
      if (!next) return;
      state.config = { ...state.config, updateProxy: enabled, updateProxyUrl: url };
      patchUpdateProxy(enabled, url);
      state.updateKey = '';
      $('#modal-content').innerHTML = updateModal();
    }
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
  $('#modal').addEventListener('close', () => { state.updateOpen = false; });
  document.addEventListener('click', event => {
    if (!event.target.closest('.tutorial')) closeTutorials();
    const tutorialToggle = event.target.closest('[data-tutorial-toggle]');
    if (tutorialToggle) {
      const menu = tutorialToggle.parentElement.querySelector('.tutorial-menu');
      const willOpen = menu.hidden;
      closeTutorials();
      if (willOpen) { menu.hidden = false; tutorialToggle.setAttribute('aria-expanded', 'true'); }
      return;
    }
    if (event.target.closest('[data-tutorial-close]')) { closeTutorials(); return; }
    const external = event.target.closest('[data-external]');
    if (external) {
      event.preventDefault();
      const url = external.dataset.external;
      // 桌面端走 Wails 运行时用系统浏览器打开；浏览器预览退化为新标签页。
      if (window.runtime?.BrowserOpenURL) window.runtime.BrowserOpenURL(url);
      else window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    const copyTarget = event.target.closest('[data-copy]');
    if (copyTarget) {
      navigator.clipboard.writeText(copyTarget.dataset.copy)
        .then(() => toast('已复制地址'))
        .catch(() => toast('剪贴板不可用，可手动选择地址复制'));
      return;
    }
    const tutorialSection = event.target.closest('[data-tutorial-section]');
    if (tutorialSection) {
      const open = tutorialSection.closest('.tutorial-section').dataset.open === 'true';
      tutorialSection.closest('.tutorial-section').dataset.open = String(!open);
      tutorialSection.setAttribute('aria-expanded', String(!open));
      return;
    }
    const windowButton = event.target.closest('[data-window]');
    if (windowButton) { if (window.zviewerDesktop) window.zviewerDesktop.window(windowButton.dataset.window); else toast('窗口控制仅在 Windows 桌面版可用'); return; }
    const frpOpen = event.target.closest('[data-frp-open]');
    if (frpOpen) { state.frpTab = frpOpen.dataset.frpOpen === 'server' ? 'server' : 'client'; navigate('frp'); return; }
    const nav = event.target.closest('[data-nav]'); if (nav) { navigate(nav.dataset.nav); return; }
    const btn = event.target.closest('[data-action]'); if (btn) { action(btn.dataset.action).catch(error => toast(`操作未完成：${error.message}`)); return; }
    const frpTab = event.target.closest('[data-frp-tab]'); if (frpTab) { state.frpTab = frpTab.dataset.frpTab; render(); return; }
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
    if (target.id === 'log-search') { state.logSearch = target.value; if (!state.paused) refreshLogs(); }
  });
  document.addEventListener('change', event => {
    const target = event.target;
    if (target.matches('[data-frp-check]')) { state.frp[target.dataset.frpCheck] = target.checked; $('#frp-code').textContent = frpConfig(state.frpTab === 'server'); }
    if (target.id === 'log-source') { state.logSource = target.value; if (!state.paused) refreshLogs(); }
    if (target.id === 'log-level') { state.logLevel = target.value; if (!state.paused) refreshLogs(); }
    if (target.id === 'update-proxy-url') applyProxyURL(target);
  });
  function refreshLogs() { $('#log-lines').innerHTML = logLines(); $('#log-count').textContent = `${filteredEvents().length} 条 · ${state.live ? '运行日志' : '操作记录'}`; }
  $('#tray-button').addEventListener('click', () => { if (window.zviewerDesktop) window.zviewerDesktop.window('tray'); else action('tray-preview'); });
  $('#docs-link').addEventListener('click', () => action('docs'));
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey && event.key.toLowerCase() === 'r') || event.key === 'F5') { event.preventDefault(); location.reload(); }
    if (event.key === 'Escape') closeTutorials();
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
  window.ZViewerUI = { state, icon, esc, heading, button, notice, tutorial, render, navigate, toast, modal, preview: { overview, connect, frp, cert, cli, logs, settings, updateModal, syncUpdate }, refreshLogs, syncWorkspace };
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
