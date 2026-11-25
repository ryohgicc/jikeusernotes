(() => {
  'use strict';
  if (window.top !== window) return;

  const host = document.createElement('div');
  host.dataset.jknFloating = '';
  const shadow = host.attachShadow({ mode: 'open' });
  let icon;
  try { icon = chrome.runtime.getURL('assets/jike-logo.svg'); } catch { return; }
  shadow.innerHTML = `<style>
    :host { all: initial; }
    .ball { position: fixed; right: 20px; bottom: 84px; z-index: 2147483640; width: 48px; height: 48px;
      padding: 5px; border: 0; border-radius: 50%; background: #fff; box-shadow: 0 4px 18px #0003;
      cursor: pointer; transition: transform .15s, box-shadow .15s; }
    .ball:hover, .ball:focus-visible { transform: scale(1.07); box-shadow: 0 6px 24px #0004; outline: 2px solid #c9a441; outline-offset: 2px; }
    .ball img { display: block; width: 100%; height: 100%; border-radius: 50%; }
    .menu { position: fixed; right: 20px; bottom: 140px; z-index: 2147483640; display: none; width: 260px;
      box-sizing: border-box; max-width: calc(100vw - 16px); max-height: calc(100dvh - 24px); overflow-y: auto;
      padding: 8px; border: 1px solid #eee; border-radius: 14px; background: #fff;
      box-shadow: 0 8px 30px #0003; font: 14px/1.5 system-ui, sans-serif; }
    .menu.open { display: grid; gap: 4px; animation: jkn-menu-in .16s cubic-bezier(.22, 1, .36, 1) both; transform-origin: bottom right; }
    .menu button { padding: 9px 10px; border: 0; border-radius: 9px; background: transparent; color: #222;
      font: inherit; text-align: left; cursor: pointer; }
    .menu button:hover, .menu button:focus-visible { background: #fff5cd; outline: none; }
    .stats { border-top: 1px solid #eee; padding: 12px 10px 6px; margin-top: 4px; color: #777; font-size: 11px; }
    .stats h3 { margin: 0 0 8px; font-size: 12px; font-weight: 500; color: #555; }
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
    .stats-grid strong { display: block; color: #282a28; font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .stats p { margin: 10px 0 0; color: #999; font-size: 10px; }
    .overlay { position: fixed; inset: 0; z-index: 2147483641; display: none; overflow: auto;
      padding: 32px 16px; background: #0006; font: 14px/1.6 system-ui, sans-serif; }
    .overlay.open { display: flex; align-items: flex-start; justify-content: center; }
    .panel { width: min(420px, 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 16px 64px #0005; }
    @keyframes jkn-menu-in { from { opacity: 0; transform: translateY(6px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
  </style>
  <button class="ball" type="button" aria-label="打开即刻阅读工具"><img alt="即刻" src="${icon}"></button>
  <nav class="menu" aria-label="即刻阅读工具">
    <button type="button" data-action="top">回到顶部</button>
    <button type="button" data-action="restore">回到上次浏览位置</button>
    <button type="button" data-action="settings">设置</button>
    <section class="stats" aria-label="浏览统计">
      <h3>浏览统计</h3>
      <div class="stats-grid">
        <div>今日时长<strong data-stat="today-time">—</strong></div>
        <div>累计时长<strong data-stat="total-time">—</strong></div>
        <div>今日动态<strong data-stat="today-posts">—</strong></div>
        <div>累计动态<strong data-stat="total-posts">—</strong></div>
      </div>
      <p data-stats-note>仅统计前台浏览 · 动态停留 1 秒计入</p>
    </section>
  </nav>
  <div class="overlay" role="dialog" aria-modal="true" aria-label="即刻私人备注设置"><div class="panel"></div></div>`;

  const ball = shadow.querySelector('.ball');
  const menu = shadow.querySelector('.menu');
  const overlay = shadow.querySelector('.overlay');
  const panel = shadow.querySelector('.panel');
  addEventListener('jkn-context-expired', () => {
    host.dataset.jknExpired = '';
    panelMounted = false;
    overlay.classList.remove('open');
    menu.classList.remove('open');
    ball.title = '扩展已更新，请刷新即刻页面';
    ball.setAttribute('aria-label', ball.title);
  });
  let panelMounted = false;
  let dragging = false;
  let moved = false;
  let suppressClick = false;

  function formatTime(milliseconds) {
    const seconds = Math.floor((milliseconds || 0) / 1000);
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes} 分 ${seconds % 60} 秒` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
  }
  function renderStats(data) {
    if (host.hasAttribute('data-jkn-expired')) return;
    const missing = !data || data.error || data.unavailable;
    for (const [name, value] of Object.entries({
      'today-time': formatTime(data?.todayMs), 'total-time': formatTime(data?.totalMs),
      'today-posts': `${data?.todayPosts || 0} 条`, 'total-posts': `${data?.totalPosts || 0} 条`
    })) shadow.querySelector(`[data-stat="${name}"]`).textContent = missing ? '—' : value;
    shadow.querySelector('[data-stats-note]').textContent = data?.error ? '统计暂不可用，请刷新页面后重试'
      : data?.unavailable ? '登录即刻后开始统计' : '前台浏览时计时 · 动态停留 1 秒计入并去重';
  }

  function supported() {
    const path = location.pathname.replace(/\/$/, '') || '/';
    return path === '/' || path === '/following' || path === '/explore' || /^\/u\/[a-zA-Z0-9_-]{1,128}$/.test(path);
  }

  function updateVisibility() { host.style.display = supported() ? '' : 'none'; }

  function scrollRoot() {
    const main = document.querySelector('[class*="_mainContainer_"]');
    for (let node = main; node && node !== document.body; node = node.parentElement) {
      if (node.clientHeight > 100 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
    }
    return document.scrollingElement;
  }
  function closeMenu() { menu.classList.remove('open'); }
  function positionMenu() {
    if (!menu.classList.contains('open')) return;
    const rect = ball.getBoundingClientRect();
    menu.style.bottom = 'auto';
    menu.style.top = `${Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, rect.top - menu.offsetHeight - 8))}px`;
    menu.style.right = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, innerWidth - rect.right))}px`;
  }
  function openSettings() {
    closeMenu();
    if (!panelMounted) {
      window.JknSettingsPanel?.mount(panel, { close: () => overlay.classList.remove('open') });
      panelMounted = true;
    }
    overlay.classList.add('open');
  }

  ball.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragging = true;
    moved = false;
    ball.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const startRight = parseFloat(getComputedStyle(ball).right);
    const startBottom = parseFloat(getComputedStyle(ball).bottom);
    function move(moveEvent) {
      if (!dragging) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      ball.style.right = `${Math.max(8, Math.min(innerWidth - 56, startRight - dx))}px`;
      ball.style.bottom = `${Math.max(8, Math.min(innerHeight - 56, startBottom - dy))}px`;
      menu.style.right = ball.style.right;
      menu.style.bottom = `calc(${ball.style.bottom} + 56px)`;
      positionMenu();
    }
    function end() {
      dragging = false;
      if (moved) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
      ball.removeEventListener('pointermove', move);
      ball.removeEventListener('pointerup', end);
      ball.removeEventListener('pointercancel', end);
    }
    ball.addEventListener('pointermove', move);
    ball.addEventListener('pointerup', end);
    ball.addEventListener('pointercancel', end);
  });
  ball.addEventListener('click', () => {
    if (suppressClick) return;
    if (host.hasAttribute('data-jkn-expired')) {
      menu.classList.toggle('open');
      menu.textContent = '扩展已更新，请刷新即刻页面后继续使用。';
      menu.style.padding = '16px';
      positionMenu();
      return;
    }
    menu.classList.toggle('open');
    positionMenu();
    if (menu.classList.contains('open')) window.JknBrowsingStats?.get().then(renderStats);
  });
  shadow.querySelector('[data-action="top"]').addEventListener('click', () => {
    closeMenu();
    window.dispatchEvent(new CustomEvent('jkn-reading-top'));
    scrollRoot()?.scrollTo({ top: 0, behavior: 'smooth' });
  });
  shadow.querySelector('[data-action="restore"]').addEventListener('click', () => {
    closeMenu();
    window.dispatchEvent(new CustomEvent('jkn-restore-reading'));
  });
  shadow.querySelector('[data-action="settings"]').addEventListener('click', openSettings);
  overlay.addEventListener('click', event => { if (event.target === overlay) overlay.classList.remove('open'); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeMenu(); overlay.classList.remove('open'); }
  });
  document.addEventListener('click', event => {
    if (!event.composedPath().includes(host)) closeMenu();
  }, true);
  updateVisibility();
  setInterval(updateVisibility, 500);
  addEventListener('resize', positionMenu);
  setInterval(() => {
    if (!host.hasAttribute('data-jkn-expired') && menu.classList.contains('open')) renderStats(window.JknBrowsingStats?.peek());
  }, 1000);
  document.documentElement.append(host);
})();
