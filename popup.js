'use strict';
const prefix = 'jkn.note.';
const status = document.querySelector('#status');
const readingStatus = document.querySelector('#reading-status');
const settingsKey = 'jkn.settings';
const readingPrefix = 'jkn.reading.';
const restoreReading = document.querySelector('#restore-reading');
const readingNotice = document.querySelector('#reading-notice');
const readingExpiry = document.querySelector('#reading-expiry');
const readingMaxAge = document.querySelector('#reading-max-age');
const clearReading = document.querySelector('#clear-reading');

function maxAgeHours(value) {
  if (Number.isInteger(value?.readingMaxAgeHours) && value.readingMaxAgeHours >= 1 && value.readingMaxAgeHours <= 8760) return value.readingMaxAgeHours;
  if (Number.isInteger(value?.readingMaxAgeDays) && value.readingMaxAgeDays >= 1 && value.readingMaxAgeDays <= 365) return value.readingMaxAgeDays * 24;
  return 24;
}

function enableReadingControls() {
  restoreReading.disabled = false;
  readingNotice.disabled = readingExpiry.disabled = !restoreReading.checked;
  readingMaxAge.disabled = !restoreReading.checked || !readingExpiry.checked;
}

async function refreshReadingCount() {
  const data = await chrome.storage.local.get(null);
  const count = Object.keys(data).filter(key => key.startsWith(readingPrefix)).length;
  clearReading.textContent = `清除阅读位置（${count} 条）`;
}

chrome.storage.local.get(settingsKey).then(async data => {
  restoreReading.checked = data[settingsKey]?.restoreReading !== false;
  readingNotice.checked = data[settingsKey]?.showReadingNotice !== false;
  readingExpiry.checked = data[settingsKey]?.readingExpiryEnabled !== false;
  readingMaxAge.value = maxAgeHours(data[settingsKey]);
  await refreshReadingCount();
  enableReadingControls();
  clearReading.disabled = false;
}).catch(() => { readingStatus.textContent = '读取设置失败，请重新打开扩展。'; });

for (const input of [restoreReading, readingNotice, readingExpiry, readingMaxAge]) {
  input.addEventListener('change', async () => {
    if (input === readingMaxAge && !readingMaxAge.checkValidity()) {
      readingMaxAge.setAttribute('aria-invalid', 'true');
      readingStatus.textContent = '请输入 1～8760 之间的整数小时数。';
      return;
    }
    restoreReading.disabled = readingNotice.disabled = readingExpiry.disabled = readingMaxAge.disabled = true;
    let previous;
    try {
      const data = await chrome.storage.local.get(settingsKey);
      previous = data[settingsKey] || {};
      const hours = Number(readingMaxAge.value);
      const savedHours = Number.isInteger(hours) && hours >= 1 && hours <= 8760 ? hours : maxAgeHours(previous);
      const next = {
        ...previous, restoreReading: restoreReading.checked, showReadingNotice: readingNotice.checked,
        readingExpiryEnabled: readingExpiry.checked,
        readingMaxAgeHours: savedHours
      };
      delete next.readingMaxAgeDays;
      await chrome.storage.local.set({ [settingsKey]: next });
      readingMaxAge.value = savedHours;
      readingMaxAge.removeAttribute('aria-invalid');
      readingStatus.textContent = '设置已保存。';
    } catch {
      if (input === readingMaxAge) readingMaxAge.value = maxAgeHours(previous);
      else input.checked = !input.checked;
      readingStatus.textContent = '保存失败，请重试。';
    } finally { enableReadingControls(); }
  });
}
clearReading.addEventListener('click', async () => {
  clearReading.disabled = true;
  try {
    // Announce reset before removal so open pages discard pending scroll saves.
    await chrome.storage.local.set({ 'jkn.readingResetAt': Date.now() });
    const data = await chrome.storage.local.get(null);
    const keys = Object.keys(data).filter(key => key.startsWith(readingPrefix));
    if (keys.length) await chrome.storage.local.remove(keys);
    await refreshReadingCount();
    readingStatus.textContent = '阅读位置已清除，私人备注已保留。';
  } catch { readingStatus.textContent = '清除失败，请重试。'; }
  finally { clearReading.disabled = false; }
});

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
