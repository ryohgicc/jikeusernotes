const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { chromium } = require('playwright');

test('installed MV3 extension uses separate execution worlds and real extension storage', async () => {
  const repo = fs.realpathSync(path.resolve(__dirname, '..'));
  const results = path.join(repo, 'test-results');
  fs.mkdirSync(results, { recursive: true });
  // Keep browser state outside the extension's distributable files.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jike-extension-'));
  // Chrome derives an unpacked extension's ID from its absolute path.
  const id = crypto.createHash('sha256').update(repo).digest('hex').slice(0, 32)
    .replace(/./g, char => String.fromCharCode(97 + parseInt(char, 16)));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.EXTENSION_CHROME_PATH || undefined,
      channel: process.env.EXTENSION_CHROME_PATH ? undefined : 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${repo}`, `--load-extension=${repo}`]
    });
    let withNewPost = false;
    await context.route('https://web.okjike.com/**', route => {
      let body = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');
      if (withNewPost) body = body.replace('</html>', '<script>window.fixture.prepend("new-post")</script></html>');
      return route.fulfill({ contentType: 'text/html', body });
    });
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForFunction(() => !document.querySelector('#restore-reading').disabled);
    assert.equal(await popup.locator('#restore-reading').isChecked(), false);
    const page = await context.newPage();
    await page.goto('https://web.okjike.com/following');
    await page.waitForSelector('[data-jkn-post]');
    const floating = page.locator('[data-jkn-floating]');
    await floating.locator('.ball img').evaluate(image => image.complete && image.naturalWidth > 0);
    await floating.locator('.ball').click();
    assert.equal(await floating.locator('.menu').evaluate(node => node.classList.contains('open')), true);
    await floating.locator('[data-action="top"]').click();
    assert.equal(await page.locator('#viewport').evaluate(root => root.scrollTop), 0);
    await floating.locator('.ball').click();
    await floating.locator('[data-action="settings"]').click();
    await floating.locator('#reading-max-age').waitFor();
    assert.equal(await floating.locator('#reading-max-age').inputValue(), '24');
    assert.equal(await floating.locator('#restore-reading').isChecked(), false);
    await floating.locator('.close').click();
    assert.equal(await floating.locator('.overlay').evaluate(node => node.classList.contains('open')), false);
    await page.waitForTimeout(300);
    await page.mouse.move(500, 300);
    await page.mouse.wheel(0, 980);
    // Poll the storage Promise from Node; a Promise itself is truthy in a DOM poll.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const saved = await popup.evaluate(() => chrome.storage.local.get(null));
      if (saved['jkn.reading.account-a:/following']?.id === 'post-2') break;
      await popup.waitForTimeout(100);
    }
    const original = await popup.evaluate(async () => (await chrome.storage.local.get(null))['jkn.reading.account-a:/following']);
    assert.equal(original?.id, 'post-2', 'reading position was durably saved before reload');
    withNewPost = true;
    await page.reload();
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#viewport').evaluate(root => root.scrollTop), 0);
    const retained = await popup.evaluate(async () => (await chrome.storage.local.get(null))['jkn.reading.account-a:/following']);
    assert.equal(retained.id, original.id);
    assert.equal(retained.offset, original.offset);
    assert.equal(retained.top, original.top);
    await floating.locator('.ball').click();
    await floating.locator('[data-action="restore"]').click();
    await page.locator('[data-jkn-reading-mask]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-jkn-post="post-2"]');
      return card && Math.abs(card.getBoundingClientRect().top + 240) <= 2;
    }, undefined, { timeout: 10000 });
    await page.waitForTimeout(1700);
    const restored = await popup.evaluate(async () => (await chrome.storage.local.get(null))['jkn.reading.account-a:/following']);
    assert.equal(restored.id, original.id);
    assert.ok(Math.abs(restored.offset - original.offset) <= 2);
    assert.ok(restored.top > original.top, 'anchor restoration accounts for new content above');
    await page.waitForSelector('[data-jkn-reading-divider]');
    await page.locator('[data-jkn-reading-mask]').waitFor({ state: 'detached' });
    const marker = await page.locator('[data-jkn-reading-divider]').boundingBox();
    assert.ok(marker && Math.abs(marker.y) <= 2, 'real extension displays the reading marker in the feed');
    // Returning to the top must preserve the bookmark used by manual restore.
    await floating.locator('.ball').click();
    await floating.locator('[data-action="top"]').click();
    await page.waitForFunction(() => document.querySelector('#viewport').scrollTop === 0);
    await page.waitForTimeout(500);
    await floating.locator('.ball').click();
    await floating.locator('[data-action="restore"]').click();
    await page.waitForFunction(() => {
      const card = document.querySelector('[data-jkn-post="post-2"]');
      return card && Math.abs(card.getBoundingClientRect().top + 240) <= 2;
    });

    // An existing note still renders without parentheses in the isolated world.
    await page.locator('[data-jkn-reading-mask]').waitFor({ state: 'detached' });
    await popup.evaluate(() => chrome.storage.local.set({ 'jkn.note.author': '朋友' }));
    await page.waitForFunction(() => [...document.querySelectorAll('.jkn-note')].some(node => node.textContent === '朋友'));
    // Popup controls act on the real content script, without a mock API.
    await popup.locator('#restore-reading').check();
    await popup.waitForFunction(() => document.querySelector('#reading-status').textContent.includes('已保存'));
    await popup.locator('#restore-reading').uncheck();
    await popup.waitForFunction(() => document.querySelector('#reading-status').textContent.includes('已保存'));
    await page.waitForFunction(() => !document.querySelector('[data-jkn-reading-divider]'));
    await popup.locator('#clear-reading').click();
    await popup.waitForFunction(() => document.querySelector('#reading-status').textContent.includes('已清除'));
    const final = await popup.evaluate(() => chrome.storage.local.get(null));
    assert.equal(final['jkn.reading.account-a:/following'], undefined);
    assert.equal(final['jkn.note.author'], '朋友');
    await page.screenshot({ path: path.join(results, 'reading-restored.png') });
    await popup.screenshot({ path: path.join(results, 'popup.png') });
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
