// Скрипт за динамично обновяване на прогрес баровете в доклада
// Използва localStorage.iridologyReport и следи за промени в логовете

document.addEventListener('DOMContentLoaded', () => {
  function updateProgressBars() {
    try {
      const raw = localStorage.getItem('iridologyReport');
      if (!raw) return;
      const data = JSON.parse(raw);
      const indexes = data.indexes || {};

      document.querySelectorAll('.analytics-card progress, .main-indexes progress').forEach(bar => {
        const key = bar.dataset.key;
        const value = Number(indexes[key] || 0);
        bar.value = value;
        // показваме стойността в проценти като текст след прогрес бара
        let indicator = bar.nextElementSibling;
        if (!indicator || !indicator.classList.contains('progress-value')) {
          indicator = document.createElement('span');
          indicator.className = 'progress-value';
          bar.parentElement.appendChild(indicator);
        }
        indicator.textContent = `${value}%`;
      });
    } catch (err) {
      console.error('Грешка при обновяване на прогрес баровете:', err);
    }
  }

  updateProgressBars();
  window.addEventListener('storage', updateProgressBars);
});
