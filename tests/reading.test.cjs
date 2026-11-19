const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const repo = path.resolve(__dirname, '..');
const recordKey = (page = '/following', user = 'account-a') => `jkn.reading.${user}:${page}`;
const bookmark = (id, top, offset = 0) => ({ version: 1, id, top, offset, savedAt: Date.now() });
let browser;

before(async () => {
  const localChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const executablePath = process.env.CHROME_PATH || (fs.existsSync(localChrome) ? localChrome : undefined);
  browser = await chromium.launch({ executablePath, headless: true });
});
after(async () => { await browser?.close(); });

async function session(seed = {}, autoRestore = true) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 720 } });
  // Existing restoration cases opt in explicitly; the product default is off.
  const data = structuredClone(autoRestore ? { ...seed, 'jkn.settings': { restoreReading: true, ...(seed['jkn.settings'] || {}) } } : seed);
  const errors = [];
  await context.exposeBinding('__storageCall', async (_, request) => {
    if (request.method === 'get') {
      const keys = request.keys == null ? Object.keys(data) : Array.isArray(request.keys) ? request.keys : [request.keys];
      return Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]]));
    }
    const changes = {};
    if (request.method === 'set') {
      for (const [key, value] of Object.entries(request.values)) { changes[key] = { oldValue: data[key], newValue: value }; data[key] = value; }
    } else {
      for (const key of Array.isArray(request.keys) ? request.keys : [request.keys]) { changes[key] = { oldValue: data[key] }; delete data[key]; }
    }
    await Promise.all(context.pages().map(page => page.evaluate(changes => window.__storageNotify?.(changes), changes).catch(() => {})));
  });
  await context.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: 'open' }); };
    const callbacks = [];
    window.__storageNotify = changes => callbacks.forEach(callback => callback(changes, 'local'));
    window.chrome = { storage: {
      onChanged: { addListener: callback => callbacks.push(callback) },
      local: {
        get: keys => window.__storageCall({ method: 'get', keys }),
        set: values => window.__storageCall({ method: 'set', values }),
        remove: keys => window.__storageCall({ method: 'remove', keys })
      }
    } };
  });
  await context.route('https://web.okjike.com/**', route => route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8') }));
  async function open(url = '/following', setup) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://web.okjike.com' + url);
    if (setup) await setup(page);
    await page.addScriptTag({ path: path.join(repo, 'reading-bridge.js') });
    await page.addScriptTag({ path: path.join(repo, 'reading.js') });
    await page.waitForFunction(() => document.querySelector('[data-jkn-post]'));
    return page;
  }
  async function close() { await context.close(); assert.deepEqual(errors, [], 'no page exceptions'); }
  return { context, data, open, close };
}

async function restored(page) {
  await page.waitForFunction(() => document.querySelector('[data-jkn-reading-ui]')?.shadowRoot?.textContent.includes('已恢复到上次阅读位置'), undefined, { timeout: 10000 });
}
async function offset(page, id) {
  return page.evaluate(id => {
    const node = [...document.querySelectorAll('[data-jkn-post]')].find(node => node.dataset.jknPost === id);
    return node?.getBoundingClientRect().top - document.querySelector('#viewport').getBoundingClientRect().top;
  }, id);
}

test('records internal scroller anchor; reload with prepended content restores ID and offset', async () => {
  const s = await session();
  try {
    const page = await s.open();
    await page.waitForTimeout(300);
    await page.locator('#viewport').evaluate(root => root.scrollTo(0, 980));
    await page.waitForTimeout(700);
    assert.equal(s.data[recordKey()].id, 'post-2');
    const savedOffset = s.data[recordKey()].offset;
    await page.close();
    const returned = await s.open('/following', page => page.evaluate(() => window.fixture.prepend('new-post')));
    await restored(returned);
    assert.ok(Math.abs(await offset(returned, 'post-2') - savedOffset) <= 2);
    assert.equal(s.data[recordKey()].id, 'post-2');
    // A virtual wrapper keeps its ID when its child content is unmounted.
    assert.ok(await returned.locator('[data-jkn-post]').count() > 0);
  } finally { await s.close(); }
});

test('default records reading position without auto-restoring; manual restore still works', async () => {
  const s = await session({}, false);
  try {
    const page = await s.open();
    await page.locator('#viewport').evaluate(root => root.scrollTo(0, 980));
    await page.waitForTimeout(700);
    assert.equal(s.data[recordKey()].id, 'post-2');
    const original = structuredClone(s.data[recordKey()]);
    await page.close();
    const returned = await s.open();
    await returned.waitForTimeout(1200);
    assert.equal(await returned.locator('#viewport').evaluate(root => root.scrollTop), 0);
    assert.deepEqual(s.data[recordKey()], original, 'opening the feed must not replace the previous visit');
    await returned.evaluate(() => window.dispatchEvent(new CustomEvent('jkn-restore-reading')));
    await restored(returned);
    assert.ok(Math.abs(await offset(returned, 'post-2') - original.offset) <= 2);
  } finally { await s.close(); }
});

