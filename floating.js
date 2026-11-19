(() => {
  'use strict';
  if (window.top !== window) return;

  const host = document.createElement('div');
  host.dataset.jknFloating = '';
  const shadow = host.attachShadow({ mode: 'open' });
  const icon = chrome.runtime.getURL('assets/jike-logo.svg');
  shadow.innerHTML = `<style>
    :host { all: initial; }
    .ball { position: fixed; right: 20px; bottom: 84px; z-index: 2147483640; width: 48px; height: 48px;
      padding: 5px; border: 0; border-radius: 50%; background: #fff; box-shadow: 0 4px 18px #0003;
      cursor: pointer; transition: transform .15s, box-shadow .15s; }
    .ball:hover, .ball:focus-visible { transform: scale(1.07); box-shadow: 0 6px 24px #0004; outline: 2px solid #c9a441; outline-offset: 2px; }
    .ball img { display: block; width: 100%; height: 100%; border-radius: 50%; }
    .menu { position: fixed; right: 20px; bottom: 140px; z-index: 2147483640; display: none; width: 176px;
      padding: 8px; border: 1px solid #eee; border-radius: 14px; background: #fff;
      box-shadow: 0 8px 30px #0003; font: 14px/1.5 system-ui, sans-serif; }
    .menu.open { display: grid; gap: 4px; }
    .menu button { padding: 9px 10px; border: 0; border-radius: 9px; background: transparent; color: #222;
      font: inherit; text-align: left; cursor: pointer; }
    .menu button:hover, .menu button:focus-visible { background: #fff5cd; outline: none; }
    .overlay { position: fixed; inset: 0; z-index: 2147483641; display: none; overflow: auto;
      padding: 32px 16px; background: #0006; font: 14px/1.6 system-ui, sans-serif; }
    .overlay.open { display: flex; align-items: flex-start; justify-content: center; }
    .panel { width: min(420px, 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 16px 64px #0005; }
  </style>
  <button class="ball" type="button" aria-label="打开即刻阅读工具"><img alt="即刻" src="${icon}"></button>
  <nav class="menu" aria-label="即刻阅读工具">
    <button type="button" data-action="top">回到顶部</button>
    <button type="button" data-action="restore">回到上次浏览位置</button>
    <button type="button" data-action="settings">设置</button>
  </nav>
  <div class="overlay" role="dialog" aria-modal="true" aria-label="即刻私人备注设置"><div class="panel"></div></div>`;

  const ball = shadow.querySelector('.ball');
  const menu = shadow.querySelector('.menu');
  const overlay = shadow.querySelector('.overlay');
  const panel = shadow.querySelector('.panel');
  let panelMounted = false;
  let dragging = false;
  let moved = false;
  let suppressClick = false;

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
    menu.classList.toggle('open');
  });
  shadow.querySelector('[data-action="top"]').addEventListener('click', () => {
    closeMenu();
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
  document.documentElement.append(host);
})();
