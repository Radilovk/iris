import { WORKER_URL } from './config.js';

document.addEventListener('DOMContentLoaded', function() {
    const formSteps = document.querySelectorAll('.form-step');
    const nextBtns = document.querySelectorAll('.next-btn');
    const prevBtns = document.querySelectorAll('.prev-btn');
    const stepperSteps = document.querySelectorAll('.step');
    const messageBox = document.getElementById('message-box');

    let currentStep = 1;

    function updateStepper() {
        stepperSteps.forEach((step, index) => {
            const stepNumber = index + 1;
            // изчистваме старите състояния
            step.classList.remove('active', 'completed');

            if (stepNumber === currentStep) {
                step.classList.add('active');
            } else if (stepNumber < currentStep) {
                step.classList.add('completed');
            }
        });
    }

    function showStep(stepNumber) {
        formSteps.forEach(step => {
            step.classList.remove('active');
        });
        document.querySelector(`.form-step[data-step="${stepNumber}"]`).classList.add('active');
        currentStep = stepNumber;
        updateStepper();
    }

    nextBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (currentStep < formSteps.length) {
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

    function showError(message) {
        if (!messageBox) return;
        messageBox.textContent = message;
        messageBox.className = 'error-box';
    }

    // File Upload Preview
    function setupFileUpload(inputId, previewId) {
        const input = document.getElementById(inputId);
        const preview = document.getElementById(previewId);
        const fileNameEl = preview.parentElement.querySelector('.file-name');
        preview.addEventListener('click', () => input.click());

        input.addEventListener('change', function() {
            const file = this.files[0];
            if (!file) {
                if (fileNameEl) fileNameEl.textContent = '';
                return;
            }

            // Проверка за тип на файла
            if (!file.type.startsWith('image/')) {
                showError('Моля, качете изображение.');
                input.value = '';
                if (fileNameEl) fileNameEl.textContent = '';
                return;
            }

            // Проверка за размер на файла (до 5MB)
            const maxSize = 5 * 1024 * 1024;
            if (file.size > maxSize) {
                showError('Файлът трябва да е до 5MB.');
                input.value = '';
                if (fileNameEl) fileNameEl.textContent = '';
                return;
            }

            const reader = new FileReader();
            // Изчистване на иконата и текста, за да се види само снимката
            const icon = preview.querySelector('i');
            const text = preview.querySelector('p');
            if (icon) icon.style.display = 'none';
            if (text) text.style.display = 'none';

            reader.onload = function(e) {
                preview.style.backgroundImage = `url(${e.target.result})`;
                preview.style.borderStyle = 'solid'; // Прави рамката плътна
            }
            reader.readAsDataURL(file);

            if (fileNameEl) fileNameEl.textContent = file.name;
        });
    }

    setupFileUpload('left-eye-upload', 'left-eye-preview');
    setupFileUpload('right-eye-upload', 'right-eye-preview');

    // Form submission - НАПЪЛНО ОБНОВЕНА СЕКЦИЯ
    const form = document.getElementById('iridology-form');
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const submitBtn = this.querySelector('.submit-btn');
        const originalBtnText = submitBtn.innerHTML;

        // Показване на индикатор за зареждане, за да знае потребителят, че се работи
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Моля, изчакайте...';
        submitBtn.disabled = true;

        if (messageBox) {
            messageBox.textContent = '';
            messageBox.className = '';
        }

        const formData = new FormData(this);
        
        // Взимаме URL на Worker-а от конфигурацията
        const workerUrl = WORKER_URL;

        fetch(workerUrl, { 
            method: 'POST', 
            body: formData 
        })
        .then(response => {
            // Проверка дали отговорът от сървъра е успешен (статус 2xx)
            if (!response.ok) {
                // Ако има грешка, опитваме се да я прочетем като JSON
                return response.json().then(errData => {
                    // Хвърляме грешка с по-ясно съобщение от бекенда
                    throw new Error(errData.error || `Грешка от сървъра: ${response.status}`);
                }).catch(() => {
                    // Ако тялото на грешката не е JSON, хвърляме обща грешка
                    throw new Error(`Грешка от сървъра: ${response.status} ${response.statusText}`);
                });
            }
            return response.json();
        })
        .then(data => { 
            console.log("Получен успешен анализ:", data);
            
            // Съхраняваме получения JSON анализ в localStorage на браузъра
            localStorage.setItem('iridologyReport', JSON.stringify(data));
            
            // Пренасочваме потребителя към страницата за показване на доклада
            // (трябва да създадете файл 'report.html')
            window.location.href = 'report.html';
        })
        .catch(error => {
            console.error('Критична грешка при изпращане на формуляра:', error);
            showError('Възникна грешка при анализа: ' + error.message);
            
            // Връщаме бутона в нормалното му състояние, за да може потребителят да опита отново
            submitBtn.innerHTML = originalBtnText;
            submitBtn.disabled = false;
        });
    });

});
