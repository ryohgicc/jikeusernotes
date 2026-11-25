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
after(async () => { await browser?.close(); });

async function session(rows) {
  const context = await browser.newContext();
  await context.route('https://web.okjike.com/**', route => route.fulfill({
    contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, 'follow-fixture.html'), 'utf8')
  }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://web.okjike.com/following');
  const ids = await page.evaluate(rows => rows.map(row => window.fixture.add(...row)), rows);
  await page.addScriptTag({ path: path.join(repo, 'follow.js') });
  return { page, ids, close: async () => { await context.close(); assert.deepEqual(errors, []); } };
}
const row = (page, id) => page.locator(`header[data-row="${id}"]`);
test('uses native follow, syncs duplicate authors and retains native unfollow confirmation', async () => {
  const s = await session([['alice', false], ['alice', false]]);
  try {
    const [first, second] = s.ids.map(id => row(s.page, id));
    const firstButton = first.locator('.jkn-follow');
    const secondButton = second.locator('.jkn-follow');
    await firstButton.waitFor();
    await secondButton.waitFor();
    assert.equal(await firstButton.innerText(), '+ 关注');
    const order = await first.locator('[aria-haspopup]').evaluate(node => [...node.querySelectorAll('a, button')].map(el => el.textContent));
    assert.deepEqual(order, ['alice', '+ 备注', '+ 关注']);
    await firstButton.click();
    await s.page.waitForFunction(() => [...document.querySelectorAll('.jkn-follow')].every(el => el.textContent === '已关注'));
    assert.deepEqual(await s.page.evaluate(() => window.fixture.actions()), [{ username: 'alice', type: 'native-click', following: false }]);
    await secondButton.click();
    await s.page.locator('#confirm').waitFor();
    assert.equal(await firstButton.innerText(), '已关注');
    await s.page.locator('[data-choice="cancel"]').click();
    assert.equal(await firstButton.innerText(), '已关注');
    await secondButton.click();
    await s.page.locator('[data-choice="confirm"]').click();
    await s.page.waitForFunction(() => [...document.querySelectorAll('.jkn-follow')].every(el => el.textContent === '+ 关注'));
    assert.equal((await s.page.evaluate(() => window.fixture.actions())).filter(a => a.type === 'post-click').length, 0);
  } finally { await s.close(); }
});

test('hides buttons when author is self or status is unknown and handles updated state', async () => {
  const s = await session([['self', false], ['alice', null], ['bob', true]]);
  try {
    await row(s.page, s.ids[2]).locator('.jkn-follow').waitFor();
    assert.equal(await row(s.page, s.ids[0]).locator('.jkn-follow').count(), 0);
    assert.equal(await row(s.page, s.ids[1]).locator('.jkn-follow').count(), 0);
    assert.equal(await row(s.page, s.ids[2]).locator('.jkn-follow').innerText(), '已关注');
    await s.page.evaluate(() => window.fixture.setFollowing('alice', false));
    await row(s.page, s.ids[1]).locator('.jkn-follow').waitFor();
    assert.equal(await row(s.page, s.ids[1]).locator('.jkn-follow').innerText(), '+ 关注');
  } finally { await s.close(); }
});

test('aborts when the hover card belongs to a different author', async () => {
  const s = await session([['alice', false, { mode: 'wrong-user' }]]);
  try {
    const button = row(s.page, s.ids[0]).locator('.jkn-follow');
    await button.click();
    await s.page.waitForTimeout(250);
    assert.deepEqual(await s.page.evaluate(() => window.fixture.actions()), []);
    assert.equal(await button.isDisabled(), false);
    assert.equal(await button.innerText(), '+ 关注');
  } finally { await s.close(); }
});

