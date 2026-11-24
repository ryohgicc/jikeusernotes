const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const repo = path.resolve(__dirname, '..');
let browser;
before(async () => {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || (fs.existsSync(chrome) ? chrome : undefined), headless: true });
});
after(async () => browser?.close());

test('stats store serializes tabs, deduplicates posts, splits midnight and isolates accounts', async () => {
  const context = await browser.newContext({ timezoneId: 'Asia/Shanghai' });
  try {
    await context.route('https://web.okjike.com/**', route => route.fulfill({ body: '<html></html>', contentType: 'text/html' }));
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    for (const page of pages) {
      await page.goto('https://web.okjike.com/following');
      await page.addScriptTag({ path: path.join(repo, 'stats-store.js') });
    }
    const now = Date.parse('2026-11-24T23:59:58+08:00');
    await Promise.all(pages.map(page => page.evaluate(async now => {
      await JknStatsStore.record('account-a', { start: now - 1000, end: now, ids: ['post-1', 'post-2'] }, now);
    }, now)));
    const read = time => pages[0].evaluate(time => JknStatsStore.read('account-a', time), time);
    assert.deepEqual(await read(now), { today: '2026-11-24', todayMs: 1000, totalMs: 1000, todayPosts: 2, totalPosts: 2 });
    const midnight = now + 2000;
    await pages[1].evaluate(async midnight => {
      await JknStatsStore.record('account-a', { start: midnight - 500, end: midnight + 500, ids: ['post-1', 'post-3'] }, midnight + 500);
    }, midnight);
    assert.deepEqual(await read(midnight + 500), { today: '2026-11-25', todayMs: 500, totalMs: 2000, todayPosts: 2, totalPosts: 3 });
    assert.equal((await pages[0].evaluate(now => JknStatsStore.read('account-b', now), now)).totalPosts, 0);
    await assert.rejects(() => pages[0].evaluate(now => JknStatsStore.record('account-a', { start: now - 60000, end: now, ids: [] }, now), now));
  } finally { await context.close(); }
});

test('tracker counts dwell, pauses when inactive and sends no automatic-search views', async () => {
  const context = await browser.newContext();
  try {
    await context.route('https://web.okjike.com/**', route => route.fulfill({ body: '<html></html>', contentType: 'text/html' }));
    const page = await context.newPage();
    await page.goto('https://web.okjike.com/following');
    await page.clock.install();
    await page.evaluate(() => {
      window.frame = { account: 'account-a', active: true, ids: ['post-1', 'post-2'] };
      window.samples = [];
      window.JknReadingStatsFrame = () => window.frame;
      window.chrome = { runtime: { sendMessage: async message => {
        window.samples.push(message);
        return { data: { todayMs: 1000, totalMs: 1000, todayPosts: 2, totalPosts: 2 } };
      } } };
    });
    await page.addScriptTag({ path: path.join(repo, 'stats.js') });
    await page.clock.runFor(1000);
    assert.equal(await page.evaluate(() => samples.length), 0);
    await page.clock.runFor(1000);
    assert.deepEqual(await page.evaluate(() => samples[0].sample.ids), ['post-1', 'post-2']);
    await page.clock.runFor(1000);
    assert.deepEqual(await page.evaluate(() => samples[1].sample.ids), []);
    await page.evaluate(() => { frame.active = false; frame.ids = ['auto-search-post']; });
    const count = await page.evaluate(() => samples.length);
    await page.clock.runFor(5000);
    assert.equal(await page.evaluate(() => samples.length), count);
    await page.evaluate(() => { frame.active = true; frame.ids = ['post-3']; });
    await page.clock.runFor(1000);
    assert.equal(await page.evaluate(() => samples.length), count);
    await page.clock.runFor(1000);
    const sample = await page.evaluate(() => samples.at(-1).sample);
    assert.deepEqual(sample.ids, ['post-3']);
    assert.equal(sample.end - sample.start, 1000);
    // A scroll halfway through the dwell resets the candidate.
    await page.evaluate(() => { frame.ids = ['fast-passed-post']; });
    await page.clock.runFor(1000);
    await page.clock.runFor(500);
    await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
    await page.clock.runFor(500);
    assert.deepEqual(await page.evaluate(() => samples.at(-1).sample.ids), []);
  } finally { await context.close(); }
});