test('SPA departure/return, root redirect alias, separate feeds and account isolation', async () => {
  const s = await session({ [recordKey()]: bookmark('post-2', 740, 0) });
  try {
    const page = await s.open('/');
    await restored(page);
    await page.evaluate(() => window.fixture.navigate('/notification'));
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-jkn-reading-divider]').count(), 0);
    await page.evaluate(() => window.fixture.navigate('/explore'));
    await page.waitForTimeout(300);
    await page.locator('#viewport').evaluate(root => root.scrollTo(0, 450));
    await page.waitForTimeout(700);
    assert.equal(s.data[recordKey('/explore')].id, 'post-1');
    await page.evaluate(() => window.fixture.navigate('/following'));
    await restored(page);
    assert.equal(Math.round(await offset(page, 'post-2')), 0);
    await page.evaluate(() => window.fixture.account('account-b'));
    await page.waitForTimeout(400);
    await page.locator('#viewport').evaluate(root => root.scrollTo(0, 1500));
    await page.waitForTimeout(700);
    assert.equal(s.data[recordKey('/following', 'account-b')].id, 'post-4');
    assert.equal(s.data[recordKey()].id, 'post-2');
    assert.equal(await page.locator('[data-jkn-reading-divider]').count(), 0);
  } finally { await s.close(); }
});

test('finds a virtualized anchor beyond initial data by bounded natural scrolling', async () => {
  const s = await session({ [recordKey()]: bookmark('post-8', 2540) });
  try {
    const page = await s.open('/following', page => page.evaluate(() => window.fixture.shortList(['post-0', 'post-1', 'post-2'], 20)));
    await restored(page);
    assert.ok(await page.evaluate(() => window.fixture.loads()) > 0);
    assert.ok(Math.abs(await offset(page, 'post-8')) <= 2);
  } finally { await s.close(); }
});

test('corrects layout shifts while restoring; undo returns to entry position', async () => {
  const s = await session({ [recordKey()]: bookmark('post-2', 740) });
  try {
    const page = await s.open();
    await page.waitForTimeout(1100);
    await page.evaluate(() => window.fixture.layout(160));
    await restored(page);
    assert.ok(Math.abs(await offset(page, 'post-2')) <= 2);
    assert.equal(await page.locator('[data-jkn-reading-divider]').count(), 1);
    await page.locator('[data-jkn-reading-ui] button').click();
    await page.waitForTimeout(350);
    assert.equal(await page.locator('#viewport').evaluate(root => root.scrollTop), 0);
    assert.equal(await page.locator('[data-jkn-reading-divider]').count(), 0);
  } finally { await s.close(); }
});

test('reading divider marks a partially read post, follows layout and virtualization without shifting the feed', async () => {
  const s = await session({ [recordKey()]: bookmark('post-2', 860, -120), 'jkn.settings': { showReadingNotice: false } });
  try {
    const page = await s.open();
    const marker = page.locator('[data-jkn-reading-divider] [role="separator"]');
    await marker.waitFor({ state: 'visible' });
    assert.equal(await marker.innerText(), '上次读到这里');
    assert.equal(await page.locator('[data-jkn-reading-ui]').count(), 0, 'divider is independent of transient notices');
    assert.ok(Math.abs(await offset(page, 'post-2') + 120) <= 2);
    assert.equal(await page.locator('#viewport').evaluate(root => root.scrollHeight), 9140);
    assert.ok(Math.abs((await marker.boundingBox()).y) <= 2, 'mid-post reading boundary is visible at entry');
    assert.equal(await page.locator('[data-jkn-reading-divider]').evaluate(node => getComputedStyle(node).pointerEvents), 'none');

    await page.mouse.move(500, 300);
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(() => {
      const line = document.querySelector('[data-jkn-reading-divider]')?.shadowRoot?.querySelector('[role="separator"]');
      return line && Math.abs(line.getBoundingClientRect().top - 100) <= 2;
    });
    await page.waitForTimeout(500);
    assert.ok(Math.abs(s.data[recordKey()].offset + 20) <= 2, 'new bookmark does not move the previous-reading marker');

    await page.evaluate(() => window.fixture.layout(160));
    await page.waitForFunction(() => {
      const line = document.querySelector('[data-jkn-reading-divider]')?.shadowRoot?.querySelector('[role="separator"]');
      const post = document.querySelector('[data-jkn-post="post-2"]');
      return line && post && Math.abs(line.getBoundingClientRect().top - post.getBoundingClientRect().top - 120) <= 2;
    });
    await page.locator('#viewport').evaluate(root => root.scrollTo(0, 4000));
    await page.waitForFunction(() => document.querySelector('[data-jkn-reading-divider]')?.style.display === 'none');
    await page.locator('#viewport').evaluate(root => root.scrollTo(0, 1020));
    await marker.waitFor({ state: 'visible' });
    assert.ok(Math.abs((await marker.boundingBox()).y) <= 2);
    assert.equal(await page.locator('[data-jkn-reading-divider]').count(), 1);
    fs.mkdirSync(path.join(repo, 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(repo, 'test-results', 'reading-divider.png') });

    await page.evaluate(() => chrome.storage.local.set({ 'jkn.readingResetAt': Date.now() }));
    assert.equal(await page.locator('[data-jkn-reading-divider]').count(), 0);
  } finally { await s.close(); }
});

