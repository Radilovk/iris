document.addEventListener('DOMContentLoaded', () => {
  const syncBtn = document.getElementById('sync-btn');
  const listEl = document.getElementById('kv-list');

  async function loadKeys() {
    listEl.innerHTML = '';
    try {
      const res = await fetch('/admin/keys', { credentials: 'include' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      data.keys.forEach(k => {
        const li = document.createElement('li');
        li.textContent = k;
        listEl.appendChild(li);
      });
    } catch (err) {
      const li = document.createElement('li');
      li.textContent = 'Грешка при извличането: ' + err.message;
      listEl.appendChild(li);
    }
  }

  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    try {
      const res = await fetch('/admin/sync', { method: 'POST', credentials: 'include' });
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
