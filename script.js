// --- КОРИГИРАНО: Премахваме import и дефинираме константите тук ---
const WORKER_URL = 'https://iris.radilov-k.workers.dev/'; // Поставете вашия URL тук
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('iridology-form');
    if (!form) return;

    // --- ЕЛЕМЕНТИ ---
    const formSteps = form.querySelectorAll('.form-step');
    const nextBtns = form.querySelectorAll('.next-btn');
    const prevBtns = form.querySelectorAll('.prev-btn');
    const stepperSteps = form.querySelectorAll('.step');
    
    const messageBox = document.getElementById('message-box');
    const messageContent = messageBox.querySelector('.message-content');
    const progressBarContainer = messageBox.querySelector('.progress-bar-container');
    const progressBar = messageBox.querySelector('.progress-bar');
    
    const otherCheckbox = document.getElementById('digestion-other-checkbox');
    const otherText = document.getElementById('digestion-other-text');

    // --- УПРАВЛЕНИЕ НА СТЪПКИТЕ ---
    let currentStep = 1;

    function updateStepper() {
        stepperSteps.forEach((step, index) => {
            const stepNumber = index + 1;
            step.classList.remove('active', 'completed');
            if (stepNumber === currentStep) {
                step.classList.add('active');
            } else if (stepNumber < currentStep) {
                step.classList.add('completed');
            }
        });
    }

    function showStep(stepNumber) {
        formSteps.forEach(step => step.classList.remove('active'));
        document.querySelector(`.form-step[data-step="${stepNumber}"]`).classList.add('active');
        currentStep = stepNumber;
        updateStepper();
    }

    nextBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (validateStep(currentStep) && currentStep < formSteps.length) {
                showStep(currentStep + 1);
            }
        });
    });

    prevBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (currentStep > 1) showStep(currentStep - 1);
        });
    });

    // --- ЛОГИКА ЗА ЧЕКБОКСОВЕ ---
    if (otherCheckbox && otherText) {
        otherCheckbox.addEventListener('change', () => {
            const isChecked = otherCheckbox.checked;
            otherText.style.display = isChecked ? 'block' : 'none';
            if (isChecked) {
                otherText.setAttribute('required', 'true');
            } else {
                otherText.removeAttribute('required');
                otherText.value = ''; // Изчистваме полето, ако чекбоксът се махне
                validateField(otherText); // Премахваме евентуална грешка
            }
        });
    }

    // --- СЪОБЩЕНИЯ И ВАЛИДАЦИЯ ---
    function showMessage(message, type = 'info') {
        if (!messageContent) return;
        messageContent.textContent = message;
        messageContent.className = `message-content active`;
        messageBox.className = `${type}-box`;
    }

    function clearMessage() {
         if (!messageContent) return;
         messageContent.textContent = '';
         messageContent.className = 'message-content';
         messageBox.className = '';
    }

    function validateField(field) {
        let isValid = true;
        const parent = field.closest('.form-group') || field.parentElement;
        parent.classList.remove('error');

        if (field.hasAttribute('required')) {
            if (field.type === 'file') {
                isValid = field.files.length > 0;
            } else if (field.type === 'checkbox') {
                 isValid = field.checked;
            } else {
                isValid = field.value.trim() !== '';
            }
        }
        
        if (!isValid) {
            parent.classList.add('error');
        }
        return isValid;
    }
    
    function validateStep(stepNumber) {
        clearMessage();
        const stepFields = form.querySelector(`.form-step[data-step="${stepNumber}"]`).querySelectorAll('[required]');
        let allValid = true;
        stepFields.forEach(field => {
            if (!validateField(field)) {
                allValid = false;
            }
        });
        if(!allValid) showMessage('Моля, попълнете всички задължителни полета.', 'error');
        return allValid;
    }

    form.querySelectorAll('[required]').forEach(field => {
        field.addEventListener('blur', () => validateField(field));
        field.addEventListener('change', () => validateField(field));
    });

    // --- ПРЕГЛЕД НА КАЧЕНИ ФАЙЛОВЕ ---
    function setupFileUpload(inputId, previewId) {
        const input = document.getElementById(inputId);
        const preview = document.getElementById(previewId);
        if(!input || !preview) return;

        preview.addEventListener('click', () => input.click());

        input.addEventListener('change', function() {
            validateField(this); // Валидираме веднага
            const file = this.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) return showMessage('Моля, качете изображение.', 'error');
            if (file.size > MAX_IMAGE_BYTES) return showMessage(`Файлът трябва да е до ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB.`, 'error');

            const reader = new FileReader();
            reader.onload = e => {
                preview.querySelector('i').style.display = 'none';
                preview.querySelector('p').style.display = 'none';
                preview.style.backgroundImage = `url(${e.target.result})`;
                preview.style.borderStyle = 'solid';
            }
            reader.readAsDataURL(file);
        });
    }

    setupFileUpload('left-eye-upload', 'left-eye-preview');
    setupFileUpload('right-eye-upload', 'right-eye-preview');

    // --- ИЗПРАЩАНЕ НА ФОРМАТА ---
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        if (!validateStep(1) || !validateStep(2) || !validateStep(3)) return;

        const submitBtn = this.querySelector('.submit-btn');
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Анализиране...';
        
        clearMessage();
        progressBarContainer.style.display = 'block';
        progressBar.style.width = '0%';
        
        const progressSteps = [
            { percent: 25, message: 'Компресираме вашите изображения...' },
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
        }, 2500);

        try {
            const formData = new FormData(form);
            // Актуализирана логика за чекбоксове
            const digestionValues = Array.from(form.querySelectorAll('input[name="digestion"]:checked')).map(cb => cb.value);
            formData.delete('digestion');
            if (otherCheckbox.checked && otherText.value) digestionValues.push(otherText.value);
            formData.append('digestion', JSON.stringify(digestionValues));

            // Компресия
            const leftInput = document.getElementById('left-eye-upload');
            const rightInput = document.getElementById('right-eye-upload');
            const [leftCompressed, rightCompressed] = await Promise.all([
                leftInput.files[0] ? compressImage(leftInput.files[0]) : null,
                rightInput.files[0] ? compressImage(rightInput.files[0]) : null
            ]);
            if (leftCompressed) formData.set('left-eye-upload', leftCompressed, leftCompressed.name);
            if (rightCompressed) formData.set('right-eye-upload', rightCompressed, rightCompressed.name);

            // Заявка
            const response = await fetch(WORKER_URL, { method: 'POST', body: formData });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: `Грешка ${response.status}` }));
                throw new Error(errData.error);
            }
            const data = await response.json();

            // Успех
            clearInterval(progressInterval);
            progressBar.style.width = '100%';
            showMessage('Успех! Пренасочваме ви към доклада...', 'success');
            localStorage.setItem('iridologyReport', JSON.stringify(data));
            setTimeout(() => window.location.href = 'report.html', 1500);

        } catch (error) {
            clearInterval(progressInterval);
            progressBarContainer.style.display = 'none';
            showMessage('Възникна грешка: ' + error.message, 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Изпрати за анализ <i class="fas fa-paper-plane"></i>';
        }
    });
});

// --- ПОМОЩНА ФУНКЦИЯ ЗА КОМПРЕСИЯ ---
async function compressImage(file, maxSize = 1024, quality = 0.8) {
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
            canvas.toBlob(blob => {
                if (!blob) return reject(new Error('Компресията е неуспешна.'));
                const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.webp'), { type: 'image/webp' });
                resolve(newFile);
            }, 'image/webp', quality);
        };
    });
}