test('manual wheel interrupts automatic restore immediately without later jumping', async () => {
  const record = bookmark('post-20', 6140);
  const s = await session({ [recordKey()]: record });
  try {
    const page = await s.open();
    await page.mouse.move(500, 300);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(700);
    const top = await page.locator('#viewport').evaluate(root => root.scrollTop);
    assert.ok(top > 0 && top < 1000);
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('#viewport').evaluate(root => root.scrollTop), top);
    assert.equal(await page.locator('[data-jkn-reading-ui]').count(), 0);
    assert.equal(await page.locator('[data-jkn-reading-divider]').count(), 0);
  } finally { await s.close(); }
});

test('cancel preserves saved bookmark; missing post falls back with an honest notice', async () => {
  const record = bookmark('deleted-post', 950);
  const s = await session({ [recordKey()]: record });
  try {
    const page = await s.open();
    await page.locator('[data-jkn-reading-ui] button').click();
    await page.waitForTimeout(500);
    assert.deepEqual(s.data[recordKey()], record);
    assert.equal(await page.locator('#viewport').evaluate(root => root.scrollTop), 0);
    await page.close();
    const fallback = await s.open();
    await fallback.clock.install();
    await fallback.clock.fastForward(31000);
    await fallback.waitForFunction(() => document.querySelector('[data-jkn-reading-ui]')?.shadowRoot?.textContent.includes('近似位置'));
    assert.equal(await fallback.locator('#viewport').evaluate(root => root.scrollTop), 950);
    assert.deepEqual(s.data[recordKey()], record, 'search/fallback must not erase the original bookmark');
    assert.equal(await fallback.locator('[data-jkn-reading-divider]').count(), 0);
  } finally { await s.close(); }
});

test('settings disable restoration live; clearing reading data preserves notes and cancels jobs', async () => {
  const s = await session({ [recordKey()]: bookmark('post-10', 3140), 'jkn.note.friend': '朋友' });
  try {
    const page = await s.open();
    await page.evaluate(() => chrome.storage.local.set({ 'jkn.settings': { restoreReading: false } }));
    await page.waitForTimeout(1000);
    assert.equal(await page.locator('#viewport').evaluate(root => root.scrollTop), 0);
    await page.mouse.move(500, 300);
    await page.mouse.wheel(0, 450);
    await page.waitForTimeout(700);
    assert.equal(s.data[recordKey()].id, 'post-1', 'turning auto restore off still records browsing');
    await page.evaluate(() => chrome.storage.local.set({ 'jkn.settings': { restoreReading: true } }));
    await page.waitForTimeout(250);
    await page.evaluate(async () => {
      await chrome.storage.local.set({ 'jkn.readingResetAt': Date.now() });
      await chrome.storage.local.remove('jkn.reading.account-a:/following');
    });
    await page.waitForTimeout(1000);
    assert.equal(s.data[recordKey()], undefined);
    assert.equal(s.data['jkn.note.friend'], '朋友');
    assert.equal(await page.locator('[data-jkn-reading-ui]').count(), 0);
  } finally { await s.close(); }
});

test('unsupported routes, missing account and disabled auto restore do not jump', async () => {
  for (const mode of ['detail', 'account', 'disabled']) {
    const s = await session({ [recordKey()]: bookmark('post-20', 6140), ...(mode === 'disabled' ? { 'jkn.settings': { restoreReading: false } } : {}) });
    try {
      const page = await s.open(mode === 'detail' ? '/u/author/post/123' : '/following', mode === 'account' ? page => page.evaluate(() => document.querySelector('#self').remove()) : undefined);
      await page.waitForTimeout(1000);
      assert.equal(await page.locator('#viewport').evaluate(root => root.scrollTop), 0);
      assert.equal(await page.locator('[data-jkn-reading-ui]').count(), 0);
    } finally { await s.close(); }
  }
});

