import { KV_DATA } from './kv-data.js';

document.addEventListener('DOMContentLoaded', () => {
  const syncBtn = document.getElementById('sync-btn');
  const listEl = document.getElementById('kv-list');
  const editor = document.getElementById('editor');
  const keyInput = document.getElementById('kv-key');
  const valueTextarea = document.getElementById('kv-value');
  const saveBtn = document.getElementById('save-btn');
  const deleteBtn = document.getElementById('delete-btn');
  const newKeyBtn = document.getElementById('new-key-btn');

  async function loadKeys() {
    listEl.innerHTML = '';
    try {
      const res = await fetch('/admin/keys', { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      data.keys.forEach(k => {
        const li = document.createElement('li');
        li.textContent = k;
        li.addEventListener('click', () => openEditor(k));
        listEl.appendChild(li);
      });
    } catch (err) {
      const li = document.createElement('li');
      li.textContent = 'Грешка при извличането: ' + err.message;
      listEl.appendChild(li);
    }
  }

  async function openEditor(key) {
    try {
      const res = await fetch(`/admin/get?key=${encodeURIComponent(key)}`, { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      keyInput.value = data.key;
      let val = data.value || '';
      try { val = JSON.stringify(JSON.parse(val), null, 2); } catch {}
      valueTextarea.value = val;
      editor.style.display = 'block';
    } catch (err) {
      alert('Грешка: ' + err.message);
    }
  }

  saveBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('/admin/put', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keyInput.value, value: valueTextarea.value })
      });
      if (!res.ok) throw new Error(await res.text());
      alert('Записът е обновен успешно');
      await loadKeys();
    } catch (err) {
      alert('Грешка: ' + err.message);
    }
  });

  deleteBtn.addEventListener('click', async () => {
    if (!confirm('Сигурни ли сте, че искате да изтриете този ключ?')) return;
    try {
      const res = await fetch(`/admin/delete?key=${encodeURIComponent(keyInput.value)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!res.ok) throw new Error(await res.text());
      alert('Ключът е изтрит');
      editor.style.display = 'none';
      keyInput.value = '';
      valueTextarea.value = '';
      await loadKeys();
    } catch (err) {
      alert('Грешка: ' + err.message);
    }
  });

  newKeyBtn.addEventListener('click', () => {
    keyInput.value = '';
    valueTextarea.value = '';
    editor.style.display = 'block';
    keyInput.focus();
  });

  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    try {
      const res = await fetch('/admin/sync', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(KV_DATA)
      });
      if (!res.ok) throw new Error(await res.text());
      alert('KV синхронизацията завърши успешно');
      await loadKeys();
    } catch (err) {
      alert('Грешка: ' + err.message);
    } finally {
      syncBtn.disabled = false;
    }
  });

  loadKeys();
});
