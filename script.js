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
        // Special validation for step 3 - check if images are centered
        if (currentStep === 3 && field.files.length > 0) {
          const eyeSide = field.id.includes('left') ? 'left' : 'right';
          if (!overlayStates[eyeSide].centered) {
            isFieldValid = false;
            showMessage(
              `Моля, центрирайте ${eyeSide === 'left' ? 'лявото' : 'дясното'} око преди да продължите.`,
              'error'
            );
          }
        }
      } else {
        if (!field.value.trim()) isFieldValid = false;
      }

      if (!isFieldValid) {
        isStepValid = false;
        parentGroup.classList.add('error');
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

  // --- КАЧВАНЕ НА ФАЙЛОВЕ ---
  const overlayStates = {
    left: { scale: 1, tx: 0, ty: 0, pointers: new Map(), file: null, centered: false },
    right: { scale: 1, tx: 0, ty: 0, pointers: new Map(), file: null, centered: false }
  };

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

      // Determine which eye (left or right)
      const eyeSide = this.id.includes('left') ? 'left' : 'right';

      // Store the original file
      overlayStates[eyeSide].file = file;
      overlayStates[eyeSide].centered = false;

      // Show preview
      const reader = new FileReader();
      reader.onload = (e) => {
        preview.querySelector('i').style.display = 'none';
        preview.querySelector('p').style.display = 'none';
        preview.style.backgroundImage = `url(${e.target.result})`;
        preview.style.borderStyle = 'solid';

        // Show overlay tool
        showOverlayTool(eyeSide, e.target.result);
      };
      reader.onerror = (error) => {
        console.error('Грешка при четене на файл:', error);
        showMessage('Грешка при зареждане на изображението. Моля, опитайте отново.', 'error');
        parentGroup.classList.add('error');
        this.value = '';
      };
      reader.readAsDataURL(file);
    });
  });

  // --- OVERLAY TOOL FUNCTIONALITY ---
  function showOverlayTool(eyeSide, imageDataUrl) {
    const container = document.getElementById(`${eyeSide}-eye-container`);
    const img = document.getElementById(`${eyeSide}-eye-photo`);

    container.style.display = 'block';
    img.onload = () => {
      img.style.display = 'block';
      resetOverlay(eyeSide);
    };
    img.onerror = () => {
      console.error('Грешка при зареждане на изображението в overlay tool');
      showMessage('Грешка при зареждане на изображението. Моля, опитайте отново.', 'error');
      container.style.display = 'none';
    };
    img.src = imageDataUrl;

    // Scroll to the overlay tool
    container.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetOverlay(eyeSide) {
    const state = overlayStates[eyeSide];
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    state.pointers.clear();
    applyTransform(eyeSide);
  }

  function applyTransform(eyeSide) {
    const img = document.getElementById(`${eyeSide}-eye-photo`);
    const state = overlayStates[eyeSide];
    img.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
  }

  // Setup pointer events for both overlays
  ['left', 'right'].forEach((eyeSide) => {
    const container = document.getElementById(`${eyeSide}-eye-container`);
    if (!container) return;

    const stageWrap = container.querySelector('.stage-wrap');
    const img = document.getElementById(`${eyeSide}-eye-photo`);
    const state = overlayStates[eyeSide];

    // Reset button
    const resetBtn = container.querySelector('.reset-btn');
    resetBtn.addEventListener('click', () => resetOverlay(eyeSide));

    // Capture button
    const captureBtn = container.querySelector('.capture-btn');
    captureBtn.addEventListener('click', () => captureImage(eyeSide));

    // Pointer events for pan and pinch-zoom - attach to stageWrap
    stageWrap.addEventListener('pointerdown', (e) => {
      if (img.style.display === 'none') return;
      stageWrap.setPointerCapture(e.pointerId);
      state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (state.pointers.size === 1) {
        const p = state.pointers.values().next().value;
        state.last = { x: p.x, y: p.y };
      }
      if (state.pointers.size === 2) {
        const pts = Array.from(state.pointers.values());
        state.startDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        state.startScale = state.scale;
        state.startMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        state.startTx = state.tx;
        state.startTy = state.ty;
      }
    });

    stageWrap.addEventListener('pointermove', (e) => {
      if (!state.pointers.has(e.pointerId)) return;
      state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (state.pointers.size === 1) {
        // Pan with one finger
        const p = state.pointers.values().next().value;
        if (!state.last) state.last = { x: p.x, y: p.y };
        const dx = p.x - state.last.x;
        const dy = p.y - state.last.y;
        state.tx += dx;
        state.ty += dy;
        state.last = { x: p.x, y: p.y };
        applyTransform(eyeSide);
      } else if (state.pointers.size === 2) {
        // Pinch zoom with two fingers
        const pts = Array.from(state.pointers.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        if (state.startDist > 0) {
          const k = dist / state.startDist;
          state.scale = Math.min(5, Math.max(0.3, state.startScale * k));
          const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          state.tx = state.startTx + (mid.x - state.startMid.x);
          state.ty = state.startTy + (mid.y - state.startMid.y);
          applyTransform(eyeSide);
        }
      }
    });

    function endPointer(e) {
      if (stageWrap.hasPointerCapture(e.pointerId)) stageWrap.releasePointerCapture(e.pointerId);
      state.pointers.delete(e.pointerId);
      if (state.pointers.size < 2) state.startDist = 0;
      if (state.pointers.size === 0) state.last = null;
      // If one finger remains, reset its 'last' position to prevent jumps
      else if (state.pointers.size === 1) {
        const p = state.pointers.values().next().value;
        state.last = { x: p.x, y: p.y };
      }
    }

    stageWrap.addEventListener('pointerup', endPointer);
    stageWrap.addEventListener('pointercancel', endPointer);
    stageWrap.addEventListener('pointerleave', (e) => {
      if (state.pointers.has(e.pointerId)) endPointer(e);
    });
  });

  // Capture the centered image from the overlay
  async function captureImage(eyeSide) {
    const state = overlayStates[eyeSide];
    const img = document.getElementById(`${eyeSide}-eye-photo`);
    const container = document.getElementById(`${eyeSide}-eye-container`);
    const stageWrap = container.querySelector('.stage-wrap');

    // Create a canvas with the overlay size
    const canvas = document.createElement('canvas');
    const overlaySize = 800; // Match the SVG viewBox size
    canvas.width = overlaySize;
    canvas.height = overlaySize;
    const ctx = canvas.getContext('2d');

    // No background fill - canvas starts transparent
    // This creates a clean PNG with alpha channel

    // Calculate the visible area dimensions
    const rect = stageWrap.getBoundingClientRect();
    const canvasSize = Math.min(rect.width, rect.height);

    // Calculate scaling factor
    const scaleFactor = overlaySize / canvasSize;

    // Apply transformations
    ctx.save();
    ctx.translate(overlaySize / 2, overlaySize / 2);
    ctx.scale(state.scale * scaleFactor, state.scale * scaleFactor);
    ctx.translate(state.tx / state.scale, state.ty / state.scale);

    // Calculate image position to center it
    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;
    ctx.drawImage(img, -imgWidth / 2, -imgHeight / 2, imgWidth, imgHeight);
    ctx.restore();

    // Apply circular mask to match the overlay
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    ctx.arc(overlaySize / 2, overlaySize / 2, overlaySize * 0.45, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // Convert canvas to blob
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            console.error('Грешка: canvas.toBlob върна null');
            showMessage('Грешка при обработка на изображението. Моля, опитайте отново.', 'error');
            reject(new Error('Failed to create blob from canvas'));
            return;
          }

          const fileName = state.file.name.replace(/\.[^/.]+$/, '_centered.png');
          const centeredFile = new File([blob], fileName, { type: 'image/png' });

          // Update the file input
          const fileInput = document.getElementById(`${eyeSide}-eye-upload`);
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(centeredFile);
          fileInput.files = dataTransfer.files;

          // Mark as centered
          state.centered = true;
          state.centeredFile = centeredFile;
          state.centeredCanvas = canvas;

          // Hide overlay tool
          container.style.display = 'none';

          // Update preview with centered image
          const preview = document.getElementById(`${eyeSide}-eye-preview`);
          preview.style.backgroundImage = `url(${canvas.toDataURL()})`;

          // Update side-by-side preview
          updateSideBySidePreview();

          showMessage(`${eyeSide === 'left' ? 'Ляво' : 'Дясно'} око центрирано успешно!`, 'success');
          setTimeout(() => clearMessage(), 2000);

          resolve(centeredFile);
        },
        'image/png',
        0.95
      );
    });
  }

  // Update the side-by-side preview when both eyes are centered
  function updateSideBySidePreview() {
    const leftCentered = overlayStates.left.centered;
    const rightCentered = overlayStates.right.centered;

    if (leftCentered || rightCentered) {
      const previewContainer = document.getElementById('centered-preview-container');
      if (!previewContainer) {
        console.error('Preview container not found');
        return;
      }
      previewContainer.style.display = 'block';

      // Update left eye preview
      if (leftCentered && overlayStates.left.centeredCanvas) {
        const leftCanvas = document.getElementById('left-eye-centered-canvas');
        if (leftCanvas) {
          const leftCtx = leftCanvas.getContext('2d');
          leftCanvas.width = overlayStates.left.centeredCanvas.width;
          leftCanvas.height = overlayStates.left.centeredCanvas.height;
          leftCtx.drawImage(overlayStates.left.centeredCanvas, 0, 0);
        } else {
          console.warn('Left eye canvas element not found in preview');
        }
      }

      // Update right eye preview
      if (rightCentered && overlayStates.right.centeredCanvas) {
        const rightCanvas = document.getElementById('right-eye-centered-canvas');
        if (rightCanvas) {
          const rightCtx = rightCanvas.getContext('2d');
          rightCanvas.width = overlayStates.right.centeredCanvas.width;
          rightCanvas.height = overlayStates.right.centeredCanvas.height;
          rightCtx.drawImage(overlayStates.right.centeredCanvas, 0, 0);
        } else {
          console.warn('Right eye canvas element not found in preview');
        }
      }

      // Scroll to preview
      previewContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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
      { percent: 25, message: 'Подготвяме вашите центрирани изображения...' },
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

      // Use the centered images directly (no need for optimizeImage since they're already processed)
      // The centered files are already in the file inputs from captureImage function
      // No need to optimize or resize - images are already centered by the user

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
