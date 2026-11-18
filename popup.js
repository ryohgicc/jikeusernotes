'use strict';
const prefix = 'jkn.note.';
const status = document.querySelector('#status');
async function getNotes() {
  const data = await chrome.storage.local.get(null);
  return Object.fromEntries(Object.entries(data).filter(([key, value]) => key.startsWith(prefix) && typeof value === 'string'));
}
async function refreshCount() {
  document.querySelector('#count').textContent = `已保存 ${Object.keys(await getNotes()).length} 位用户的备注`;
}
refreshCount().catch(() => { status.textContent = '读取失败，请重新打开扩展。'; });
document.querySelector('#export').addEventListener('click', async () => {
  try {
    const notes = await getNotes();
    const data = { format: 'jike-private-notes-v1', notes };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'jike-private-notes.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    status.textContent = '已生成备份文件。';
  } catch { status.textContent = '导出失败，请重试。'; }
});
document.querySelector('#import').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('备份不能超过 2 MB。');
    const data = JSON.parse(await file.text());
    if (data?.format !== 'jike-private-notes-v1' || !data.notes || typeof data.notes !== 'object' || Array.isArray(data.notes)) throw new Error('不是有效的备注备份。');
    const entries = Object.entries(data.notes);
    if (entries.some(([key, value]) => !/^jkn\.note\.[a-zA-Z0-9_-]{1,128}$/.test(key) || typeof value !== 'string' || !value.trim() || value.length > 80)) throw new Error('备份中含有无效备注，未导入。');
    await chrome.storage.local.set(Object.fromEntries(entries));
    await refreshCount();
    status.textContent = `已合并 ${entries.length} 条备注。`;
  } catch (error) { status.textContent = `导入失败：${error.message}`; }
  event.target.value = '';
});
