// 主题：跟随系统 / 浅色 / 深色 三态循环，选择写入 localStorage。
// tokens.css 的深色令牌挂在 html.dark 上，所以只需切 class。
(() => {
  'use strict';
  const KEY = 'zviewer-theme-mode';
  const ORDER = ['system', 'light', 'dark'];
  const LABEL = { system: '主题：跟随系统', light: '主题：浅色', dark: '主题：深色' };
  const GLYPH = { light: '\uE706', dark: '\uE708', system: '\uE7F4' };
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const mode = () => (ORDER.includes(localStorage.getItem(KEY)) ? localStorage.getItem(KEY) : 'system');

  function apply() {
    const value = mode();
    const dark = value === 'dark' || (value === 'system' && media.matches);
    root.classList.toggle('dark', dark);
    root.dataset.theme = value;
    const button = document.getElementById('theme-button');
    if (button) {
      button.title = LABEL[value];
      button.setAttribute('aria-label', LABEL[value]);
      const glyph = button.querySelector('.icon-glyph');
      if (glyph) glyph.textContent = GLYPH[value === 'system' ? (dark ? 'dark' : 'light') : value];
    }
  }

  apply();

  media.addEventListener('change', () => { if (mode() === 'system') apply(); });

  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('theme-button')?.addEventListener('click', () => {
      localStorage.setItem(KEY, ORDER[(ORDER.indexOf(mode()) + 1) % ORDER.length]);
      apply();
    });
  });
})();
