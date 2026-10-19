// Wails 桥接层：把 Go 绑定包装成 Electron preload 暴露的同名 API。
// Electron 下 preload 已注入 window.zviewerDesktop，这里的判断会直接跳过；
// 浏览器预览（preview-server）也不会命中，界面仍走演示态。
(() => {
  'use strict';
  if (window.zviewerDesktop) return;
  const native = location.hostname === 'wails.localhost' || location.protocol === 'wails:';
  if (!native) return;

  // 让页面透出 Mica 材质：body 透明由 styles.css 的 html.mica 规则负责。
  document.documentElement.classList.add('mica');

  const app = () => window.go?.main?.App;
  const call = (method, ...args) => {
    const fn = app()?.[method];
    if (typeof fn !== 'function') return Promise.reject(new Error('桌面桥接尚未就绪：' + method));
    return Promise.resolve(fn(...args));
  };
  const on = (event, callback) => {
    const bind = () => window.runtime?.EventsOn?.(event, callback);
    if (window.runtime) bind();
    else window.addEventListener('DOMContentLoaded', bind, { once: true });
  };

  window.zviewerDesktop = {
    info: () => call('Info'),
    command: (action, payload) => call('Command', action, payload || {}),
    window: action => call('Window', action),
    openDocs: () => call('OpenDocs'),
    onNavigate: callback => on('navigate', callback),
    onUpdate: callback => on('desktop-update', callback),
    demoState: () => Promise.resolve(),
    closeBehavior: () => {}
  };
})();