test('reading expiry defaults to 24 hours, obeys hourly limits and supports legacy settings', async () => {
  for (const scenario of [
    { age: 25, settings: { restoreReading: true }, restores: false },
    { age: 23, settings: {}, restores: true },
    { age: 13, settings: { readingMaxAgeHours: 12 }, restores: false },
    { age: 30, settings: { readingMaxAgeHours: 36 }, restores: true },
    { age: 720, settings: { readingExpiryEnabled: false }, restores: true },
    { age: 25, settings: { readingMaxAgeHours: 0 }, restores: false },
    { age: 30, settings: { readingMaxAgeDays: 2 }, restores: true },
    { age: 13, settings: { readingMaxAgeHours: 12, readingMaxAgeDays: 3 }, restores: false }
  ]) {
    const record = { ...bookmark('post-2', 740), savedAt: Date.now() - scenario.age * 3600000 };
    const s = await session({ [recordKey()]: record, 'jkn.settings': scenario.settings });
    try {
      const page = await s.open();
      if (scenario.restores) {
        await restored(page);
        assert.ok(Math.abs(await offset(page, 'post-2')) <= 2);
      } else {
        await page.waitForTimeout(1100);
        assert.equal(await page.locator('#viewport').evaluate(root => root.scrollTop), 0);
        assert.equal(await page.locator('[data-jkn-reading-ui]').count(), 0);
        assert.equal(await page.locator('[data-jkn-reading-divider]').count(), 0);
        // Native scrolling must not renew a stale bookmark without user intent.
        await page.locator('#viewport').evaluate(root => root.scrollTo(0, 450));
        await page.waitForTimeout(600);
        assert.deepEqual(s.data[recordKey()], record);
      }
    } finally { await s.close(); }
  }
});

test('24-hour expiry compares elapsed milliseconds without calendar rounding', async () => {
  const now = Date.now();
  for (const extra of [0, 1]) {
    const record = { ...bookmark('post-2', 740), savedAt: now - 24 * 3600000 - extra };
    const s = await session({ [recordKey()]: record });
    try {
      const page = await s.open('/following', page => page.clock.setFixedTime(new Date(now)));
      await page.waitForTimeout(400);
      assert.equal(await page.locator('[data-jkn-reading-ui]').count(), extra === 0 ? 1 : 0);
      assert.deepEqual(s.data[recordKey()], record);
    } finally { await s.close(); }
  }
});

test('shortening expiry cancels a pending restore; manual browsing creates a fresh bookmark', async () => {
  const record = { ...bookmark('post-2', 740), savedAt: Date.now() - 18 * 3600000 };
  const s = await session({ [recordKey()]: record });
  try {
    const page = await s.open();
    await page.waitForSelector('[data-jkn-reading-ui]');
    await page.evaluate(() => chrome.storage.local.set({ 'jkn.settings': { restoreReading: true, readingMaxAgeHours: 12 } }));
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#viewport').evaluate(root => root.scrollTop), 0);
    assert.equal(await page.locator('[data-jkn-reading-ui]').count(), 0);
    assert.deepEqual(s.data[recordKey()], record);
    await page.mouse.move(500, 300);
    await page.mouse.wheel(0, 450);
    await page.waitForTimeout(800);
    assert.equal(s.data[recordKey()].id, 'post-1');
    assert.ok(s.data[recordKey()].savedAt > record.savedAt);
  } finally { await s.close(); }
});

