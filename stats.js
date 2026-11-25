(() => {
  'use strict';
  let previous;
  let busy = false;
  let dwell = new Map();
  let counted = new Set();
  let countedDay;
  let currentAccount;
  let latest = null;
  let error = false;
  let stopped = false;
  addEventListener('jkn-context-expired', () => { stopped = true; error = true; reset(); });
  const dayOf = now => new Date(now).toLocaleDateString('sv-SE');
  async function send(type, account, sample) {
    if (stopped) throw new Error('Extension context invalidated');
    const response = await chrome.runtime.sendMessage({ type, account, sample });
    if (!response?.data) throw new Error('Statistics unavailable');
    return response.data;
  }
  function reset() { previous = null; dwell.clear(); }
  function frame() { return window.JknReadingStatsFrame?.(); }
  async function tick() {
    if (stopped) return;
    const current = frame();
    const now = Date.now();
    const day = dayOf(now);
    if (current?.account !== currentAccount || day !== countedDay) {
      currentAccount = current?.account;
      countedDay = day;
      counted.clear();
      reset();
      latest = null;
    }
    if (!current?.active) { reset(); return; }
    if (busy) { reset(); return; }
    const elapsed = previous ? now - previous.time : 0;
    const duration = elapsed > 0 && elapsed <= 1500 ? elapsed : 0;
    if (elapsed < 0 || elapsed > 1500) dwell.clear();
    const visible = new Set(current.ids);
    for (const id of dwell.keys()) if (!visible.has(id)) dwell.delete(id);
    for (const id of visible) if (!dwell.has(id)) dwell.set(id, now);
    const ids = [...dwell].filter(([id, began]) => !counted.has(id) && now - began >= 1000).map(([id]) => id);
    previous = { time: now };
    // Persist once per second while focused; IDB serializes writers across tabs.
    if (!ids.length && duration === 0) return;
    busy = true;
    const account = current.account;
    try {
      const data = await send('jkn.stats.record', account, { start: now - duration, end: now, ids });
      if (account === currentAccount && day === countedDay) {
        latest = data; error = false;
        for (const id of ids) counted.add(id);
      }
    } catch { error = true; }
    finally { busy = false; }
  }
  async function get() {
    const current = frame();
    if (!current?.account) return { unavailable: true };
    try {
      latest = await send('jkn.stats.get', current.account);
      error = false;
      return latest;
    } catch { error = true; return { error: true }; }
  }
  window.JknBrowsingStats = { get, peek: () => error ? { error: true } : latest };
  document.addEventListener('visibilitychange', reset);
  addEventListener('blur', reset);
  addEventListener('focus', reset);
  document.addEventListener('scroll', event => {
    // A quick pass through several cards cannot satisfy a continuous dwell.
    if (!event.composedPath().some(node => node?.matches?.('[data-jkn-floating]'))) dwell.clear();
  }, { capture: true, passive: true });
  setInterval(tick, 1000);
})();
