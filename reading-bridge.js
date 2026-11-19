(() => {
  'use strict';
  // Jike's virtual list removes the post content outside the viewport. Mark the
  // surviving wrapper using its React props; never inspect tokens or query caches.
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  let scheduled = false;

  function postId(node) {
    const key = Object.keys(node).find(name => name.startsWith('__reactFiber$'));
    let fiber = key && node[key];
    for (let depth = 0; fiber && depth < 24; depth += 1, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (validId(props?.data?.id)) return props.data.id;
      // The virtual wrapper receives {id, children}; its host node has no DOM id.
      if (validId(props?.id) && props.children) return props.id;
    }
    return null;
  }

  function annotate() {
    scheduled = false;
    for (const post of document.querySelectorAll('[class*="_post_"]')) {
      if (![...post.classList].some(name => /^_post_[a-zA-Z0-9]+_\d+$/.test(name))) continue;
      const wrapper = post.parentElement;
      if (!wrapper || wrapper.closest('[role="dialog"]')) continue;
      const id = postId(post) || postId(wrapper);
      if (id && wrapper.getAttribute('data-jkn-post') !== id) wrapper.setAttribute('data-jkn-post', id);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(annotate, 80);
  }
  annotate();
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
})();
