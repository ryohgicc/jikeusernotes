'use strict';
importScripts('stats-store.js');
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !['jkn.stats.get', 'jkn.stats.record'].includes(message?.type)) return;
  const url = sender.tab?.url || sender.url || '';
  if (!url.startsWith('https://web.okjike.com/')) return;
  const result = message.type === 'jkn.stats.record'
    ? JknStatsStore.record(message.account, message.sample) : JknStatsStore.read(message.account);
  result.then(data => respond({ data })).catch(() => respond({ error: '读取或保存浏览统计失败' }));
  return true;
});
