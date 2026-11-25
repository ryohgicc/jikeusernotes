(() => {
  'use strict';
  if (window.JknReadingController) return;
  window.JknReadingController = true;
  const prefix = 'jkn.reading.';
  const settingsKey = 'jkn.settings';
  const resetKey = 'jkn.readingResetAt';
  const defaults = { restoreReading: false, showReadingNotice: true, readingExpiryEnabled: true, readingMaxAgeHours: 24 };
  let settings = { ...defaults };
  let state = null;
  let notice;
  let loadingView;
  let divider;
  let noticeTimer;
  let saveTimer;
  let ready = false;
  let resetGeneration = 0;
  let previousPath = location.pathname;
  let previousSearch = location.search;
  let nativeReturnRoute = null;
  let visit = 0;
  let lastRoute = route();
  const automaticAttempts = new Set();
  let updateTimer;
  let stopped = false;

  function isDetailLocation(path, search) {
    return new URLSearchParams(search).has('id') || /^\/u\/[a-zA-Z0-9_-]{1,128}\/(post|repost)\//.test(path);
  }

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

  window.JknReadingStatsFrame = () => {
    const user = account();
    const root = rootForPage();
    const tools = document.querySelector('[data-jkn-floating]')?.shadowRoot;
    const active = !!(user && route() && root && !document.hidden && document.hasFocus() &&
      !state?.loading && !state?.job && !document.querySelector('[data-jkn-reading-mask], [data-jkn-editor]') &&
      !tools?.querySelector('.overlay.open'));
    if (!active) return { account: user, active: false, ids: [] };
    const box = bounds(root);
    const ids = posts(root).filter(node => {
      // A virtual wrapper without mounted content has not been read.
      if (!node.querySelector('[class*="_post_"]')) return false;
      const rect = node.getBoundingClientRect();
      return Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top) >= Math.min(100, rect.height * .5);
    }).map(node => node.getAttribute('data-jkn-post'));
    return { account: user, active: true, ids };
  };

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

  function maxAgeHours(value) {
    if (Number.isInteger(value?.readingMaxAgeHours) && value.readingMaxAgeHours >= 1 && value.readingMaxAgeHours <= 8760) return value.readingMaxAgeHours;
    // Compatibility with previously saved settings; expiry itself uses hours.
    if (Number.isInteger(value?.readingMaxAgeDays) && value.readingMaxAgeDays >= 1 && value.readingMaxAgeDays <= 365) return value.readingMaxAgeDays * 24;
    return defaults.readingMaxAgeHours;
  }

  function normalizeSettings(value) {
    return { ...defaults, ...value, restoreReading: value?.restoreReading === true, readingMaxAgeHours: maxAgeHours(value) };
  }

  function contextAlive() {
    try { return !!chrome?.runtime?.id; } catch { return false; }
  }

  function stopExpiredContext() {
    if (stopped) return;
    stopped = true;
    ready = false;
    resetGeneration++;
    clearInterval(updateTimer);
    clearTimeout(saveTimer);
    cancel(state);
    state = null;
    hideNotice();
    clearDivider();
    dispatchEvent(new Event('jkn-context-expired'));
  }

  function bindStorageListener() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[settingsKey]) {
          const wasRestoring = settings.restoreReading;
          settings = normalizeSettings(changes[settingsKey].newValue);
          if (wasRestoring && !settings.restoreReading) {
            cancel(state); clearTimeout(saveTimer); hideNotice(); clearDivider();
          }
          if (!wasRestoring && settings.restoreReading) restoreCurrent();
          if (state?.job && expired(state.record)) cancel(state);
          if (!settings.showReadingNotice && !state?.job) hideNotice();
          update();
        }
        if (changes[resetKey]) {
          resetGeneration += 1; clearTimeout(saveTimer); cancel(state);
          if (state) { state.loading = false; state.snapshot = null; state.canSave = false; state.interacted = false; }
          hideNotice(); clearDivider();
        }
      });
      return true;
    } catch { return false; }
  }

  async function storageGet(keys) {
    if (!contextAlive()) { stopExpiredContext(); return Promise.reject(new Error('Extension context invalidated')); }
    try { return await chrome.storage.local.get(keys); } catch (error) {
      if (/context invalidated/i.test(error.message)) stopExpiredContext();
      throw error;
    }
  }

  async function storageSet(value) {
    if (!contextAlive()) { stopExpiredContext(); return Promise.reject(new Error('Extension context invalidated')); }
    try { return await chrome.storage.local.set(value); } catch (error) {
      if (/context invalidated/i.test(error.message)) stopExpiredContext();
      throw error;
    }
  }

  function expired(record) {
    return settings.readingExpiryEnabled !== false && Date.now() - record.savedAt > settings.readingMaxAgeHours * 3600000;
  }

  function persist(s) {
    if (stopped || !s?.snapshot || !s.canSave) return;
    storageSet({ [s.key]: s.snapshot }).catch(() => {});
  }

  function sample(s) {
    if (state !== s || s.job || !s.root || !s.canSave || keyNow() !== s.key || document.hidden) return;
    const next = snapshot(s);
    if (next) s.snapshot = next;
  }

  function hideNotice() {
    clearTimeout(noticeTimer);
    const current = notice;
    notice = null;
    loadingView = null;
    if (!current) return;
    if (current.hasAttribute('data-jkn-reading-mask')) {
      current.dataset.jknReadingClosing = '';
      setTimeout(() => current.remove(), 220);
    } else current.remove();
  }

  function clearDivider() {
    divider?.host.remove();
    divider = null;
  }

  function positionDivider() {
    if (!divider) return;
    const { host, line, owner, id, offset } = divider;
    const root = owner.root;
    const target = root?.isConnected && posts(root).find(node => node.getAttribute('data-jkn-post') === id);
    if (!target || document.hidden) { host.style.display = 'none'; return; }
    const box = bounds(root);
    const rect = target.getBoundingClientRect();
    const rootRect = root === document.scrollingElement ? { left: 0, right: innerWidth } : root.getBoundingClientRect();
    const left = Math.max(0, rect.left, rootRect.left);
    const right = Math.min(innerWidth, rect.right, rootRect.right);
    // A partially read post starts above the viewport: mark the saved reading
    // boundary inside it, so the line is visible without changing scroll layout.
    const top = rect.top + Math.max(0, -offset);
    host.style.display = top + 28 <= box.top || top >= box.bottom || right <= left ? 'none' : 'block';
    host.style.left = left + 'px';
    host.style.top = box.top + 'px';
    host.style.width = (right - left) + 'px';
    host.style.height = box.height + 'px';
    line.style.transform = `translateY(${top - box.top}px)`;
  }

  function showDivider(s) {
    clearDivider();
    const host = document.createElement('div');
    host.dataset.jknReadingDivider = '';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host { all: initial; position: fixed; z-index: 2147483646; pointer-events: none;
        overflow: hidden; contain: layout style paint; }
      div { display: flex; align-items: center; gap: 12px; height: 28px; padding: 0 12px;
        box-sizing: border-box; font: 12px/1.5 system-ui, sans-serif; color: #856511;
        animation: jkn-divider-in .3s cubic-bezier(.22, 1, .36, 1) both; }
      div::before, div::after { content: ''; height: 1px; flex: 1; background: #dcc16a; }
      span { padding: 3px 10px; border-radius: 12px; background: #fff5cd; white-space: nowrap; }
    </style><div role="separator" aria-label="上次读到这里"><span>上次读到这里</span></div>`;
    divider = { host, line: shadow.querySelector('div'), owner: s, id: s.record.id, offset: s.record.offset };
    document.documentElement.append(host);
    positionDivider();
  }

  function showNotice(message, action, callback, persistent = false, keep = false) {
    hideNotice();
    if (!persistent && !settings.showReadingNotice && !keep) return;
    const host = document.createElement('div');
    host.dataset.jknReadingUi = '';
    if (persistent) host.dataset.jknReadingMask = '';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host { all: initial; position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        z-index: 2147483647; width: max-content; max-width: calc(100vw - 32px); }
      div { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px;
        background: #242424; color: #fff; box-shadow: 0 4px 24px #0003; font: 14px/1.5 system-ui, sans-serif; }
      button { flex-shrink: 0; background: transparent; color: #ffe371; border: 0;
        padding: 6px; font: inherit; cursor: pointer; } button:focus-visible { outline: 2px solid #ffe371; }
      :host([data-jkn-reading-mask]) { inset: 0; left: 0; bottom: 0; transform: none;
        width: 100vw; max-width: none; height: 100dvh; display: grid; place-items: center;
        z-index: 2147483639; background: #f7f7f5; color-scheme: light; overscroll-behavior: contain; touch-action: none;
        animation: jkn-mask-in .22s ease-out both; }
      :host([data-jkn-reading-closing]) { animation: jkn-mask-out .22s ease-in both; pointer-events: none; }
      :host([data-jkn-reading-mask]) div { flex-direction: column; gap: 16px; background: transparent;
        color: #555; box-shadow: none; padding: 24px; text-align: center; }
      :host([data-jkn-reading-mask]) span::before { content: ''; display: inline-block; width: 8px; height: 8px;
        margin-right: 8px; border: 2px solid #d6c377; border-top-color: #806c2a; border-radius: 50%;
        vertical-align: -1px; animation: jkn-spinner .8s linear infinite; }
      :host([data-jkn-reading-mask]) button { padding: 8px 24px; border: 1px solid #d6c377;
        border-radius: 20px; color: #796018; background: #fff5cd; }
      @media (prefers-color-scheme: dark) {
        :host([data-jkn-reading-mask]) { background: #181818; color-scheme: dark; }
        :host([data-jkn-reading-mask]) div { color: #ddd; }
        :host([data-jkn-reading-mask]) button { color: #ffe371; background: #39331e; border-color: #746333; }
      }
      @keyframes jkn-mask-in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes jkn-mask-out { from { opacity: 1; } to { opacity: 0; } }
      @keyframes jkn-spinner { to { transform: rotate(360deg); } }
      @keyframes jkn-divider-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
      }
    </style><div role="status"><span></span><button type="button"></button></div>`;
    if (persistent) loadingView = window.JknLoadingView.mount(shadow, message);
    else shadow.querySelector('span').textContent = message;
    const button = shadow.querySelector('button');
    button.textContent = persistent ? '取消查找' : action || '关闭';
    button.addEventListener('click', () => { hideNotice(); callback?.(); });
    host.addEventListener('pointerdown', event => event.stopPropagation());
    if (persistent) {
      // Cancelling must reveal the entry position rather than a search frame.
      host.addEventListener('wheel', event => { event.preventDefault(); callback?.(); }, { passive: false });
      host.addEventListener('touchstart', event => { event.preventDefault(); callback?.(); }, { passive: false });
    }
    document.documentElement.append(host);
    notice = host;
    if (!persistent && !keep) noticeTimer = setTimeout(hideNotice, 8000);
  }

  function cancel(s, goBack = false) {
    if (!s?.job) return;
    const start = s.job.startTop;
    s.job = null;
    s.canSave = false; // Searching must not overwrite the previous bookmark.
    hideNotice();
    if (goBack && s.root?.isConnected && keyNow() === s.key) setTop(s.root, start);
  }

  function complete(s) {
    const job = s.job;
    s.job = null;
    s.canSave = true;
    sample(s); persist(s); showDivider(s);
    showNotice('已恢复到上次阅读位置', '撤销恢复', () => {
      if (state !== s || !s.root?.isConnected || keyNow() !== s.key) return;
      s.canSave = false;
      clearDivider();
      setTop(s.root, job.startTop);
    });
  }

  function pauseSearch(s, reason) {
    const job = s.job;
    const resume = { record: s.record, top: s.root.scrollTop, fromStart: job.fromStart, startTop: job.startTop, seen: job.seen };
    cancel(s, true);
    showNotice(reason + '，尚未找到原动态。已保留上次记录。', '继续查找', () => {
      if (state !== s || keyNow() !== s.key || s.interacted || s.loading || s.job) return;
      if (!s.root?.isConnected) return;
      s.record = resume.record;
      s.canSave = false;
      s.snapshot = null;
      s.job = { began: Date.now(), pausedAt: document.hidden ? Date.now() : null,
        startTop: resume.startTop, steps: 0, nextStep: 0, searched: true, fromStart: resume.fromStart,
        seen: resume.seen, manual: true, maskShown: true };
      showNotice('正在继续查找上次阅读位置…', '取消', () => cancel(s, true), true);
      // Allow the opaque mask to paint before returning to the search cursor.
      s.job.resumeTop = resume.top;
    }, false, true);
  }

  function advance(s, now) {
    const job = s.job;
    if (!job || !s.root) return;
    if (document.hidden) return;
    const list = posts(s.root);
    const target = list.find(node => node.getAttribute('data-jkn-post') === s.record.id);
    const age = now - job.began;
    job.seen ||= new Set();
    for (const node of list) job.seen.add(node.getAttribute('data-jkn-post'));
    loadingView?.update({ phase: target ? 'align' : job.stalledAt ? 'load' : 'search', seen: job.seen.size,
      seconds: Math.floor(age / 1000), paused: false });
    if (!job.manual && !job.controlled && s.root.scrollTop > 4) {
      cancel(s);
      return;
    }
    if (age < 800) return; // Observe native restoration before showing a mask.
    if (!job.maskShown) {
      job.maskShown = true;
      showNotice('正在查找上次阅读位置…', '取消', () => cancel(s, true), true);
      return; // Paint the opaque mask before the first controlled scroll.
    }
    job.controlled = true;
    if (job.resumeTop !== undefined) {
      setTop(s.root, job.resumeTop);
      delete job.resumeTop;
      job.nextStep = now + 200;
      return;
    }
    if (target) {
      const delta = target.getBoundingClientRect().top - bounds(s.root).top - s.record.offset;
      setTop(s.root, s.root.scrollTop + delta);
      if (!job.aligned || Math.abs(delta) > 2) job.aligned = now;
      if (now - job.aligned >= 1400 || age >= 120000) complete(s); // Reveal only after layout settles.
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
    if (age >= 120000 || job.steps >= 600 || (job.stalledAt && now - job.stalledAt > 15000)) {
      pauseSearch(s, job.stalledAt && now - job.stalledAt > 15000 ? '页面暂时没有加载更多内容' : '本次查找已达到时限');
      return;
    }
    if (now < job.nextStep) return;
    if (!job.searched) {
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
        setTop(s.root, Math.min(max, s.root.scrollTop + Math.max(200, bounds(s.root).height * 0.9)));
      }
      job.steps += 1;
    }
    job.nextStep = now + (job.stalledAt ? 800 : 160);
  }

  function begin(s, record, manual = false) {
    if (stopped || state !== s || keyNow() !== s.key) return;
    s.loading = false;
    s.record = validRecord(record) ? record : null;
    if (!manual && s.skipAutoRestore) { s.canSave = !!s.interacted; return; }
    if (!settings.restoreReading && !manual) { s.canSave = !s.record || s.interacted; return; }
    if (!s.record || s.interacted) { s.canSave = true; return; }
    const attempt = `${visit}:${s.key}`;
    if (!manual && automaticAttempts.has(attempt)) { s.canSave = false; return; }
    if (!manual) automaticAttempts.add(attempt);
    // Jike may have already restored its feed when this script starts. Keep
    // the native position and avoid starting a second animated search.
    if (!manual && s.root?.scrollTop > 4) { s.canSave = false; return; }
    // Keep stale bookmarks unchanged until the user actually browses again.
    if (s.record && expired(s.record) && !s.interacted && !manual) { s.record = null; s.canSave = false; return; }
    s.job = {
      began: Date.now(), pausedAt: document.hidden ? Date.now() : null,
      startTop: s.root?.scrollTop || 0, steps: 0, nextStep: 0, manual, maskShown: manual
    };
    if (manual) showNotice('正在查找上次阅读位置…', '取消', () => cancel(s, true), true);
  }

  function restoreCurrent() {
    update();
    if (stopped || !state || state.loading || state.job) return;
    clearTimeout(saveTimer);
    clearDivider();
    state.interacted = false;
    state.canSave = false;
    state.loading = true;
    state.snapshot = null;
    state.record = null;
    const current = state;
    const generation = resetGeneration;
    storageGet(current.key).then(data => {
      if (generation === resetGeneration) begin(current, data[current.key], true);
    }).catch(() => { if (state === current) current.loading = false; });
  }

  function update() {
    if (!ready) return;
    if (!contextAlive()) { stopExpiredContext(); return; }
    const currentPath = location.pathname;
    const currentSearch = location.search;
    const currentRoute = route();
    if (currentRoute !== lastRoute) { visit++; lastRoute = currentRoute; automaticAttempts.clear(); }
    if (currentRoute && isDetailLocation(previousPath, previousSearch)) nativeReturnRoute = currentRoute;
    else if (currentPath !== previousPath || currentSearch !== previousSearch) nativeReturnRoute = null;
    previousPath = currentPath;
    previousSearch = currentSearch;
    const key = keyNow();
    if ((state?.key || null) !== key) {
      if (state) { persist(state); cancel(state); }
      clearTimeout(saveTimer);
      hideNotice();
      clearDivider();
      state = key ? { key, loading: true, canSave: false, snapshot: null, root: null,
        skipAutoRestore: currentRoute === nativeReturnRoute } : null;
      if (state) nativeReturnRoute = null;
      if (state) {
        const current = state;
        const generation = resetGeneration;
        storageGet(key).then(data => {
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
      if (document.hidden) {
        s.job.pausedAt ||= now;
        loadingView?.update({ phase: s.job.aligned ? 'align' : s.job.stalledAt ? 'load' : 'search',
          seen: s.job.seen?.size || 0, seconds: Math.floor((s.job.pausedAt - s.job.began) / 1000), paused: true });
        return;
      }
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
    positionDivider();
  }

  function isToolEvent(event) {
    return event.composedPath().some(node => node?.matches?.('[data-jkn-reading-ui], [data-jkn-floating], [data-jkn-editor]'));
  }

  function userIntent(event) {
    if (event.isTrusted && event.type === 'keydown' && event.key === 'Escape' && state?.job) {
      cancel(state, true);
      return;
    }
    if (!event.isTrusted || isToolEvent(event)) return;
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
  document.addEventListener('click', event => { if (state && !isToolEvent(event)) { sample(state); persist(state); } }, true);
  addEventListener('pagehide', () => { if (state) { sample(state); persist(state); } });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      persist(state);
      if (state?.job) state.job.pausedAt ||= Date.now();
    } else update();
    positionDivider();
  });
  addEventListener('resize', positionDivider);
  addEventListener('jkn-navigation', update);
  addEventListener('popstate', update);
  addEventListener('pageshow', event => {
    if (!event.persisted) return;
    cancel(state);
    if (state) { state.skipAutoRestore = true; state.canSave = false; }
  });
  addEventListener('jkn-restore-reading', restoreCurrent);
  addEventListener('jkn-reading-top', () => {
    cancel(state);
    clearTimeout(saveTimer);
    if (state) { state.canSave = false; state.snapshot = null; }
  });

  bindStorageListener();
  storageGet(settingsKey).then(data => {
    if (stopped) return;
    settings = normalizeSettings(data[settingsKey]);
    ready = true;
    update();
    // Also covers SPA history changes which don't necessarily mutate the DOM.
    updateTimer = setInterval(update, 100);
  }).catch(() => {});
})();
