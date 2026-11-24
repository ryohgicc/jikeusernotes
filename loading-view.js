(() => {
  'use strict';

  function mount(shadow, message) {
    shadow.innerHTML = `<style>
      :host { all: initial; position: fixed; inset: 0; width: 100vw; height: 100dvh;
        display: grid; place-items: center; z-index: 2147483639; background: #f7f7f5;
        color: #282a28; color-scheme: light; overscroll-behavior: contain; touch-action: none;
        font: 14px/1.6 system-ui, sans-serif; animation: arrive .22s ease-out both;
        --paper: #fff; --line: #e9e9e2; --muted: #8b8e85; --ink: #282a28; }
      :host([data-jkn-reading-closing]) { animation: leave .22s ease-in both; pointer-events: none; }
      * { box-sizing: border-box; }
      .view { width: min(380px, calc(100vw - 40px)); padding: 20px 0; text-align: center; }
      .brand { display: flex; justify-content: center; align-items: center; gap: 7px;
        color: var(--muted); font-size: 11px; letter-spacing: 2px; }
      .brand svg { width: 18px; height: 18px; }
      .scene { position: relative; width: 300px; max-width: 100%; height: 228px; margin: 18px auto 12px; }
      .halo { position: absolute; inset: 16px 30px; border-radius: 50%;
        background: radial-gradient(ellipse, #ffe41127, #ffe41100 72%); }
      .track { position: absolute; inset: 0 20px; overflow: hidden;
        mask-image: linear-gradient(transparent, #000 18%, #000 80%, transparent); }
      .stream { padding-top: 6px; animation: leaf 7s linear infinite; }
      .card { position: relative; height: 86px; margin-bottom: 14px; padding: 16px 18px;
        border: 1px solid var(--line); border-radius: 14px; background: var(--paper);
        box-shadow: 0 4px 12px #20241804; text-align: left; }
      .avatar { display: inline-block; width: 22px; height: 22px; border-radius: 50%; background: #efefe8; }
      .name { display: inline-block; width: 56px; height: 6px; margin: 0 0 8px 8px;
        border-radius: 4px; background: #e4e5dc; }
      .line { height: 5px; width: 90%; margin-top: 8px; border-radius: 4px; background: #f0f0ea; }
      .line.short { width: 62%; }
      .card:nth-child(2n) .avatar { background: #eee6c5; }
      .card:nth-child(2n) .name { width: 76px; }
      .bookmark { position: absolute; right: 7px; top: 83px; width: 57px; height: 66px;
        filter: drop-shadow(0 8px 12px #a5933440); transform: rotate(9deg);
        animation: hover 3.6s ease-in-out infinite; }
      .bookmark svg { width: 100%; height: 100%; }
      .pin { position: absolute; left: 14px; top: 109px; width: 8px; height: 8px;
        border: 2px solid #b6aa62; border-radius: 50%; background: #fff7ce;
        box-shadow: 0 0 0 5px #e6dc9d33; }
      .path { position: absolute; left: 22px; right: 57px; top: 113px; border-top: 1px dashed #c6b96788; }
      h2 { margin: 0 0 8px; color: var(--ink); font-size: 24px; font-weight: 600;
        line-height: 1.4; letter-spacing: -.5px; }
      .description { margin: 0; min-height: 24px; color: var(--muted); font-size: 13px; }
      .activity { display: flex; justify-content: center; gap: 8px; align-items: center;
        margin: 20px auto 9px; color: #787c71; font-size: 12px; font-variant-numeric: tabular-nums; }
      .dot { width: 5px; height: 5px; border-radius: 50%; background: #b5a341; }
      .separator { color: #c9ccc2; }
      .meter { height: 2px; width: 170px; margin: auto; overflow: hidden;
        border-radius: 2px; background: var(--line); }
      .meter i { display: block; height: 100%; width: 65px; border-radius: 2px;
        background: #d2b945; animation: travel 2.4s ease-in-out infinite; }
      .steps { display: flex; justify-content: center; gap: 15px; margin: 20px 0 0;
        color: #a1a59a; font-size: 11px; }
      .steps .active { color: var(--ink); }
      .steps .done { color: #9c8a37; }
      button { margin-top: 25px; padding: 8px 22px; border: 1px solid #dfe0d7; border-radius: 24px;
        color: #777b70; background: transparent; font: inherit; font-size: 12px; cursor: pointer;
        transition: background .15s, color .15s; }
      button:hover { color: var(--ink); background: var(--paper); }
      button:focus-visible { outline: 2px solid #c2a63a; outline-offset: 4px; }
      :host([data-phase="align"]) .stream, :host([data-phase="align"]) .bookmark { animation-play-state: paused; }
      :host([data-phase="align"]) .meter i { width: 100%; animation: none; }
      :host([data-paused]) *, :host([data-paused]) *::before { animation-play-state: paused !important; }
      @keyframes leaf { to { transform: translateY(-200px); } }
      @keyframes hover { 50% { transform: translateY(-6px) rotate(4deg); } }
      @keyframes travel { from { transform: translateX(-65px); } to { transform: translateX(170px); } }
      @keyframes arrive { from { opacity: 0; } to { opacity: 1; } }
      @keyframes leave { from { opacity: 1; } to { opacity: 0; } }
      @media (prefers-reduced-motion: reduce) {
        :host, :host([data-jkn-reading-closing]) { animation: none; }
        *, *::before { animation: none !important; transition: none !important; }
      }
      @media (max-height: 590px) {
        .scene { height: 150px; margin: 8px auto; } .bookmark { top: 45px; } .pin { top: 71px; } .path { top: 75px; }
        .steps { margin-top: 12px; } button { margin-top: 14px; } .activity { margin-top: 12px; }
      }
      @media (max-height: 420px) { .scene { display: none; } h2 { margin-top: 20px; } }
      @media (prefers-color-scheme: dark) {
        :host { background: #181818; color: #e3e5dd; color-scheme: dark;
          --paper: #232422; --line: #343630; --muted: #94998b; --ink: #e3e5dd; }
        .avatar { background: #36392e; } .card:nth-child(2n) .avatar { background: #4b452f; }
        .name { background: #414638; } .line { background: #30332d; }
        button { border-color: #42463a; color: #a3a995; } .activity { color: #a3a995; }
      }
    </style>
    <section class="view" aria-label="恢复阅读位置" aria-busy="true">
      <div class="brand"><svg viewBox="0 0 38 37" aria-hidden="true"><rect width="37" height="37" rx="9" fill="#ffe411"/><path d="M17 7h6v12c0 6-2 9-8 13l-4-5c5-3 6-4 6-8Z" fill="#fff"/></svg>即刻 · 阅读足迹</div>
      <div class="scene" aria-hidden="true">
        <div class="halo"></div><div class="track"><div class="stream">
          ${Array.from({ length: 5 }, () => '<div class="card"><i class="avatar"></i><i class="name"></i><div class="line"></div><div class="line short"></div></div>').join('')}
        </div></div>
        <div class="path"></div><div class="pin"></div>
        <div class="bookmark"><svg viewBox="0 0 56 68"><path d="M8 2h40a4 4 0 0 1 4 4v56L28 49 4 62V6a4 4 0 0 1 4-4Z" fill="#ffe411"/><path d="m19 26 6 6 12-13" fill="none" stroke="#8d7916" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      </div>
      <h2>翻到上次，接着看。</h2>
      <p class="description" role="status" data-message></p>
      <div class="activity"><i class="dot"></i><span data-count>已查找 0 条动态</span><span class="separator">·</span><span data-elapsed>0 秒</span></div>
      <div class="meter" aria-hidden="true"><i></i></div>
      <div class="steps" aria-hidden="true"><span class="active">查找位置</span><span>›</span><span>对齐内容</span><span>›</span><span>继续阅读</span></div>
      <button type="button">取消查找</button>
    </section>`;
    const title = shadow.querySelector('h2');
    const description = shadow.querySelector('[data-message]');
    const count = shadow.querySelector('[data-count]');
    const elapsed = shadow.querySelector('[data-elapsed]');
    const steps = shadow.querySelector('.steps');
    description.textContent = message;
    let lastUpdate = '';
    function update({ phase, seen, seconds, paused }) {
      const key = `${phase}:${seen}:${seconds}:${paused}`;
      if (key === lastUpdate) return;
      lastUpdate = key;
      shadow.host.dataset.phase = phase;
      shadow.host.toggleAttribute('data-paused', paused);
      title.textContent = phase === 'align' ? '找到了，就在这里。' : '翻到上次，接着看。';
      const next = phase === 'align' ? '正在对齐阅读位置，即将展示内容' : phase === 'load'
        ? '正在加载更早的动态，请稍等一下' : seconds >= 15
          ? '记录有些久，正在往更早的动态里找' : message;
      if (description.textContent !== next) description.textContent = next;
      count.textContent = `已查找 ${seen} 条动态`;
      elapsed.textContent = `${seconds} 秒`;
      steps.children[0].className = phase === 'align' ? 'done' : 'active';
      steps.children[2].className = phase === 'align' ? 'active' : '';
    }
    return { update };
  }

  window.JknLoadingView = { mount };
})();