test('a background tab waits until it is visible before spending its restoration budget', async () => {
  const s = await session({ [recordKey()]: bookmark('post-2', 740) });
  try {
    const page = await s.open('/following', async page => {
      await page.clock.install();
      await page.evaluate(() => {
        window.testHidden = true;
        Object.defineProperty(document, 'hidden', { get: () => window.testHidden });
      });
    });
    await page.waitForSelector('[data-jkn-reading-ui]');
    await page.clock.fastForward(45000);
    assert.equal(await page.locator('#viewport').evaluate(root => root.scrollTop), 0);
    await page.clock.resume();
    await page.evaluate(() => { window.testHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
    await restored(page);
    assert.ok(Math.abs(await offset(page, 'post-2')) <= 2);
    assert.equal(s.data[recordKey()].id, 'post-2');
  } finally { await s.close(); }
});

test('popup saves settings, clears reading positions and exports notes without reading metadata', async () => {
  const s = await session({ [recordKey()]: bookmark('post-2', 740), 'jkn.note.friend': '朋友' });
  try {
    const page = await s.context.newPage();
    const html = fs.readFileSync(path.join(repo, 'popup.html'), 'utf8').replace('<script src="popup.js"></script>', '');
    await s.context.route('https://web.okjike.com/popup.html', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://web.okjike.com/popup.html');
    await page.addScriptTag({ path: path.join(repo, 'popup.js') });
    await page.waitForFunction(() => !document.querySelector('#restore-reading').disabled);
    assert.equal(await page.locator('#reading-max-age').inputValue(), '24');
    assert.equal(await page.locator('#reading-expiry').isChecked(), true);
    await page.locator('#reading-max-age').fill('3');
    await page.locator('#reading-max-age').press('Tab');
    await page.waitForFunction(() => document.querySelector('#reading-status').textContent.includes('已保存'));
    assert.equal(s.data['jkn.settings'].readingMaxAgeHours, 3);
    for (const invalid of ['0', '8761', '1.5', '']) {
      await page.locator('#reading-max-age').fill(invalid);
      await page.locator('#reading-max-age').press('Tab');
      await page.waitForFunction(() => document.querySelector('#reading-status').textContent.includes('整数'));
      assert.equal(s.data['jkn.settings'].readingMaxAgeHours, 3);
    }
    await page.locator('#reading-expiry').uncheck();
    await page.waitForFunction(() => document.querySelector('#reading-status').textContent.includes('已保存'));
    assert.equal(s.data['jkn.settings'].readingExpiryEnabled, false);
    assert.equal(await page.locator('#reading-max-age').isDisabled(), true);
    await page.locator('#reading-expiry').check();
    await page.waitForFunction(() => !document.querySelector('#reading-max-age').disabled);
    assert.equal(await page.locator('#reading-max-age').inputValue(), '3');
    await page.reload();
    await page.addScriptTag({ path: path.join(repo, 'popup.js') });
    await page.waitForFunction(() => !document.querySelector('#restore-reading').disabled);
    assert.equal(await page.locator('#reading-max-age').inputValue(), '3');
    await page.locator('#restore-reading').uncheck();
    await page.waitForFunction(() => document.querySelector('#reading-status').textContent.includes('已保存'));
    assert.equal(s.data['jkn.settings'].restoreReading, false);
    assert.equal(await page.locator('#reading-expiry').isDisabled(), false);
    assert.equal(await page.locator('#reading-max-age').isDisabled(), false);
    await page.locator('#clear-reading').click();
    await page.waitForFunction(() => document.querySelector('#reading-status').textContent.includes('已清除'));
    assert.equal(s.data[recordKey()], undefined);
    assert.equal(s.data['jkn.note.friend'], '朋友');
    assert.equal(s.data['jkn.settings'].restoreReading, false);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export').click()]);
    const result = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.deepEqual(result.notes, { 'jkn.note.friend': '朋友' });
  } finally { await s.close(); }
});

test('popup converts legacy settings to hours and saves without the old day field', async () => {
  const s = await session({ 'jkn.settings': { readingMaxAgeDays: 3, readingExpiryEnabled: false, futureSetting: 'keep' }, 'jkn.note.friend': '朋友' });
  try {
    const page = await s.context.newPage();
    const html = fs.readFileSync(path.join(repo, 'popup.html'), 'utf8').replace('<script src="popup.js"></script>', '');
    await s.context.route('https://web.okjike.com/popup.html', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://web.okjike.com/popup.html');
    await page.addScriptTag({ path: path.join(repo, 'popup.js') });
    await page.waitForFunction(() => !document.querySelector('#restore-reading').disabled);
    assert.equal(await page.locator('#reading-max-age').inputValue(), '72');
    assert.equal(await page.locator('#reading-expiry').isChecked(), false);
    await page.locator('#reading-expiry').check();
    await page.waitForFunction(() => document.querySelector('#reading-status').textContent.includes('已保存'));
    assert.equal(s.data['jkn.settings'].readingMaxAgeHours, 72);
    assert.equal('readingMaxAgeDays' in s.data['jkn.settings'], false);
    assert.equal(s.data['jkn.settings'].futureSetting, 'keep');
    assert.equal(s.data['jkn.note.friend'], '朋友');
    await page.reload();
    await page.addScriptTag({ path: path.join(repo, 'popup.js') });
    await page.waitForFunction(() => !document.querySelector('#restore-reading').disabled);
    assert.equal(await page.locator('#reading-max-age').inputValue(), '72');
  } finally { await s.close(); }
});
