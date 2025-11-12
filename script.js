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

  // --- POSITIONING INTERFACE ---
  let currentEye = 'left';
  const images = {
    left: { file: null, transform: { x: 0, y: 0, scale: 1 }, imageData: null },
    right: { file: null, transform: { x: 0, y: 0, scale: 1 }, imageData: null }
  };

  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastTouchDistance = 0;

  // Elements for positioning
  const imageInput = document.getElementById('imageInput');
  const previewContainer = document.getElementById('previewContainer');
  const canvas = document.getElementById('imageCanvas');
  const ctx = canvas ? canvas.getContext('2d') : null;
  const canvasContainer = document.getElementById('canvasContainer');
  const zoomIndicator = document.getElementById('zoomIndicator');
  const irisOverlay = document.getElementById('irisOverlay');

  // Eye selector buttons
  const eyeButtons = document.querySelectorAll('.eye-button');
  eyeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      eyeButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentEye = btn.dataset.eye;
      loadCurrentEyeImage();
    });
  });

  // File input handling
  if (imageInput) {
    imageInput.addEventListener('change', handleImageSelect);

    // Drag and drop
    const fileInputLabel = document.querySelector('.file-input-label');
    if (fileInputLabel) {
      fileInputLabel.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileInputLabel.style.borderColor = 'var(--primary-color)';
      });

      fileInputLabel.addEventListener('dragleave', () => {
        fileInputLabel.style.borderColor = 'var(--border-color)';
      });

      fileInputLabel.addEventListener('drop', (e) => {
        e.preventDefault();
        fileInputLabel.style.borderColor = 'var(--border-color)';
        if (e.dataTransfer.files.length > 0) {
          handleImageSelect({ target: { files: [e.dataTransfer.files[0]] } });
        }
      });
    }
  }

  function handleImageSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showMessage('Моля, изберете изображение', 'error');
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      showMessage(`Файлът трябва да е до ${MAX_IMAGE_BYTES / 1024 / 1024}MB.`, 'error');
      return;
    }

    images[currentEye].file = file;
    images[currentEye].transform = { x: 0, y: 0, scale: 1 };

    loadImageToCanvas(file);
    if (previewContainer) previewContainer.classList.add('active');

    const eyeName = currentEye === 'left' ? 'Лявото' : 'Дясното';
    showMessage(
      `${eyeName} око е заредено успешно. Позиционирайте го в кръга.`,
      'success'
    );

    updateEyeButtonStatus();

    // Auto-switch to the other eye if this one is completed and the other isn't
    const otherEye = currentEye === 'left' ? 'right' : 'left';
    if (!images[otherEye].file) {
      setTimeout(() => {
        const otherButton = document.querySelector(`.eye-button[data-eye="${otherEye}"]`);
        if (otherButton) {
          otherButton.click();
          showMessage(`Отлично! Сега качете ${otherEye === 'left' ? 'лявото' : 'дясното'} око.`, 'info');
        }
      }, 1500);
    } else {
      // Both eyes are uploaded
      setTimeout(() => {
        showMessage('✓ И двете очи са качени! Можете да изпратите за анализ.', 'success');
      }, 1500);
    }
  }

  function updateEyeButtonStatus() {
    eyeButtons.forEach((btn) => {
      const eye = btn.dataset.eye;
      if (images[eye].file) {
        btn.classList.add('completed');
      } else {
        btn.classList.remove('completed');
      }
    });
  }

  function loadCurrentEyeImage() {
    const eyeData = images[currentEye];
    if (eyeData.file) {
      loadImageToCanvas(eyeData.file);
      if (previewContainer) previewContainer.classList.add('active');
    } else {
      if (previewContainer) previewContainer.classList.remove('active');
    }
    updateEyeButtonStatus();
  }

  function loadImageToCanvas(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        images[currentEye].imageData = img;
        initializeCanvas();
        renderCanvas();
        loadIrisOverlay();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function initializeCanvas() {
    if (!canvas || !canvasContainer) return;
    const containerRect = canvasContainer.getBoundingClientRect();
    canvas.width = containerRect.width;
    canvas.height = containerRect.height;

    const img = images[currentEye].imageData;
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
    images[currentEye].transform = {
      x: (canvas.width - img.width * scale) / 2,
      y: (canvas.height - img.height * scale) / 2,
      scale: scale
    };
  }

  function renderCanvas() {
    if (!canvas || !ctx) return;
    const eyeData = images[currentEye];
    if (!eyeData.imageData) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const img = eyeData.imageData;
    const { x, y, scale } = eyeData.transform;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    ctx.restore();

    updateZoomIndicator();
  }

  function updateZoomIndicator() {
    if (!zoomIndicator) return;
    const scale = images[currentEye].transform.scale;
    const percentage = Math.round(scale * 100);
    zoomIndicator.textContent = `Zoom: ${percentage}%`;
  }

  // Load iris overlay SVG
  function loadIrisOverlay() {
    if (!irisOverlay) return;
    fetch('irismap.svg')
      .then((response) => response.text())
      .then((svgText) => {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
        const svgElement = svgDoc.querySelector('svg');

        // Copy attributes and content
        irisOverlay.setAttribute('viewBox', svgElement.getAttribute('viewBox'));
        irisOverlay.innerHTML = svgElement.innerHTML;
      })
      .catch((err) => console.warn('Could not load iris overlay:', err));
  }

  // Mouse/touch event handlers
  if (canvas) {
    canvas.addEventListener('mousedown', startDrag);
    canvas.addEventListener('mousemove', drag);
    canvas.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', endDrag);
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    // Touch events
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', endDrag);
  }

  function startDrag(e) {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  }

  function drag(e) {
    if (!isDragging) return;
    e.preventDefault();

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;

    images[currentEye].transform.x += dx;
    images[currentEye].transform.y += dy;

    lastX = e.clientX;
    lastY = e.clientY;

    renderCanvas();
  }

  function endDrag() {
    isDragging = false;
  }

  function handleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoom(delta, e.offsetX, e.offsetY);
  }

  function handleTouchStart(e) {
    if (e.touches.length === 1) {
      isDragging = true;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      isDragging = false;
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      lastTouchDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
    }
  }

  function handleTouchMove(e) {
    e.preventDefault();

    if (e.touches.length === 1 && isDragging) {
      const dx = e.touches[0].clientX - lastX;
      const dy = e.touches[0].clientY - lastY;

      images[currentEye].transform.x += dx;
      images[currentEye].transform.y += dy;

      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;

      renderCanvas();
    } else if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const distance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );

      if (lastTouchDistance > 0) {
        const delta = distance / lastTouchDistance;
        const centerX = (touch1.clientX + touch2.clientX) / 2 - canvas.offsetLeft;
        const centerY = (touch1.clientY + touch2.clientY) / 2 - canvas.offsetTop;
        zoom(delta, centerX, centerY);
      }

      lastTouchDistance = distance;
    }
  }

  function zoom(factor, centerX, centerY) {
    const transform = images[currentEye].transform;
    const oldScale = transform.scale;
    const newScale = Math.max(0.5, Math.min(5, oldScale * factor));

    if (newScale !== oldScale) {
      const scaleFactor = newScale / oldScale;
      transform.x = centerX - (centerX - transform.x) * scaleFactor;
      transform.y = centerY - (centerY - transform.y) * scaleFactor;
      transform.scale = newScale;

      renderCanvas();
    }
  }

  // Control buttons
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const resetBtn = document.getElementById('resetBtn');

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      if (canvas) zoom(1.2, canvas.width / 2, canvas.height / 2);
    });
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      if (canvas) zoom(0.8, canvas.width / 2, canvas.height / 2);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (images[currentEye].imageData) {
        initializeCanvas();
        renderCanvas();
      }
    });
  }

  async function capturePositionedImage(eye) {
    if (!canvas) return null;
    const eyeData = images[eye];
    if (!eyeData.imageData) return null;

    const captureCanvas = document.createElement('canvas');
    const size = 800; // High resolution output
    captureCanvas.width = size;
    captureCanvas.height = size;
    const captureCtx = captureCanvas.getContext('2d');

    const img = eyeData.imageData;
    const { x, y, scale } = eyeData.transform;

    // Calculate crop area (centered circle)
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 175; // Half of 350px crop circle

    // Map the crop area to the image coordinates
    const imgCenterX = (centerX - x) / scale;
    const imgCenterY = (centerY - y) / scale;
    const imgRadius = radius / scale;

    captureCtx.clearRect(0, 0, size, size);
    captureCtx.drawImage(
      img,
      imgCenterX - imgRadius,
      imgCenterY - imgRadius,
      imgRadius * 2,
      imgRadius * 2,
      0,
      0,
      size,
      size
    );

    return captureCanvas.toDataURL('image/png');
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

    // Special validation for step 3 (image positioning)
    if (currentStep === 3) {
      // Check if both eyes have positioned images
      if (!images.left.file || !images.right.file) {
        isStepValid = false;
        showMessage('Моля, качете и позиционирайте и двете очи.', 'error');
        return false;
      }
    }

    requiredFields.forEach((field) => {
      // Skip the hidden file inputs for left/right eye upload
      if (field.id === 'left-eye-upload' || field.id === 'right-eye-upload') {
        return;
      }

      const parentGroup = field.closest('.form-group');
      if (parentGroup) parentGroup.classList.remove('error');

      let isFieldValid = true;
      if (field.type === 'file') {
        if (field.files.length === 0) isFieldValid = false;
      } else {
        if (!field.value.trim()) isFieldValid = false;
      }

      if (!isFieldValid) {
        isStepValid = false;
        if (parentGroup) parentGroup.classList.add('error');
        if (!firstInvalidField) firstInvalidField = field;
      }
    });

    if (!isStepValid && currentStep !== 3) {
      showMessage('Моля, попълнете задължителните полета.', 'error');
      if (firstInvalidField) {
        firstInvalidField.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else if (isStepValid) {
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

      // Convert positioned images to files
      const [leftDataUrl, rightDataUrl] = await Promise.all([
        capturePositionedImage('left'),
        capturePositionedImage('right')
      ]);

      if (!leftDataUrl || !rightDataUrl) {
        throw new Error('Моля, качете и позиционирайте и двете очи.');
      }

      const [leftFile, rightFile] = await Promise.all([
        dataURLtoFile(leftDataUrl, 'left-eye.png'),
        dataURLtoFile(rightDataUrl, 'right-eye.png')
      ]);

      // Optimize the captured images
      const [leftOptimized, rightOptimized] = await Promise.all([
        optimizeImage(leftFile),
        optimizeImage(rightFile)
      ]);

      formData.set('left-eye-upload', leftOptimized, leftOptimized.name);
      formData.set('right-eye-upload', rightOptimized, rightOptimized.name);

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
