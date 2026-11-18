(() => {
  'use strict';
  const prefix = 'jkn.note.';
  const notes = new Map();
  const mounts = new Map();
  let timer;
  let editor;

  function identity(anchor) {
    try {
      const url = new URL(anchor.getAttribute('href'), location.href);
      if (url.origin !== location.origin) return null;
      const match = url.pathname.match(/^\/u\/([^/]+)\/?$/);
      if (!match) return null;
      const id = decodeURIComponent(match[1]);
      return /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? id : null;
    } catch { return null; }
  }

  function render(button, id, name) {
    const note = notes.get(id) || '';
    const label = note ? `（${note}）` : '+ 备注';
    if (button.textContent !== label) button.textContent = label;
    const title = `${name}：${note || '尚未添加备注'}；点击修改`;
    if (button.title !== title) {
      button.title = title;
      button.setAttribute('aria-label', title);
    }
  }

  function isProfileTabAnchor(anchor) {
    // The profile's tab bar reuses the profile URL for labels such as
    // “动态 / 相册 / 收藏 / 我的圈子”. It is navigation, not a user name.
    if (anchor.closest('[role="tab"], [role="tablist"], nav')) return true;
    return /^(动态|相册|收藏|我的圈子)$/.test(anchor.textContent.replace(/\s/g, ''));
  }

  function scan() {
    for (const [anchor, item] of mounts) {
      if (!anchor.isConnected || identity(anchor) !== item.id || isProfileTabAnchor(anchor)) {
        item.button.remove();
        mounts.delete(anchor);
      }
    }
    for (const anchor of document.querySelectorAll('a[href*="/u/"]')) {
      const id = identity(anchor);
      const name = anchor.textContent.trim();
      // Avatar links and links wrapping whole cards are not nickname labels.
      if (!id || !name || name.length > 100 || isProfileTabAnchor(anchor) || anchor.querySelector('img, svg, button, a')) continue;
      const parent = anchor.parentElement;
      const target = parent?.matches('[class*="_username_"]') ? parent : anchor;
      let item = mounts.get(anchor);
      if (!item) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'jkn-note';
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          openEditor(id, anchor.textContent.trim(), button);
        });
        button.addEventListener('pointerdown', event => event.stopPropagation());
        item = { id, button };
        mounts.set(anchor, item);
      }
      if (target.nextSibling !== item.button) target.after(item.button);
      render(item.button, id, name);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(scan, 100);
  }

  function openEditor(id, name, opener) {
    if (editor) return;
    const host = document.createElement('div');
    host.dataset.jknEditor = '';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host { all: initial; }
      dialog { box-sizing: border-box; width: min(400px, calc(100vw - 32px));
        padding: 24px; border: 1px solid #e5e5e5; border-radius: 16px;
        color: #242424; background: #fff; font: 14px/1.6 system-ui, sans-serif;
        box-shadow: 0 16px 64px #0003; }
      dialog::backdrop { background: #0006; }
      h2 { margin: 0 0 8px; font-size: 18px; }
      p { margin: 8px 0; color: #666; overflow-wrap: anywhere; }
      label { display: block; margin-top: 16px; }
      input { box-sizing: border-box; width: 100%; margin-top: 6px; padding: 10px;
        border: 1px solid #aaa; border-radius: 8px; font: inherit; }
      input:focus { outline: 2px solid #d6b33e; outline-offset: 2px; }
      footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
      button { padding: 8px 16px; border: 1px solid #ddd; border-radius: 8px;
        background: #fff; color: #222; font: inherit; cursor: pointer; }
      button[type=submit] { background: #ffe371; border-color: #ffe371; }
      [role=alert] { color: #b42318; }
    </style>
    <dialog aria-labelledby="heading"><form>
      <h2 id="heading">私人备注</h2><p id="person"></p>
      <label for="note">备注（最多 80 字）</label>
      <input id="note" maxlength="80" autocomplete="off" placeholder="例如：做 AI 产品的朋友">
      <p>仅保存在当前浏览器；清空后保存可删除备注。</p>
      <p role="alert" hidden></p>
      <footer><button type="button">取消</button><button type="submit">保存</button></footer>
    </form></dialog>`;
    const dialog = shadow.querySelector('dialog');
    const input = shadow.querySelector('input');
    const error = shadow.querySelector('[role=alert]');
    const submit = shadow.querySelector('[type=submit]');
    shadow.querySelector('#person').textContent = name;
    input.value = notes.get(id) || '';
    function close() {
      if (submit.disabled) return;
      dialog.close();
      host.remove();
      editor = null;
      if (opener.isConnected) opener.focus();
    }
    for (const type of ['click', 'pointerdown', 'keydown', 'keyup']) {
      host.addEventListener(type, event => event.stopPropagation());
    }
    shadow.querySelector('[type=button]').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    shadow.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      error.hidden = true;
      const value = input.value.trim();
      try {
        if (value) await chrome.storage.local.set({ [prefix + id]: value });
        else await chrome.storage.local.remove(prefix + id);
        if (value) notes.set(id, value);
        else notes.delete(id);
        scan();
        submit.disabled = false;
        close();
      } catch {
        error.textContent = '保存失败，请重试。若扩展刚更新，请刷新即刻页面。';
        error.hidden = false;
        submit.disabled = false;
      }
    });
    editor = host;
    document.documentElement.append(host);
    dialog.showModal();
    input.focus();
    input.select();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(prefix)) continue;
      const id = key.slice(prefix.length);
      if (typeof change.newValue === 'string') notes.set(id, change.newValue);
      else notes.delete(id);
    }
    schedule();
  });

  chrome.storage.local.get(null).then(data => {
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith(prefix) && typeof value === 'string') notes.set(key.slice(prefix.length), value);
    }
    scan();
    new MutationObserver(schedule).observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['href']
    });
  }).catch(error => console.error('[即刻私人备注] 无法读取备注，请刷新页面。', error));
})();
