(() => {
  'use strict';
  const prefix = 'jkn.reading.';
  const settingsKey = 'jkn.settings';
  const resetKey = 'jkn.readingResetAt';
  const defaults = { restoreReading: true, showReadingNotice: true };
  let settings = { ...defaults };
  let state = null;
  let notice;
  let noticeTimer;
  let saveTimer;
  let ready = false;
  let resetGeneration = 0;

  function route() {
    const path = location.pathname.replace(/\/$/, '') || '/';
    // A ?id= query is Jike's post drawer. Do not save its scrolling as the feed.
    if (new URLSearchParams(location.search).has('id')) return null;
    if (path === '/' || path === '/following') return '/following';
    if (path === '/explore' || /^\/u\/[a-zA-Z0-9_-]{1,128}$/.test(path)) return path;
    return null;
  }

  function account() {
    const label = document.querySelector('[title="个人主页"], [aria-label="个人主页"]');
    const link = label?.closest('a[href]');
    if (!link) return null;
    try {
      const url = new URL(link.href, location.href);
      const match = url.pathname.match(/^\/u\/([a-zA-Z0-9_-]{1,128})\/?$/);
      return url.origin === location.origin && match ? match[1] : null;
    } catch { return null; }
  }

  function keyNow() {
    const path = route();
    const user = account();
    return path && user ? prefix + user + ':' + path : null;
  }

  function scrollRoot(node) {
    for (let parent = node?.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      if (parent.clientHeight > 100 && /auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
    }
    return document.scrollingElement;
  }

  function rootForPage() {
    const main = document.querySelector('[class*="_mainContainer_"]');
    if (main) return scrollRoot(main);
    const post = document.querySelector('[data-jkn-post]');
    return post ? scrollRoot(post) : null;
  }

  function bounds(root) {
    if (root === document.scrollingElement) return { top: 0, bottom: innerHeight, height: innerHeight };
    const rect = root.getBoundingClientRect();
    const top = Math.max(0, rect.top + root.clientTop);
    const bottom = Math.min(innerHeight, rect.top + root.clientTop + root.clientHeight);
    return { top, bottom, height: Math.max(0, bottom - top) };
  }

  function posts(root) {
    return [...root.querySelectorAll('[data-jkn-post]')].filter(node =>
      /^[a-zA-Z0-9_-]{1,128}$/.test(node.getAttribute('data-jkn-post')) &&
      !node.closest('[role="dialog"], [aria-hidden="true"], [inert]') &&
      scrollRoot(node) === root && node.getBoundingClientRect().height > 0
    );
  }

  function setTop(root, top) {
    root.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  }

  function snapshot(s) {
    const box = bounds(s.root);
    const visible = posts(s.root).find(node => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > box.top + 1 && rect.top < box.bottom;
    });
    if (!visible || box.height === 0) return null;
    return {
      version: 1, id: visible.getAttribute('data-jkn-post'),
      offset: visible.getBoundingClientRect().top - box.top,
      top: s.root.scrollTop, savedAt: Date.now()
    };
  }

  function validRecord(record) {
    return record?.version === 1 && /^[a-zA-Z0-9_-]{1,128}$/.test(record.id) &&
      Number.isFinite(record.top) && record.top >= 0 &&
      Number.isFinite(record.offset) && Math.abs(record.offset) < 100000 &&
      Number.isFinite(record.savedAt);
  }

  function persist(s) {
    if (!s?.snapshot || !s.canSave || !settings.restoreReading) return;
    chrome.storage.local.set({ [s.key]: s.snapshot }).catch(() => {});
  }

  function sample(s) {
    if (state !== s || s.job || !s.root || !s.canSave || keyNow() !== s.key || document.hidden) return;
    const next = snapshot(s);
    if (next) s.snapshot = next;
  }

  function hideNotice() {
    clearTimeout(noticeTimer);
    notice?.remove();
    notice = null;
  }

  function showNotice(message, action, callback, persistent = false) {
    hideNotice();
    if (!persistent && !settings.showReadingNotice) return;
    const host = document.createElement('div');
    host.dataset.jknReadingUi = '';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host { all: initial; position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        z-index: 2147483647; width: max-content; max-width: calc(100vw - 32px); }
      div { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px;
        background: #242424; color: #fff; box-shadow: 0 4px 24px #0003; font: 14px/1.5 system-ui, sans-serif; }
      button { flex-shrink: 0; background: transparent; color: #ffe371; border: 0;
        padding: 6px; font: inherit; cursor: pointer; } button:focus-visible { outline: 2px solid #ffe371; }
    </style><div role="status"><span></span><button type="button"></button></div>`;
    shadow.querySelector('span').textContent = message;
    const button = shadow.querySelector('button');
    button.textContent = action || '关闭';
    button.addEventListener('click', () => { hideNotice(); callback?.(); });
    host.addEventListener('pointerdown', event => event.stopPropagation());
    document.documentElement.append(host);
    notice = host;
    if (!persistent) noticeTimer = setTimeout(hideNotice, 8000);
  }

  function cancel(s, goBack = false) {
    if (!s?.job) return;
    const start = s.job.startTop;
    s.job = null;
    s.canSave = false; // Searching must not overwrite the previous bookmark.
    hideNotice();
    if (goBack && s.root?.isConnected && keyNow() === s.key) setTop(s.root, start);
  }

  function complete(s, exact) {
    const job = s.job;
    s.job = null;
    // Only exact restoration or subsequent manual scrolling updates the bookmark.
    s.canSave = exact;
    if (exact) { sample(s); persist(s); }
    showNotice(exact ? '已恢复到上次阅读位置' : '未找到原动态，已回到近似位置', '撤销恢复', () => {
      if (state !== s || !s.root?.isConnected || keyNow() !== s.key) return;
      s.canSave = false;
      setTop(s.root, job.startTop);
    });
  }

  function advance(s, now) {
    const job = s.job;
    if (!job || !s.root) return;
    if (document.hidden) return;
    const list = posts(s.root);
    const target = list.find(node => node.getAttribute('data-jkn-post') === s.record.id);
    const age = now - job.began;
    if (age < 800) { job.startTop = s.root.scrollTop; return; } // Let native restoration finish first.
    if (target) {
      const delta = target.getBoundingClientRect().top - bounds(s.root).top - s.record.offset;
      setTop(s.root, s.root.scrollTop + delta);
      if (!job.aligned) job.aligned = now;
      if (now - job.aligned >= 1400) complete(s, true); // Correct late image/layout shifts.
      return;
    }
    job.aligned = null;
    if (list.length === 0 && !job.searched) {
      if (age >= 8000) {
        cancel(s);
        showNotice('当前页面未能识别动态，已保留上次阅读记录');
      }
      return;
    }
    if (age >= 30000 || job.steps >= 80 || (job.stalledAt && now - job.stalledAt > 6000)) {
      setTop(s.root, s.record.top);
      complete(s, false);
      return;
    }
    if (now < job.nextStep) return;
    if (!job.searched) {
      job.startTop = s.root.scrollTop;
      job.searched = true;
      setTop(s.root, s.record.top);
    } else if (!job.fromStart) {
      job.fromStart = true;
      setTop(s.root, 0);
    } else {
      const max = s.root.scrollHeight - s.root.clientHeight;
      if (s.root.scrollTop >= max - 2) {
        if (job.lastHeight !== s.root.scrollHeight) job.stalledAt = now;
        else if (!job.stalledAt) job.stalledAt = now;
        job.lastHeight = s.root.scrollHeight;
        // Jike loads more when scroll progress changes past 80%.
        setTop(s.root, Math.max(0, max - 2));
        setTop(s.root, max);
      } else {
        job.stalledAt = null;
        setTop(s.root, Math.min(max, s.root.scrollTop + Math.max(200, bounds(s.root).height * 0.8)));
      }
      job.steps += 1;
    }
    job.nextStep = now + 350;
  }

  function begin(s, record) {
    if (state !== s || !settings.restoreReading || keyNow() !== s.key) return;
    s.loading = false;
    s.record = validRecord(record) ? record : null;
    if (!s.record || s.interacted) { s.canSave = true; return; }
    s.job = {
      began: Date.now(), pausedAt: document.hidden ? Date.now() : null,
      startTop: s.root?.scrollTop || 0, steps: 0, nextStep: 0
    };
    showNotice('正在查找上次阅读位置…', '取消', () => cancel(s, true), true);
  }

  function update() {
    if (!ready) return;
    const key = settings.restoreReading ? keyNow() : null;
    if ((state?.key || null) !== key) {
      if (state) { persist(state); cancel(state); }
      clearTimeout(saveTimer);
      hideNotice();
      state = key ? { key, loading: true, canSave: false, snapshot: null, root: null } : null;
      if (state) {
        const current = state;
        const generation = resetGeneration;
        chrome.storage.local.get(key).then(data => {
          if (generation === resetGeneration) begin(current, data[key]);
        }).catch(() => {
          if (state === current) { current.loading = false; current.canSave = false; }
        });
      }
    }
    const s = state;
    if (!s) return;
    const root = rootForPage();
    if (root !== s.root) s.root = root;
    if (s.job) {
      const now = Date.now();
      if (document.hidden) { s.job.pausedAt ||= now; return; }
      if (s.job.pausedAt) {
        const elapsed = now - s.job.pausedAt;
        s.job.began += elapsed;
        s.job.nextStep += elapsed;
        if (s.job.aligned) s.job.aligned += elapsed;
        if (s.job.stalledAt) s.job.stalledAt += elapsed;
        s.job.pausedAt = null;
      }
      if (!root) {
        if (Date.now() - s.job.began >= 8000) { cancel(s); showNotice('页面尚未加载，已保留上次阅读记录'); }
      } else advance(s, Date.now());
    }
  }

  function userIntent(event) {
    if (!event.isTrusted || event.composedPath().some(node => node?.hasAttribute?.('data-jkn-reading-ui'))) return;
    if (event.type === 'keydown' && (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key) ||
      event.target.closest?.('input, textarea, select, [contenteditable="true"]'))) return;
    update();
    if (!state) return;
    const s = state;
    cancel(s);
    s.interacted = true;
    s.canSave = true;
    hideNotice();
  }

  document.addEventListener('scroll', event => {
    update();
    const s = state;
    if (!s || s.loading || s.job || !s.canSave || !s.root ||
      (event.target !== s.root && !(s.root === document.scrollingElement && event.target === document))) return;
    sample(s);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // Virtualized content may acquire its post marker just after the scroll event.
      sample(s);
      persist(s);
    }, 400);
  }, { capture: true, passive: true });
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    document.addEventListener(type, userIntent, { capture: true, passive: true });
  }
  // Store the last sampled feed rather than the newly mounted detail page.
  document.addEventListener('click', () => { if (state) { sample(state); persist(state); } }, true);
  addEventListener('pagehide', () => { if (state) { sample(state); persist(state); } });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      persist(state);
      if (state?.job) state.job.pausedAt ||= Date.now();
    } else update();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[settingsKey]) {
      settings = { ...defaults, ...changes[settingsKey].newValue };
      if (!settings.restoreReading) { cancel(state); clearTimeout(saveTimer); state = null; hideNotice(); }
      if (!settings.showReadingNotice && !state?.job) hideNotice();
      update();
    }
    if (changes[resetKey]) {
      resetGeneration += 1;
      clearTimeout(saveTimer);
      cancel(state);
      if (state) { state.loading = false; state.snapshot = null; state.canSave = false; state.interacted = false; }
      hideNotice();
    }
  });
  chrome.storage.local.get(settingsKey).then(data => {
    settings = { ...defaults, ...data[settingsKey] };
    ready = true;
    update();
    // Also covers SPA history changes which don't necessarily mutate the DOM.
    setInterval(update, 200);
  }).catch(() => {});
})();