test('does not click a stale card when virtualized row is reused', async () => {
  const s = await session([['alice', false, { delay: 350 }]]);
  try {
    const container = row(s.page, s.ids[0]);
    await container.locator('.jkn-follow').click();
    await s.page.evaluate(id => window.fixture.replace(id, 'bob', false), s.ids[0]);
    await s.page.waitForTimeout(650);
    assert.deepEqual(await s.page.evaluate(() => window.fixture.actions()), []);
    assert.equal(await container.locator('.jkn-follow').count(), 1);
    assert.equal(await container.locator('.jkn-follow').getAttribute('aria-label'), '+ 关注 bob');
    await container.locator('.jkn-follow').click();
    await s.page.waitForFunction(() => window.fixture.actions().length > 0);
    assert.deepEqual(await s.page.evaluate(() => window.fixture.actions()), [{ username: 'bob', type: 'native-click', following: false }]);
  } finally { await s.close(); }
});

test('a failed native action does not optimistically change follow state', async () => {
  const s = await session([['alice', false, { mode: 'fail' }]]);
  try {
    const button = row(s.page, s.ids[0]).locator('.jkn-follow');
    await button.click();
    await s.page.waitForFunction(() => window.fixture.actions().length === 1);
    assert.equal(await button.innerText(), '+ 关注');
  } finally { await s.close(); }
});

test('a disabled native button times out, and context expiration removes buttons and pending actions', async () => {
  const s = await session([['alice', false, { mode: 'disabled' }], ['bob', false, { delay: 600 }]]);
  try {
    const first = row(s.page, s.ids[0]).locator('.jkn-follow');
    await first.click();
    await s.page.waitForTimeout(2500);
    assert.deepEqual(await s.page.evaluate(() => window.fixture.actions()), []);
    assert.equal(await first.isDisabled(), false);
    await row(s.page, s.ids[1]).locator('.jkn-follow').click();
    await s.page.evaluate(() => window.fixture.expire());
    await s.page.waitForTimeout(750);
    assert.equal(await s.page.locator('.jkn-follow').count(), 0);
    assert.deepEqual(await s.page.evaluate(() => window.fixture.actions()), []);
  } finally { await s.close(); }
});


test('waits for a slow native request and prevents repeated follow clicks', async () => {
  const s = await session([['alice', false, { mutationDelay: 1800 }], ['alice', false]]);
  try {
    const [first, second] = s.ids.map(id => row(s.page, id).locator('.jkn-follow'));
    await first.click();
    await s.page.waitForFunction(() => window.fixture.actions().length === 1);
    assert.equal(await first.isDisabled(), true);
    assert.equal(await second.isDisabled(), true);
    await second.evaluate(node => node.click());
    assert.equal((await s.page.evaluate(() => window.fixture.actions())).length, 1);
    await s.page.waitForFunction(() => [...document.querySelectorAll('.jkn-follow')].every(el => el.textContent === '已关注' && !el.disabled));
  } finally { await s.close(); }
});

test('detects profile data arriving without a DOM mutation', async () => {
  const s = await session([['alice', null]]);
  try {
    assert.equal(await s.page.locator('.jkn-follow').count(), 0);
    await s.page.evaluate(() => window.fixture.setFollowingWithoutDom('alice', false));
    await s.page.locator('.jkn-follow').waitFor({ timeout: 4000 });
  } finally { await s.close(); }
});


test('refreshes follow state updated elsewhere without a DOM mutation', async () => {
  const s = await session([['alice', false]]);
  try {
    const button = row(s.page, s.ids[0]).locator('.jkn-follow');
    await button.waitFor();
    await s.page.evaluate(() => window.fixture.setFollowingWithoutDom('alice', true));
    await s.page.waitForFunction(() => document.querySelector('.jkn-follow')?.textContent === '已关注', null, { timeout: 4000 });
  } finally { await s.close(); }
});


test('hovering the shortcut alone does not open the native profile card', async () => {
  const s = await session([['alice', false]]);
  try {
    const button = row(s.page, s.ids[0]).locator('.jkn-follow');
    await button.hover();
    await s.page.waitForTimeout(250);
    assert.equal(await row(s.page, s.ids[0]).locator('[aria-haspopup]').getAttribute('aria-expanded'), 'false');
    await button.click();
    await s.page.waitForFunction(() => window.fixture.actions().length === 1);
    assert.equal((await s.page.evaluate(() => window.fixture.actions()))[0].username, 'alice');
  } finally { await s.close(); }
});
