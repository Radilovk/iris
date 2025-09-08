import { WORKER_URL, MAX_IMAGE_BYTES } from './config.js';

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
    
    // Елементи за чекбоксове
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
            // Валидираме само текущата стъпка преди да преминем напред
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
            otherText.style.display = otherCheckbox.checked ? 'block' : 'none';
            if(otherCheckbox.checked) otherText.setAttribute('required', 'true');
            else otherText.removeAttribute('required');
        });
    }

    // --- ФУНКЦИИ ЗА СЪОБЩЕНИЯ И ГРЕШКИ ---
    function showMessage(message, type = 'info') {
        if (!messageContent) return;
        messageContent.textContent = message;
        messageBox.className = `${type}-box`; // Добавяме основен клас за стилизиране
    }

    function clearMessage() {
         if (!messageContent) return;
         messageContent.textContent = '';
         messageBox.className = '';
         progressBarContainer.style.display = 'none';
    }
    
    // --- ВАЛИДАЦИЯ В РЕАЛНО ВРЕМЕ ---
    const requiredFields = form.querySelectorAll('[required]');

    function validateField(field) {
        let isValid = true;
        // Изчистване на стара грешка
        field.parentElement.classList.remove('error');

        if (field.type === 'file' && field.files.length === 0) {
            isValid = false;
        } else if (field.value.trim() === '') {
            isValid = false;
        }
        
        if (!isValid) {
            field.parentElement.classList.add('error'); // Може да се добави CSS за това
        }
        return isValid;
    }

    requiredFields.forEach(field => {
        field.addEventListener('blur', () => validateField(field));
        field.addEventListener('change', () => validateField(field)); // За select и file
    });
    
    function validateStep(stepNumber) {
        const stepFields = form.querySelector(`.form-step[data-step="${stepNumber}"]`).querySelectorAll('[required]');
        let allValid = true;
        stepFields.forEach(field => {
            if (!validateField(field)) {
                allValid = false;
            }
        });
        if(!allValid) showMessage('Моля, попълнете всички задължителни полета.', 'error');
        else clearMessage();
        return allValid;
    }


    // --- ПРЕГЛЕД НА КАЧЕНИ ФАЙЛОВЕ ---
    function setupFileUpload(inputId, previewId) {
        const input = document.getElementById(inputId);
        const preview = document.getElementById(previewId);
        const fileNameEl = preview.parentElement.querySelector('.file-name');
        
        if(!input) return;

        preview.addEventListener('click', () => input.click());

        input.addEventListener('change', function() {
            const file = this.files[0];
            if (!file) {
                if (fileNameEl) fileNameEl.textContent = '';
                return;
            }

            if (!file.type.startsWith('image/')) {
                showMessage('Моля, качете изображение.', 'error');
                input.value = '';
                return;
            }

            if (file.size > MAX_IMAGE_BYTES) {
                 showMessage(`Файлът трябва да е до ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB.`, 'error');
                input.value = '';
                return;
            }

            const reader = new FileReader();
            const icon = preview.querySelector('i');
            const text = preview.querySelector('p');
            if (icon) icon.style.display = 'none';
            if (text) text.style.display = 'none';

            reader.onload = e => {
                preview.style.backgroundImage = `url(${e.target.result})`;
                preview.style.borderStyle = 'solid';
            }
            reader.readAsDataURL(file);

            if (fileNameEl) fileNameEl.textContent = file.name;
        });
    }

    setupFileUpload('left-eye-upload', 'left-eye-preview');
    setupFileUpload('right-eye-upload', 'right-eye-preview');

    // --- ЛОГИКА ЗА КОМПРЕСИЯ НА ИЗОБРАЖЕНИЯ (без промяна) ---
    async function compressImage(file, maxSize = 1024, quality = 0.8) {
       // ... съществуващия код за компресия остава същия ...
    }
    
    // --- ОБРАБОТКА НА ИЗПРАЩАНЕТО НА ФОРМАТА (ОСНОВНО ОБНОВЕНА) ---
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Финална валидация на всички полета
        if (!validateStep(1) || !validateStep(2) || !validateStep(3)) return;

        const submitBtn = this.querySelector('.submit-btn');
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.disabled = true;

        clearMessage();
        
        // Показваме progress bar и започваме симулация на прогреса
        progressBarContainer.style.display = 'block';
        progressBar.style.width = '0%';

        const progressSteps = [
            { percent: 25, message: 'Компресираме вашите изображения...' },
            { percent: 50, message: 'Изпращаме данните за визуален анализ...' },
            { percent: 75, message: 'AI извършва холистичен синтез...' },
            { percent: 95, message: 'Генерираме вашия персонален доклад...' }
        ];

        let currentProgressStep = 0;
        const progressInterval = setInterval(() => {
            if (currentProgressStep < progressSteps.length) {
                const step = progressSteps[currentProgressStep];
                progressBar.style.width = `${step.percent}%`;
                showMessage(step.message, 'info');
                currentProgressStep++;
            } else {
                clearInterval(progressInterval);
            }
        }, 2500);

        try {
            // Събираме данни от формата
            const formData = new FormData(form);

            // Актуализирана логика за събиране на данни от чекбоксове
            const digestionValues = [];
            form.querySelectorAll('input[name="digestion"]:checked').forEach(cb => {
                digestionValues.push(cb.value);
            });
            if (otherCheckbox.checked && otherText.value) {
                digestionValues.push(otherText.value);
            }
            // Премахваме индивидуалните стойности и задаваме масива
            formData.delete('digestion'); 
            formData.append('digestion', JSON.stringify(digestionValues));

            // Компресираме файловете
            const leftInput = document.getElementById('left-eye-upload');
            const rightInput = document.getElementById('right-eye-upload');
            if (leftInput.files[0]) {
                const compressed = await compressImage(leftInput.files[0]);
                formData.set('left-eye-upload', compressed, compressed.name);
            }
            if (rightInput.files[0]) {
                const compressed = await compressImage(rightInput.files[0]);
                formData.set('right-eye-upload', compressed, compressed.name);
            }

            // Изпращаме заявката
            const response = await fetch(WORKER_URL, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: `Грешка от сървъра: ${response.status}` }));
                throw new Error(errData.error);
            }

            const data = await response.json();

            // Успех!
            clearInterval(progressInterval);
            progressBar.style.width = '100%';
            showMessage('Успех! Пренасочваме ви към доклада...', 'success');
            
            localStorage.setItem('iridologyReport', JSON.stringify(data));
            
            setTimeout(() => {
                window.location.href = 'report.html';
            }, 1500);

        } catch (error) {
            console.error('Критична грешка при изпращане на формуляра:', error);
            clearInterval(progressInterval);
            progressBarContainer.style.display = 'none';
            showMessage('Възникна грешка: ' + error.message, 'error');
            submitBtn.innerHTML = originalBtnText;
            submitBtn.disabled = false;
        }
    });

});

// Поставете отново функцията compressImage тук, тъй като тя е извън DOMContentLoaded
async function compressImage(file, maxSize = 1024, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        im
