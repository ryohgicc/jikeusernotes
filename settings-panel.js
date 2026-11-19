(() => {
  'use strict';
  const notePrefix = 'jkn.note.';
  const readingPrefix = 'jkn.reading.';
  const settingsKey = 'jkn.settings';

  function maxAgeHours(value) {
    if (Number.isInteger(value?.readingMaxAgeHours) && value.readingMaxAgeHours >= 1 && value.readingMaxAgeHours <= 8760) return value.readingMaxAgeHours;
    if (Number.isInteger(value?.readingMaxAgeDays) && value.readingMaxAgeDays >= 1 && value.readingMaxAgeDays <= 365) return value.readingMaxAgeDays * 24;
    return 24;
  }

  function mount(target, { close } = {}) {
    target.innerHTML = `<style>
      .jkn-settings-panel { box-sizing: border-box; width: 100%; padding: 16px;
        color: #242424; background: #fff; font: 14px/1.6 system-ui, sans-serif; }
      .jkn-settings-panel * { box-sizing: border-box; }
      .jkn-settings-panel h1 { font-size: 18px; margin: 0; }
      .jkn-settings-panel h2 { font-size: 15px; margin: 18px 0 8px; }
      .jkn-settings-panel p { color: #666; margin: 8px 0; }
      .jkn-settings-panel button, .jkn-settings-panel label { display: block; width: 100%; margin: 8px 0;
        padding: 8px; border: 1px solid #ddd; border-radius: 8px; background: #fff;
        color: inherit; font: inherit; text-align: center; cursor: pointer; }
      .jkn-settings-panel input { margin-top: 8px; width: 100%; }
      .jkn-settings-panel input[type=checkbox] { margin: 0; width: auto; flex-shrink: 0; }
      .jkn-settings-panel input[type=number] { width: 70px; margin: 0; padding: 4px; }
      .jkn-settings-panel [role=status] { overflow-wrap: anywhere; }
      .jkn-settings-panel .toggle { display: flex; gap: 10px; text-align: left; align-items: center; }
      .jkn-settings-panel .age-setting { display: flex; gap: 8px; align-items: center; text-align: left; cursor: default; }
      .jkn-settings-panel input:disabled { cursor: not-allowed; }
      .jkn-settings-panel .heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .jkn-settings-panel .close { display: ${close ? 'block' : 'none'}; width: auto; margin: -8px -8px 0 0;
        padding: 4px 10px; border: 0; font-size: 22px; line-height: 1; }
      .jkn-settings-panel [data-import-label] { text-align: left; }
    </style>
    <section class="jkn-settings-panel" aria-label="即刻私人备注设置">
      <div class="heading"><h1>即刻私人备注</h1><button class="close" type="button" aria-label="关闭">×</button></div>
      <h2>阅读位置</h2>
      <label class="toggle"><input id="restore-reading" type="checkbox" disabled>自动记录并恢复阅读位置</label>
      <label class="toggle"><input id="reading-expiry" type="checkbox" disabled>限制阅读记录有效期</label>
      <label class="age-setting" for="reading-max-age">超过 <input id="reading-max-age" type="number" min="1" max="8760" step="1" value="24" required disabled> 小时不自动恢复</label>
      <p>从上次记录时间起计算，默认 24 小时，可设 1～8760 小时。关闭有效期限制后，记录长期有效。</p>
      <label class="toggle"><input id="reading-notice" type="checkbox" disabled>显示恢复结果与撤销提示</label>
      <p>支持首页动态、发现、个人主页动态。主动滚动会停止恢复；查找期间可随时取消。</p>
      <button id="clear-reading" type="button" disabled>清除阅读位置</button>
      <p id="reading-status" role="status"></p>
      <h2>私人备注</h2>
      <p>在即刻网页版点击昵称后的「+ 备注」。已有备注可点击修改。</p>
      <p id="count"></p>
      <button id="export" type="button">导出备注备份</button>
      <label data-import-label for="import">导入备份（合并，同一用户以导入为准）<input id="import" type="file" accept="application/json,.json"></label>
      <p id="status" role="status"></p>
      <p>数据仅保存在本机，不随账号同步。卸载扩展前请先导出。</p>
    </section>`;

    const query = selector => target.querySelector(selector);
    const status = query('#status');
    const readingStatus = query('#reading-status');
    const restoreReading = query('#restore-reading');
    const readingNotice = query('#reading-notice');
    const readingExpiry = query('#reading-expiry');
    const readingMaxAge = query('#reading-max-age');
    const clearReading = query('#clear-reading');

    function enableReadingControls() {
      restoreReading.disabled = false;
      readingNotice.disabled = readingExpiry.disabled = !restoreReading.checked;
      readingMaxAge.disabled = !restoreReading.checked || !readingExpiry.checked;
    }
    async function refreshReadingCount() {
      const data = await chrome.storage.local.get(null);
      clearReading.textContent = `清除阅读位置（${Object.keys(data).filter(key => key.startsWith(readingPrefix)).length} 条）`;
    }
    async function getNotes() {
      const data = await chrome.storage.local.get(null);
      return Object.fromEntries(Object.entries(data).filter(([key, value]) => key.startsWith(notePrefix) && typeof value === 'string'));
    }
    async function refreshCount() {
      query('#count').textContent = `已保存 ${Object.keys(await getNotes()).length} 位用户的备注`;
    }

    chrome.storage.local.get(settingsKey).then(async data => {
      const settings = data[settingsKey] || {};
      restoreReading.checked = settings.restoreReading !== false;
      readingNotice.checked = settings.showReadingNotice !== false;
      readingExpiry.checked = settings.readingExpiryEnabled !== false;
      readingMaxAge.value = maxAgeHours(settings);
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
          const next = { ...previous, restoreReading: restoreReading.checked, showReadingNotice: readingNotice.checked,
            readingExpiryEnabled: readingExpiry.checked, readingMaxAgeHours: savedHours };
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
        await chrome.storage.local.set({ 'jkn.readingResetAt': Date.now() });
        const data = await chrome.storage.local.get(null);
        const keys = Object.keys(data).filter(key => key.startsWith(readingPrefix));
        if (keys.length) await chrome.storage.local.remove(keys);
        await refreshReadingCount();
        readingStatus.textContent = '阅读位置已清除，私人备注已保留。';
      } catch { readingStatus.textContent = '清除失败，请重试。'; }
      finally { clearReading.disabled = false; }
    });
    refreshCount().catch(() => { status.textContent = '读取失败，请重新打开扩展。'; });
    query('#export').addEventListener('click', async () => {
      try {
        const data = { format: 'jike-private-notes-v1', notes: await getNotes() };
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'jike-private-notes.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        status.textContent = '已生成备份文件。';
      } catch { status.textContent = '导出失败，请重试。'; }
    });
    query('#import').addEventListener('change', async event => {
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
    query('.close').addEventListener('click', () => close?.());
    return target;
  }

  window.JknSettingsPanel = { mount };
})();
