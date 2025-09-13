// --- КОНФИГУРАЦИЯ ---
const WORKER_URL = 'https://iris.radilov-k.workers.dev/'; // URL на вашия Cloudflare Worker
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB - Лимит за оригиналния файл

document.addEventListener('DOMContentLoaded', function() {
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

    // --- ОСНОВНА ЛОГИКА ЗА НАВИГАЦИЯ ---
    function showStep(stepNumber) {
        currentStep = stepNumber;
        formSteps.forEach(step => step.classList.remove('active'));
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

    nextBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (validateCurrentStep() && currentStep < formSteps.length) {
                showStep(currentStep + 1);
            }
        });
    });

    prevBtns.forEach(btn => {
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

        requiredFields.forEach(field => {
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

    form.querySelectorAll('[required]').forEach(field => {
        field.addEventListener('input', () => { if (field.value.trim()) field.closest('.form-group').classList.remove('error'); });
        field.addEventListener('change', () => { if (field.value) field.closest('.form-group').classList.remove('error'); });
    });

    // --- СЪОБЩЕНИЯ ---
    function showMessage(message, type = 'info') {
        messageContent.textContent = message;
        messageContent.className = 'message-content active';
        messageBox.className = `${type}-box`;
    }

    function clearMessage() {
        messageContent.textContent = '';
        messageContent.className = 'message-content';
        messageBox.className = '';
    }

    // --- КАЧВАНЕ НА ФАЙЛОВЕ ---
    form.querySelectorAll('input[type="file"]').forEach(input => {
        const preview = document.getElementById(input.id.replace('-upload', '-preview'));
        if (!preview) return;

        preview.addEventListener('click', () => input.click());

        input.addEventListener('change', function() {
            const file = this.files[0];
            const parentGroup = this.closest('.form-group');
            parentGroup.classList.remove('error'); // Изчистваме грешката при нов избор

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
            reader.onload = e => {
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

            // *** НАЙ-ВАЖНАТА ПРОМЯНА ЗАПОЧВА ТУК ***
            // Тази функция запазва данните от формуляра, за да може "Повтори анализа" да работи.
            await saveFormDataForReanalysis(formData);
            // *** КРАЙ НА ПРОМЯНАТА ***

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
            setTimeout(() => window.location.href = 'report.html', 1500);

        } catch (error) {
            clearInterval(progressInterval);
            progressBarContainer.style.display = 'none';
            showMessage('Възникна грешка: ' + error.message, 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Изпрати за анализ <i class="fas fa-paper-plane"></i>';
        }
    });

    /**
     * *** НОВА ФУНКЦИЯ ***
     * Преобразува FormData в JSON-съвместим обект, включително файловете като base64 низове,
     * и го запазва в localStorage.
     * @param {FormData} formData - Обектът с данни от формуляра.
     */
    async function saveFormDataForReanalysis(formData) {
        const object = {};
        const filePromises = [];

        formData.forEach((value, key) => {
            if (value instanceof File) {
                // За файлове, създаваме Promise, който ще ги прочете като base64
                const readerPromise = new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve({ key, value: reader.result });
                    reader.readAsDataURL(value);
                });
                filePromises.push(readerPromise);
            } else {
                // За текстови полета, директно ги добавяме
                object[key] = value;
            }
        });

        // Изчакваме всички файлове да бъдат прочетени
        const fileResults = await Promise.all(filePromises);
        fileResults.forEach(result => {
            object[result.key] = result.value;
        });
        
        // Запазваме целия обект като JSON низ в localStorage
        localStorage.setItem('iridologyFormData', JSON.stringify(object));
    }


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
                canvas.toBlob(blob => {
                    if (!blob) return reject(new Error('Оптимизацията е неуспешна.'));
                    const newFile = new File([blob], file.name.replace(/\.[^/.]+$/, '.png'), { type: 'image/png' });
                    resolve(newFile);
                }, 'image/png');
            };
        });
    }
});
