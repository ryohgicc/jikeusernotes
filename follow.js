(() => {
  'use strict';

  // Use the post author's existing hover card and its own FollowToggleButton.
  // No account credentials or query cache are read by the extension.
  const mounts = new Map();
  const pending = new Set();
  let rescanTimer;
  let scheduled = false;
  let observer;
  let stopped = false;
  const validName = name => typeof name === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(name);

  function username(anchor) {
    try {
      const url = new URL(anchor.getAttribute('href'), location.href);
      const match = url.origin === location.origin && url.pathname.match(/^\/u\/([a-zA-Z0-9_-]{1,128})\/?$/);
      return match ? match[1] : null;
    } catch { return null; }
  }

  function currentUser() {
    for (const label of document.querySelectorAll('[title="个人主页"], [aria-label="个人主页"]')) {
      const link = label.closest('a[href]');
      const name = link && username(link);
      if (name) return name;
    }
    return null;
  }

  function inspectAuthor(anchor, name) {
    const key = Object.keys(anchor).find(item => item.startsWith('__reactFiber$'));
    let fiber = key && anchor[key];
    let hoverChildren;
    for (let depth = 0; fiber && depth < 28; depth += 1, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (fiber.type?.name === 'HoverCard') hoverChildren = props?.children;
      if (!hoverChildren || typeof fiber.type !== 'function' || props?.data?.username !== name || !props.children) continue;
      const results = [];
      const visit = (element, level) => {
        if (!element || level > 10) return;
        if (Array.isArray(element)) {
          for (const child of element) visit(child, level + 1);
          return;
        }
        if (typeof element !== 'object' || !element.props) return;
        const data = element.props.data;
        if (typeof element.type === 'function' && data?.username === name &&
            typeof element.props.className === 'string' && /(?:^|\s)_followButton_[a-zA-Z0-9]+_\d+(?:\s|$)/.test(element.props.className)) {
          results.push(data);
        }
        visit(element.props.children, level + 1);
      };
      visit(hoverChildren, 0);
      if (results.length !== 1 || !validName(results[0].username) || typeof results[0].id !== 'string' ||
          typeof results[0].following !== 'boolean') return null;
      return { id: results[0].id, following: results[0].following };
    }
    return null;
  }

  function getMount(anchor) {
    const name = username(anchor);
    const self = currentUser();
    if (!name || !self || name === self || !anchor.textContent.trim()) return null;
    const header = anchor.closest('header[class*="_header_"]');
    const author = header?.querySelector('a[href*="/u/"]');
    const target = anchor.closest('[aria-haspopup="dialog"][aria-controls]');
    if (author !== anchor || !target || !header.contains(target) || anchor.closest('[role="dialog"]')) return null;
    const data = inspectAuthor(anchor, name);
    if (!data) return null;
    const note = target.querySelector('.jkn-note');
    return { name, header, target, data, note };
  }

  function sameAuthor(item, mount) {
    return mount && item.name === mount.name && item.id === mount.data.id && item.target === mount.target;
  }

  function render(item, mount) {
    const label = mount.data.following ? '已关注' : '+ 关注';
    if (item.button.textContent !== label) item.button.textContent = label;
    if (item.button.dataset.following !== String(mount.data.following)) item.button.dataset.following = String(mount.data.following);
    const locked = pending.has(item.name);
    if (item.button.disabled !== locked) item.button.disabled = locked;
    const description = `${label} ${item.anchor.textContent.trim()}`;
    if (item.button.getAttribute('aria-label') !== description) item.button.setAttribute('aria-label', description);
  }

  function disconnect(item) {
    item.cancel?.();
    item.button.remove();
    mounts.delete(item.anchor);
  }

  function scan() {
    scheduled = false;
    if (stopped) return;
    for (const item of mounts.values()) {
      const mount = item.anchor.isConnected && getMount(item.anchor);
      if (!sameAuthor(item, mount)) disconnect(item);
    }
    let unresolved = false;
    for (const anchor of document.querySelectorAll('header[class*="_header_"] a[href*="/u/"]')) {
      const mount = getMount(anchor);
      if (!mount) {
        const name = username(anchor);
        if (name && name !== currentUser() && anchor.closest('[aria-haspopup="dialog"][aria-controls]')) unresolved = true;
        continue;
      }
      let item = mounts.get(anchor);
      if (!item) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'jkn-follow';
        item = { anchor, button, name: mount.name, id: mount.data.id, target: mount.target, cancel: null };
        for (const type of ['pointerdown', 'mouseover', 'mouseout']) {
          button.addEventListener(type, event => event.stopPropagation());
        }
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          activate(item);
        });
        mounts.set(anchor, item);
      }
      const insertAfter = mount.note || mount.target.querySelector('[class*="_username_"]') || anchor;
      if (insertAfter.nextSibling !== item.button) insertAfter.after(item.button);
      render(item, mount);
    }
    if ((mounts.size || unresolved) && !rescanTimer) {
      // React may update its props without changing the DOM.
      rescanTimer = setTimeout(() => { rescanTimer = null; schedule(); }, 2000);
    } else if (!mounts.size && !unresolved) {
      clearTimeout(rescanTimer);
      rescanTimer = null;
    }
  }

  function schedule() {
    if (stopped || scheduled) return;
    scheduled = true;
    setTimeout(scan, 100);
  }

  function activate(item) {
    if (item.cancel || pending.has(item.name)) return;
    const initial = getMount(item.anchor);
    if (!sameAuthor(item, initial)) return schedule();
    pending.add(item.name);
    for (const mount of mounts.values()) if (mount.name === item.name) mount.button.disabled = true;
    const openedByUs = item.target.getAttribute('aria-expanded') !== 'true';
    const startedAt = performance.now();
    let attempts = 0;
    let timer;
    let waitingForCard = false;
    let syntheticHover = false;
    let observer;
    let finished = false;
    let lockTimer;

    function unlock() {
      clearTimeout(lockTimer);
      pending.delete(item.name);
      for (const mount of mounts.values()) if (mount.name === item.name) mount.button.disabled = false;
      schedule();
    }

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      observer?.disconnect();
      item.cancel = null;
      unlock();
      document.getElementById(item.target.getAttribute('aria-controls'))?.classList.remove('jkn-follow-card-opening');
      if (syntheticHover && item.target.isConnected) {
        item.target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
      }
      schedule();
    }
    item.cancel = finish;
    if (openedByUs) {
      syntheticHover = true;
      item.target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
    }

    function tryClick() {
      if (finished) return;
      if (performance.now() - startedAt > 2200) return finish();
      const latest = item.anchor.isConnected && item.button.isConnected && getMount(item.anchor);
      if (!sameAuthor(item, latest) || latest.data.following !== initial.data.following) return finish();
      const dropdown = document.getElementById(item.target.getAttribute('aria-controls'));
      if (dropdown && syntheticHover) dropdown.classList.add('jkn-follow-card-opening');
      if (dropdown && item.target.getAttribute('aria-expanded') === 'true') {
        const cardName = dropdown.querySelector('a[href*="/u/"]');
        const buttons = [...dropdown.querySelectorAll('button')].filter(button =>
          /(?:^|\s)_(?:followButton|followedButton)_[a-zA-Z0-9]+_\d+(?:\s|$)/.test(button.className));
        if (!cardName || username(cardName) !== item.name || buttons.length !== 1) return finish();
        const native = buttons[0];
        if (!native.disabled && native.textContent.trim() === (initial.data.following ? '已关注' : '关注')) {
          clearTimeout(timer);
          observer?.disconnect();
          // Keep Jike's hover card mounted while its async mutation completes.
          // Otherwise the site's profile query is no longer observed and can stay stale.
          const release = () => {
            const current = getMount(item.anchor);
            const hasConfirmation = [...document.querySelectorAll('[role=dialog]')].some(dialog =>
              dialog.textContent.includes('确定取消关注吗？') &&
              [...dialog.querySelectorAll('button')].some(button => button.textContent.trim() === '不再关注') &&
              dialog.getClientRects().length > 0);
            if (hasConfirmation) { lockTimer = setTimeout(release, 250); return; }
            const nativeBusy = native.isConnected && native.disabled;
            if (performance.now() - startedAt < 1300 || (nativeBusy && performance.now() - startedAt < 15000)) {
              lockTimer = setTimeout(release, 200); return;
            }
            if (performance.now() - startedAt < 15000 && sameAuthor(item, current) && current.data.following === initial.data.following) {
              // Failed/cancelled actions retain their old state; don't lock the button indefinitely.
              if (performance.now() - startedAt < 3000) { lockTimer = setTimeout(release, 200); return; }
            }
            finish();
          };
          native.click();
          lockTimer = setTimeout(release, 200);
          return;
        }
      }
      attempts += 1;
      if (attempts >= 40) return finish();
      if (!waitingForCard) {
        waitingForCard = true;
        observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(tryClick, 0); });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'disabled'] });
      }
      clearTimeout(timer);
      timer = setTimeout(tryClick, 50);
    }
    tryClick();
  }

  scan();
  observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['href']
  });
  addEventListener('jkn-context-expired', () => {
    stopped = true;
    observer.disconnect();
    clearTimeout(rescanTimer);
    for (const item of mounts.values()) disconnect(item);
    pending.clear();
  }, { once: true });
})();
