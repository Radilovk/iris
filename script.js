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
        
        // Показваме бутона за преглед с overlay
        const eyeSide = input.id.includes('left') ? 'left' : 'right';
        const previewBtn = parentGroup.querySelector('.btn-preview-overlay');
        if (previewBtn) {
          previewBtn.style.display = 'flex';
        }
      };
      reader.readAsDataURL(file);
    });
  });

  // --- IRIS OVERLAY MODAL FUNCTIONALITY ---
  const overlayModal = document.getElementById('overlay-modal');
  const closeModalBtn = document.getElementById('close-overlay-modal');
  const overlayModalImage = document.getElementById('overlay-modal-image');
  const overlayViewport = document.getElementById('overlay-viewport');
  const overlaySvgContainer = document.getElementById('overlay-svg-container');
  const toggleOverlayBtn = document.getElementById('toggle-overlay');
  const resetPositionBtn = document.getElementById('reset-position');
  const overlayModalTitle = document.getElementById('overlay-modal-title');

  let currentEye = null;
  let overlayState = {
    scale: 1,
    tx: 0,
    ty: 0,
    pointers: new Map(),
    startDist: 0,
    startScale: 1,
    startMid: { x: 0, y: 0 },
    startTx: 0,
    startTy: 0,
    last: null
  };

  function applyOverlayTransform() {
    overlayModalImage.style.transform = `translate(${overlayState.tx}px, ${overlayState.ty}px) scale(${overlayState.scale})`;
  }

  function resetOverlayPosition() {
    overlayState.scale = 1;
    overlayState.tx = 0;
    overlayState.ty = 0;
    applyOverlayTransform();
  }

  // Event listeners for preview overlay buttons
  document.querySelectorAll('.btn-preview-overlay').forEach(btn => {
    btn.addEventListener('click', function() {
      const eyeSide = this.getAttribute('data-eye');
      const input = document.getElementById(`${eyeSide}-eye-upload`);
      const file = input.files[0];
      
      if (!file) return;

      currentEye = eyeSide;
      overlayModalTitle.textContent = `${eyeSide === 'left' ? 'Ляво' : 'Дясно'} око - Топографски преглед`;

      const reader = new FileReader();
      reader.onload = (e) => {
        overlayModalImage.src = e.target.result;
        overlayModalImage.style.display = 'block';
        overlayModalImage.onload = () => {
          // Центрираме изображението
          const imgW = overlayModalImage.naturalWidth;
          const imgH = overlayModalImage.naturalHeight;
          overlayModalImage.style.transform = `translate(-50%, -50%)`;
          resetOverlayPosition();
        };
        
        // Създаваме SVG overlay
        createOverlaySvg();
        
        // Показваме модала
        overlayModal.style.display = 'flex';
      };
      reader.readAsDataURL(file);
    });
  });

  function createOverlaySvg() {
    // Изчистваме предишния SVG
    overlaySvgContainer.innerHTML = '';
    
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '-400 -400 800 800');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    
    svg.innerHTML = `
      <defs>
        <filter id="outerGlow"><feGaussianBlur stdDeviation="6" result="blur"/></filter>
        <filter id="centerGlow"><feGaussianBlur stdDeviation="4" result="blur"/></filter>
        <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:var(--accent)" />
          <stop offset="50%" style="stop-color:var(--primary)" />
          <stop offset="100%" style="stop-color:var(--accent)" />
        </linearGradient>
        <pattern id="hexPattern" width="30" height="26" patternUnits="userSpaceOnUse" patternTransform="scale(1.5)">
          <path d="M15 0 L30 7.5 L30 22.5 L15 30 L0 22.5 L0 7.5 Z" fill="none" stroke="var(--primary)" stroke-width="1.2"/>
        </pattern>
      </defs>
      <g id="hud-elements">
        <circle r="335" fill="url(#hexPattern)" opacity="0.1"/>
        <circle r="120" stroke="var(--primary)" stroke-width="1" stroke-opacity="0.4" fill="none" stroke-dasharray="5, 8"/>
        <circle r="200" stroke="var(--primary)" stroke-width="1.5" stroke-opacity="0.5" fill="none"/>
        <circle r="260" stroke="var(--primary)" stroke-width="1" stroke-opacity="0.4" fill="none" stroke-dasharray="80, 10"/>
        <circle r="320" stroke="var(--primary)" stroke-width="2.5" stroke-opacity="0.8" fill="none"/>
        <g stroke="var(--primary)" stroke-width="1.5" stroke-opacity="0.4">
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(0)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(30)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(60)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(90)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(120)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(150)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(180)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(210)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(240)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(270)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(300)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(330)"/>
        </g>
        <g fill="var(--accent)" stroke="var(--accent)" stroke-width="1.5" opacity="0.8">
          <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(0)"/>
          <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(60)"/>
          <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(120)"/>
          <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(180)"/>
          <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(240)"/>
          <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(300)"/>
        </g>
        <circle r="350" stroke="url(#ringGradient)" stroke-width="4" fill="none" filter="url(#outerGlow)"/>
        <g>
          <circle r="10" fill="var(--accent)" filter="url(#centerGlow)"/>
          <circle r="25" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.6"/>
          <circle r="35" stroke="var(--primary)" stroke-width="1" stroke-opacity="0.5" fill="none" stroke-dasharray="5, 8"/>
          <g stroke="var(--primary)" stroke-width="0.8" stroke-opacity="0.3">
            <line x1="-50" y1="0" x2="50" y2="0"/>
            <line x1="0" y1="-50" x2="0" y2="50"/>
          </g>
        </g>
        <g stroke="var(--success)" stroke-width="2.5" fill="none" opacity="0.7">
          <path d="M -250 -350 L -300 -350 L -300 -300" />
          <path d="M  250 -350 L  300 -350 L  300 -300" />
          <path d="M -250  350 L -300  350 L -300  300" />
          <path d="M  250  350 L  300  350 L  300  300" />
        </g>
        <g font-family="'Lucida Console', 'Courier New', monospace" font-weight="700" fill="var(--primary)" text-anchor="middle">
          <text x="0" y="-285" font-size="16">SCAN ACTIVE</text>
          <text x="230" y="-230" font-size="24" fill="var(--success)">OK</text>
        </g>
      </g>
    `;
    
    overlaySvgContainer.appendChild(svg);
  }

  // Close modal
  closeModalBtn.addEventListener('click', () => {
    overlayModal.style.display = 'none';
    overlayModalImage.src = '';
    overlayModalImage.style.display = 'none';
  });

  // Toggle overlay visibility
  toggleOverlayBtn.addEventListener('click', () => {
    overlaySvgContainer.classList.toggle('hidden');
  });

  // Reset position
  resetPositionBtn.addEventListener('click', () => {
    resetOverlayPosition();
  });

  // Pointer events for pan/pinch-zoom in modal
  overlayViewport.addEventListener('pointerdown', (e) => {
    if (overlayModalImage.style.display === 'none') return;
    overlayViewport.setPointerCapture(e.pointerId);
    overlayState.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    
    if (overlayState.pointers.size === 1) {
      const p = overlayState.pointers.values().next().value;
      overlayState.last = { x: p.x, y: p.y };
    }
    if (overlayState.pointers.size === 2) {
      const pts = Array.from(overlayState.pointers.values());
      overlayState.startDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      overlayState.startScale = overlayState.scale;
      overlayState.startMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      overlayState.startTx = overlayState.tx;
      overlayState.startTy = overlayState.ty;
    }
  });

  overlayViewport.addEventListener('pointermove', (e) => {
    if (!overlayState.pointers.has(e.pointerId)) return;
    overlayState.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    
    if (overlayState.pointers.size === 1) {
      const p = overlayState.pointers.values().next().value;
      if (!overlayState.last) overlayState.last = { x: p.x, y: p.y };
      const dx = p.x - overlayState.last.x;
      const dy = p.y - overlayState.last.y;
      overlayState.tx += dx;
      overlayState.ty += dy;
      overlayState.last = { x: p.x, y: p.y };
      applyOverlayTransform();
    } else if (overlayState.pointers.size === 2) {
      const pts = Array.from(overlayState.pointers.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (overlayState.startDist > 0) {
        const k = dist / overlayState.startDist;
        overlayState.scale = Math.min(5, Math.max(0.3, overlayState.startScale * k));
        
        const currentMid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        const newTx = overlayState.startTx + (currentMid.x - overlayState.startMid.x);
        const newTy = overlayState.startTy + (currentMid.y - overlayState.startMid.y);
        overlayState.tx = newTx;
        overlayState.ty = newTy;
        
        applyOverlayTransform();
      }
    }
  });

  function endPointer(e) {
    if (overlayViewport.hasPointerCapture(e.pointerId)) overlayViewport.releasePointerCapture(e.pointerId);
    overlayState.pointers.delete(e.pointerId);
    if (overlayState.pointers.size < 2) overlayState.startDist = 0;
    if (overlayState.pointers.size === 0) overlayState.last = null;
    else if (overlayState.pointers.size === 1) {
      const p = overlayState.pointers.values().next().value;
      overlayState.last = { x: p.x, y: p.y };
    }
  }

  overlayViewport.addEventListener('pointerup', endPointer);
  overlayViewport.addEventListener('pointercancel', endPointer);
  overlayViewport.addEventListener('pointerleave', (e) => {
    if (overlayState.pointers.has(e.pointerId)) endPointer(e);
  });

  // Close modal when clicking outside
  overlayModal.addEventListener('click', (e) => {
    if (e.target === overlayModal) {
      overlayModal.style.display = 'none';
      overlayModalImage.src = '';
      overlayModalImage.style.display = 'none';
    }
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

      // Генерираме composite изображения с overlay за report
      await generateAndSaveCompositeImages(leftInput, rightInput);

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

  // Генериране на composite изображения с overlay
  async function generateAndSaveCompositeImages(leftInput, rightInput) {
    try {
      // Функция за генериране на composite image
      const generateComposite = async (file) => {
        if (!file) return null;
        
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = async () => {
            try {
              const canvas = document.createElement('canvas');
              const size = 800;
              canvas.width = size;
              canvas.height = size;
              const ctx = canvas.getContext('2d');

              // Background
              ctx.fillStyle = '#e0e2e5';
              ctx.fillRect(0, 0, size, size);

              // Draw image centered
              const scale = Math.min(size / img.width, size / img.height) * 1.5;
              const x = (size - img.width * scale) / 2;
              const y = (size - img.height * scale) / 2;
              ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

              // Create SVG overlay
              const svgString = createOverlaySvgString();
              const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
              const svgUrl = URL.createObjectURL(svgBlob);

              const svgImage = new Image();
              svgImage.onload = () => {
                ctx.drawImage(svgImage, 0, 0, size, size);
                URL.revokeObjectURL(svgUrl);
                
                // Convert to data URL
                const dataUrl = canvas.toDataURL('image/png');
                resolve(dataUrl);
              };
              svgImage.onerror = () => {
                URL.revokeObjectURL(svgUrl);
                reject(new Error('Failed to load SVG'));
              };
              svgImage.src = svgUrl;
            } catch (error) {
              reject(error);
            }
          };
          img.onerror = reject;
          img.src = URL.createObjectURL(file);
        });
      };

      // Generate and save both images
      if (leftInput.files[0]) {
        const leftComposite = await generateComposite(leftInput.files[0]);
        if (leftComposite) {
          localStorage.setItem('left-eye-with-overlay', leftComposite);
        }
      }

      if (rightInput.files[0]) {
        const rightComposite = await generateComposite(rightInput.files[0]);
        if (rightComposite) {
          localStorage.setItem('right-eye-with-overlay', rightComposite);
        }
      }
    } catch (error) {
      console.error('Error generating composite images:', error);
      // Don't fail the submission if composite generation fails
    }
  }

  // Helper function to create SVG string
  function createOverlaySvgString() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-400 -400 800 800" width="800" height="800">
      <defs>
        <filter id="outerGlow"><feGaussianBlur stdDeviation="6"/></filter>
        <filter id="centerGlow"><feGaussianBlur stdDeviation="4"/></filter>
        <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#ff00cc" />
          <stop offset="50%" style="stop-color:#00f0ff" />
          <stop offset="100%" style="stop-color:#ff00cc" />
        </linearGradient>
        <pattern id="hexPattern" width="30" height="26" patternUnits="userSpaceOnUse" patternTransform="scale(1.5)">
          <path d="M15 0 L30 7.5 L30 22.5 L15 30 L0 22.5 L0 7.5 Z" fill="none" stroke="#00f0ff" stroke-width="1.2"/>
        </pattern>
      </defs>
      <g>
        <circle r="335" fill="url(#hexPattern)" opacity="0.1"/>
        <circle r="120" stroke="#00f0ff" stroke-width="1" stroke-opacity="0.4" fill="none" stroke-dasharray="5, 8"/>
        <circle r="200" stroke="#00f0ff" stroke-width="1.5" stroke-opacity="0.5" fill="none"/>
        <circle r="260" stroke="#00f0ff" stroke-width="1" stroke-opacity="0.4" fill="none" stroke-dasharray="80, 10"/>
        <circle r="320" stroke="#00f0ff" stroke-width="2.5" stroke-opacity="0.8" fill="none"/>
        <g stroke="#00f0ff" stroke-width="1.5" stroke-opacity="0.4">
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(0)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(30)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(60)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(90)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(120)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(150)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(180)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(210)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(240)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(270)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(300)"/>
          <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(330)"/>
        </g>
        <g fill="#ff00cc" stroke="#ff00cc" stroke-width="1.5" opacity="0.8">
          <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(0)"/>
          <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(60)"/>
          <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(120)"/>
          <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(180)"/>
          <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(240)"/>
          <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(300)"/>
        </g>
        <circle r="350" stroke="url(#ringGradient)" stroke-width="4" fill="none" filter="url(#outerGlow)"/>
        <g>
          <circle r="10" fill="#ff00cc" filter="url(#centerGlow)"/>
          <circle r="25" fill="none" stroke="#ff00cc" stroke-width="1.5" opacity="0.6"/>
          <circle r="35" stroke="#00f0ff" stroke-width="1" stroke-opacity="0.5" fill="none" stroke-dasharray="5, 8"/>
          <g stroke="#00f0ff" stroke-width="0.8" stroke-opacity="0.3">
            <line x1="-50" y1="0" x2="50" y2="0"/>
            <line x1="0" y1="-50" x2="0" y2="50"/>
          </g>
        </g>
        <g stroke="#00ff8c" stroke-width="2.5" fill="none" opacity="0.7">
          <path d="M -250 -350 L -300 -350 L -300 -300" />
          <path d="M  250 -350 L  300 -350 L  300 -300" />
          <path d="M -250  350 L -300  350 L -300  300" />
          <path d="M  250  350 L  300  350 L  300  300" />
        </g>
        <g font-family="'Lucida Console', 'Courier New', monospace" font-weight="700" fill="#00f0ff" text-anchor="middle">
          <text x="0" y="-285" font-size="16">ANALYSIS</text>
          <text x="230" y="-230" font-size="24" fill="#00ff8c">OK</text>
        </g>
      </g>
    </svg>`;
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
