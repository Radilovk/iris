import { WORKER_URL, MAX_IMAGE_BYTES } from './config.js';

// --- КОНФИГУРАЦИЯ ---
// Стойностите се споделят с админ панела чрез config.js

document.addEventListener('DOMContentLoaded', () => {
  // --- ЕЛЕМЕНТИ ---
  const form = document.getElementById('iridology-form');
  if (!form) return;

  const formSteps = form.querySelectorAll('.form-step');
  const nextBtns = form.querySelectorAll('.next-btn');
  const prevBtns = form.querySelectorAll('.prev-btn');
  const stepperSteps = form.querySelectorAll('.step');
  const messageBox = document.getElementById('message-box');
  const messageContent = messageBox.querySelector('.message-content');
  const progressBarContainer = messageBox.querySelector('.progress-bar-container');
  const progressBar = messageBox.querySelector('.progress-bar');

  let currentStep = 1;
  let cacheNotice = '';
  let currentMessage = '';
  let currentMessageType = 'info';

  // --- Зареждане на позиционирани снимки от localStorage ---
  loadPositionedImages();

  function loadPositionedImages() {
    const positionedData = localStorage.getItem('positionedIrisImages');
    if (!positionedData) return;

    try {
      const data = JSON.parse(positionedData);
      
      // Load left eye
      if (data.left) {
        const leftPreview = document.getElementById('left-eye-preview');
        const leftInput = document.getElementById('left-eye-upload');
        if (leftPreview) {
          leftPreview.querySelector('i').style.display = 'none';
          leftPreview.querySelector('p').style.display = 'none';
          leftPreview.style.backgroundImage = `url(${data.left})`;
          leftPreview.style.borderStyle = 'solid';
          
          // Convert data URL to File object
          dataURLtoFile(data.left, 'left-eye.png').then(file => {
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            leftInput.files = dataTransfer.files;
          });
        }
      }

      // Load right eye
      if (data.right) {
        const rightPreview = document.getElementById('right-eye-preview');
        const rightInput = document.getElementById('right-eye-upload');
        if (rightPreview) {
          rightPreview.querySelector('i').style.display = 'none';
          rightPreview.querySelector('p').style.display = 'none';
          rightPreview.style.backgroundImage = `url(${data.right})`;
          rightPreview.style.borderStyle = 'solid';
          
          // Convert data URL to File object
          dataURLtoFile(data.right, 'right-eye.png').then(file => {
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            rightInput.files = dataTransfer.files;
          });
        }
      }

      showMessage('Позиционирани снимки са заредени успешно', 'info');
    } catch (error) {
      console.warn('Could not load positioned images:', error);
    }
  }

  async function dataURLtoFile(dataurl, filename) {
    const res = await fetch(dataurl);
    const blob = await res.blob();
    return new File([blob], filename, { type: 'image/png' });
  }

  // --- ОСНОВНА ЛОГИКА ЗА НАВИГАЦИЯ ---
  function showStep(stepNumber) {
    currentStep = stepNumber;
    formSteps.forEach((step) => step.classList.remove('active'));
    form.querySelector(`.form-step[data-step="${currentStep}"]`).classList.add('active');

    stepperSteps.forEach((step, index) => {
      step.classList.remove('active', 'completed');
      if (index + 1 === currentStep) {
        step.classList.add('active');
      } else if (index + 1 < currentStep) {
        step.classList.add('completed');
      }
    });
  }

  nextBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (validateCurrentStep() && currentStep < formSteps.length) {
        showStep(currentStep + 1);
      }
    });
  });

  prevBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (currentStep > 1) {
        showStep(currentStep - 1);
      }
    });
  });

  // --- ВАЛИДАЦИЯ ---
  function validateCurrentStep() {
    const currentStepElement = form.querySelector(`.form-step[data-step="${currentStep}"]`);
    const requiredFields = currentStepElement.querySelectorAll('[required]');
    let isStepValid = true;
    let firstInvalidField = null;

    requiredFields.forEach((field) => {
      const parentGroup = field.closest('.form-group');
      parentGroup.classList.remove('error');

      let isFieldValid = true;
      if (field.type === 'file') {
        if (field.files.length === 0) isFieldValid = false;
      } else {
        if (!field.value.trim()) isFieldValid = false;
      }

      if (!isFieldValid) {
        isStepValid = false;
        parentGroup.classList.add('error');
        if (!firstInvalidField) firstInvalidField = field;
      }
    });

    if (!isStepValid) {
      showMessage('Моля, попълнете задължителните полета.', 'error');
      if (firstInvalidField) {
        firstInvalidField.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      clearMessage();
    }

    return isStepValid;
  }

  form.querySelectorAll('[required]').forEach((field) => {
    field.addEventListener('input', () => {
      if (field.value.trim()) field.closest('.form-group').classList.remove('error');
    });
    field.addEventListener('change', () => {
      if (field.value) field.closest('.form-group').classList.remove('error');
    });
  });

  // --- СЪОБЩЕНИЯ ---
  function renderMessage() {
    const combinedMessage = cacheNotice
      ? currentMessage
        ? `${currentMessage} ${cacheNotice}`
        : cacheNotice
      : currentMessage;

    messageContent.textContent = combinedMessage;

    if (combinedMessage) {
      messageContent.className = 'message-content active';
      messageBox.className = currentMessage ? `${currentMessageType}-box` : 'info-box';
    } else {
      messageContent.className = 'message-content';
      messageBox.className = '';
    }
  }

  function showMessage(message, type = 'info') {
    currentMessage = message;
    currentMessageType = type;
    renderMessage();
  }

  function clearMessage() {
    currentMessage = '';
    currentMessageType = 'info';
    cacheNotice = '';
    renderMessage();
  }

  function setCacheNotice(notice = '') {
    cacheNotice = notice;
    renderMessage();
  }

  // --- КАЧВАНЕ НА ФАЙЛОВЕ ---
  form.querySelectorAll('input[type="file"]').forEach((input) => {
    const preview = document.getElementById(input.id.replace('-upload', '-preview'));
    if (!preview) return;

    preview.addEventListener('click', () => input.click());

    input.addEventListener('change', function() {
      const file = this.files[0];
      const parentGroup = this.closest('.form-group');
      parentGroup.classList.remove('error');

      if (!file) return;

      if (!file.type.startsWith('image/')) {
        this.value = '';
        showMessage('Моля, качете изображение.', 'error');
        parentGroup.classList.add('error');
        return;
      }

      if (file.size > MAX_IMAGE_BYTES) {
        this.value = '';
        showMessage(`Файлът трябва да е до ${MAX_IMAGE_BYTES / 1024 / 1024}MB.`, 'error');
        parentGroup.classList.add('error');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        preview.querySelector('i').style.display = 'none';
        preview.querySelector('p').style.display = 'none';
        preview.style.backgroundImage = `url(${e.target.result})`;
        preview.style.borderStyle = 'solid';
      };
      reader.readAsDataURL(file);
    });
  });

  // --- ИЗПРАЩАНЕ НА ФОРМАТА ---
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!validateCurrentStep()) return;

    const submitBtn = this.querySelector('.submit-btn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Анализиране...';

    clearMessage();
    progressBarContainer.style.display = 'block';
    progressBar.style.width = '0%';

    const progressSteps = [
      { percent: 25, message: 'Оптимизираме вашите изображения...' },
      { percent: 50, message: 'Изпращаме данните за визуален анализ...' },
      { percent: 75, message: 'AI извършва холистичен синтез...' },
      { percent: 95, message: 'Генерираме вашия персонален доклад...' }
    ];
    let stepIndex = 0;
    const progressInterval = setInterval(() => {
      if (stepIndex < progressSteps.length) {
        const step = progressSteps[stepIndex++];
        progressBar.style.width = `${step.percent}%`;
        showMessage(step.message, 'info');
      } else {
        clearInterval(progressInterval);
      }
    }, 2000);

    try {
      const formData = new FormData(form);

      const leftInput = document.getElementById('left-eye-upload');
      const rightInput = document.getElementById('right-eye-upload');
      const [leftOptimized, rightOptimized] = await Promise.all([
        leftInput.files[0] ? optimizeImage(leftInput.files[0]) : null,
        rightInput.files[0] ? optimizeImage(rightInput.files[0]) : null
      ]);
      if (leftOptimized) formData.set('left-eye-upload', leftOptimized, leftOptimized.name);
      if (rightOptimized) formData.set('right-eye-upload', rightOptimized, rightOptimized.name);

      // ===================================================================
      // ▼▼▼ НОВО: Запазваме данните за бутона "Повтори анализа" ▼▼▼
      // ===================================================================
      const cacheState = await saveFormDataForReanalysis(formData);
      if (cacheState?.cacheDisabled) {
        const reason =
          cacheState.reason === 'quota'
            ? ' (ограничение на мястото за съхранение).'
            : ' (файловете са твърде големи за кеширане).';
        setCacheNotice(`⚠ Повторният анализ няма да бъде наличен за тази сесия${reason}`);
      } else {
        setCacheNotice('');
      }
      // ===================================================================

      const response = await fetch(WORKER_URL, { method: 'POST', body: formData });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: `Грешка ${response.status}` }));
        throw new Error(errData.error);
      }
      const data = await response.json();

      clearInterval(progressInterval);
      progressBar.style.width = '100%';
      showMessage('Успех! Пренасочваме ви към доклада...', 'success');
      localStorage.setItem('iridologyReport', JSON.stringify(data));
      setTimeout(() => (window.location.href = 'report.html'), 1500);
    } catch (error) {
      clearInterval(progressInterval);
      progressBarContainer.style.display = 'none';
      showMessage('Възникна грешка: ' + error.message, 'error');
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Изпрати за анализ <i class="fas fa-paper-plane"></i>';
    }
  });

  async function optimizeImage(file, maxSize = 1024) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('Оптимизацията е неуспешна.'));
          const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.png'), { type: 'image/png' });
          resolve(newFile);
        }, 'image/png');
      };
    });
  }

  // ===================================================================
  // ▼▼▼ НОВА ФУНКЦИЯ: Запазва данните в localStorage ▼▼▼
  // ===================================================================
  async function saveFormDataForReanalysis(formData) {
    const dataToStore = {};
    const binaryEntries = [];
    const encoder = new TextEncoder();
    const MAX_CACHE_BYTES = 4 * 1024 * 1024;
    let totalSize = 0;
    let skippedBinary = false;

    const readFileAsDataURL = (file) => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    };

    const countSize = (key, value) => encoder.encode(`${key}:${value}`).length;

    for (const [key, value] of formData.entries()) {
      if ((value instanceof File || value instanceof Blob) && value.size > 0) {
        binaryEntries.push({ key, value });
      } else {
        const stringValue = typeof value === 'string' ? value : String(value);
        dataToStore[key] = stringValue;
        totalSize += countSize(key, stringValue);
      }
    }

    for (const entry of binaryEntries) {
      try {
        const dataUrl = await readFileAsDataURL(entry.value);
        const entrySize = countSize(entry.key, dataUrl);
        if (totalSize + entrySize > MAX_CACHE_BYTES) {
          dataToStore[entry.key] = `[пропуснато изображение: ${entry.value.name || 'файл'}]`;
          skippedBinary = true;
          continue;
        }

        dataToStore[entry.key] = dataUrl;
        totalSize += entrySize;
      } catch (error) {
        console.warn('Неуспешно четене на файл за кеширане на повторен анализ.', error);
        dataToStore[entry.key] = `[пропуснато изображение: ${entry.value.name || 'файл'}]`;
        skippedBinary = true;
      }
    }

    const serializedData = JSON.stringify(dataToStore);
    if (encoder.encode(serializedData).length > MAX_CACHE_BYTES) {
      console.warn('Данните за повторен анализ надвишават допустимия лимит и няма да бъдат кеширани.');
      return { cacheDisabled: true, reason: 'sizeLimit' };
    }

    try {
      localStorage.setItem('iridologyFormData', serializedData);
      return skippedBinary ? { cacheDisabled: true, reason: 'sizeLimit' } : { cacheDisabled: false };
    } catch (error) {
      if (error && (error.name === 'QuotaExceededError' || error.code === 22)) {
        console.warn('Недостатъчно място в localStorage за кеширане на повторен анализ.', error);
        return { cacheDisabled: true, reason: 'quota' };
      }
      throw error;
    }
  }
});
