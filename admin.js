import { KV_DATA } from './kv-data.js';

document.addEventListener('DOMContentLoaded', () => {
  const syncBtn = document.getElementById('sync-btn');
  const listEl = document.getElementById('kv-list');
  const viewer = document.getElementById('kv-viewer');
  const loadingEl = document.getElementById('loading');
  const messageBox = document.getElementById('message-box');
  const diffModal = document.getElementById('diff-modal');
  const diffAdded = document.getElementById('diff-added');
  const diffChanged = document.getElementById('diff-changed');
  const diffDeleted = document.getElementById('diff-deleted');
  const confirmBtn = document.getElementById('confirm-sync');
  const cancelBtn = document.getElementById('cancel-sync');

  function showLoading() {
    loadingEl.style.display = 'flex';
  }

  function hideLoading() {
    loadingEl.style.display = 'none';
  }

  function showMessage(msg, type = 'error') {
    messageBox.textContent = msg;
    messageBox.className = type === 'error' ? 'error-box' : 'success-box';
  }

  function renderDiffList(el, items) {
    el.innerHTML = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.textContent = '(няма)';
      el.appendChild(li);
    } else {
      items.forEach(k => {
        const li = document.createElement('li');
        li.textContent = k;
        el.appendChild(li);
      });
    }
  }

  function showDiffModal(diff) {
    renderDiffList(diffAdded, diff.added);
    renderDiffList(diffChanged, diff.changed);
    renderDiffList(diffDeleted, diff.deleted);
    diffModal.style.display = 'flex';
  }

  function hideDiffModal() {
    diffModal.style.display = 'none';
  }

  async function loadKeys() {
    listEl.innerHTML = '';
    showLoading();
    try {
      const res = await fetch('/admin/keys', { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      data.keys.forEach(k => {
        const li = document.createElement('li');
        li.textContent = k;
        li.addEventListener('click', () => showKey(k));
        listEl.appendChild(li);
      });
    } catch (err) {
      showMessage('Грешка при извличането: ' + err.message);
    } finally {
      hideLoading();
    }
  }

  async function showKey(key) {
    showLoading();
    try {
      const res = await fetch(`/admin/get?key=${encodeURIComponent(key)}`, { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      let val = data.value || '';
      try { val = JSON.stringify(JSON.parse(val), null, 2); } catch {}
      viewer.textContent = val;
      viewer.style.display = 'block';
    } catch (err) {
      showMessage('Грешка: ' + err.message);
    } finally {
      hideLoading();
    }
  }

  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    showLoading();
    try {
      const res = await fetch('/admin/diff', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(KV_DATA)
      });
      if (!res.ok) throw new Error(await res.text());
      const diff = await res.json();
      showDiffModal(diff);
    } catch (err) {
      showMessage('Грешка: ' + err.message);
      syncBtn.disabled = false;
    } finally {
      hideLoading();
    }
  });

  confirmBtn.addEventListener('click', async () => {
    hideDiffModal();
    showLoading();
    try {
      const res = await fetch('/admin/sync', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(KV_DATA)
      });
      if (!res.ok) throw new Error(await res.text());
      const result = await res.json();
      showMessage(`Обновени: ${result.updated.length}, изтрити: ${result.deleted.length}`, 'success');
      await loadKeys();
    } catch (err) {
      showMessage('Грешка: ' + err.message);
    } finally {
      hideLoading();
      syncBtn.disabled = false;
    }
  });

  cancelBtn.addEventListener('click', () => {
    hideDiffModal();
    syncBtn.disabled = false;
  });

  loadKeys();
});

