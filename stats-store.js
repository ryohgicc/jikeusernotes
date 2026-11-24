(() => {
  'use strict';
  let database;
  const dayOf = time => {
    const date = new Date(time);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  const request = operation => new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result);
    operation.onerror = () => reject(operation.error);
  });
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const operation = indexedDB.open('jkn-browsing-stats', 1);
      operation.onupgradeneeded = () => {
        operation.result.createObjectStore('accounts', { keyPath: 'account' });
        operation.result.createObjectStore('posts', { keyPath: ['account', 'id'] });
      };
      operation.onsuccess = () => resolve(operation.result);
      operation.onerror = () => { database = null; reject(operation.error); };
    });
    return database;
  }
  function summary(value, now) {
    const today = dayOf(now);
    return { today, todayMs: value?.day === today ? value.todayMs : 0,
      todayPosts: value?.day === today ? value.todayPosts : 0,
      totalMs: value?.totalMs || 0, totalPosts: value?.totalPosts || 0 };
  }

  async function read(account, now = Date.now()) {
    if (!validId(account)) throw new Error('Invalid account');
    const db = await open();
    return summary(await request(db.transaction('accounts').objectStore('accounts').get(account)), now);
  }

  async function record(account, { start, end, ids = [] }, now = Date.now()) {
    if (!validId(account) || !Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 10000 ||
      Math.abs(now - end) > 30000 || !Array.isArray(ids) || ids.length > 100 || !ids.every(validId)) throw new Error('Invalid statistics');
    const db = await open();
    const transaction = db.transaction(['accounts', 'posts'], 'readwrite');
    const completed = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error('Statistics write failed'));
    });
    const accounts = transaction.objectStore('accounts');
    const posts = transaction.objectStore('posts');
    try {
      const value = await request(accounts.get(account)) || { account, totalMs: 0, totalPosts: 0, intervals: [] };
      const today = dayOf(now);
      if (value.day !== today) { value.day = today; value.todayMs = 0; value.todayPosts = 0; }
      const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
      // Union recent intervals: two tabs reporting the same time cannot double it.
      const previous = value.intervals || [];
      let pieces = end > start ? [[start, end]] : [];
      for (const [left, right] of previous) pieces = pieces.flatMap(([a, b]) =>
        b <= left || a >= right ? [[a, b]] : [[a, Math.min(b, left)], [Math.max(a, right), b]].filter(([x, y]) => y > x));
      for (const [a, b] of pieces) {
        value.totalMs += b - a;
        value.todayMs += Math.max(0, b - Math.max(a, midnight.getTime()));
      }
      const merged = [];
      for (const interval of [...previous, [start, end]].filter(([, b]) => b >= now - 60000).sort((a, b) => a[0] - b[0])) {
        const last = merged.at(-1);
        if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
        else merged.push([...interval]);
      }
      value.intervals = merged;
      for (const id of new Set(ids)) {
        const seen = await request(posts.get([account, id]));
        if (!seen) value.totalPosts += 1;
        if (seen?.day !== today) value.todayPosts += 1;
        posts.put({ account, id, day: today });
      }
      accounts.put(value);
      await completed;
      return summary(value, now);
    } catch (error) {
      try { transaction.abort(); } catch { /* Already aborted or completed. */ }
      await completed.catch(() => {});
      throw error;
    }
  }
  globalThis.JknStatsStore = { read, record };
})();
