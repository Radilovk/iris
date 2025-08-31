import { WORKER_URL } from './config.js';

document.addEventListener('DOMContentLoaded', function() {
    const formSteps = document.querySelectorAll('.form-step');
    const nextBtns = document.querySelectorAll('.next-btn');
    const prevBtns = document.querySelectorAll('.prev-btn');
    const stepperSteps = document.querySelectorAll('.step');
    const messageBox = document.getElementById('message-box');
    const digestionSelect = document.getElementById('digestion');
    const digestionOther = document.getElementById('digestion-other');

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

    if (digestionSelect && digestionOther) {
        digestionSelect.addEventListener('change', () => {
            const values = Array.from(digestionSelect.selectedOptions).map(opt => opt.value);
            digestionOther.style.display = values.includes('Друго') ? 'block' : 'none';
        });
    }

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

    async function compressImage(file, maxSize = 1024, quality = 0.8) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = async () => {
                const withinBounds = img.width <= maxSize && img.height <= maxSize;
                if (file.size < 2 * 1024 * 1024 && withinBounds) {
                    URL.revokeObjectURL(img.src);
                    return resolve(file);
                }

                const canvas = document.createElement('canvas');
                const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                URL.revokeObjectURL(img.src);

                // Запазваме PNG файловете без конвертиране
                if (file.type === 'image/png') {
                    return canvas.toBlob(blob => {
                        if (blob) {
                            resolve(new File([blob], file.name, { type: 'image/png' }));
                        } else {
                            reject(new Error('Компресията е неуспешна'));
                        }
                    }, 'image/png');
                }

                try {
                    if (typeof ImageEncoder !== 'undefined') {
                        const bitmap = await createImageBitmap(canvas);
                        const encoder = new ImageEncoder({
                            type: 'image/webp',
                            quality: 1,
                            lossless: true
                        });
                        const { data } = await encoder.encode(bitmap);
                        const blob = new Blob([data], { type: 'image/webp' });
                        resolve(new File([blob], file.name.replace(/\.[^/.]+$/, '.webp'), { type: 'image/webp' }));
                    } else {
                        // Fallback за браузъри без ImageEncoder
                        canvas.toBlob(blob => {
                            if (blob) {
                                resolve(new File([blob], file.name.replace(/\.[^/.]+$/, '.webp'), { type: 'image/webp' }));
                            } else {
                                reject(new Error('Компресията е неуспешна'));
                            }
                        }, 'image/webp', quality);
                    }
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }

    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const submitBtn = this.querySelector('.submit-btn');
        const originalBtnText = submitBtn.innerHTML;

        // Деактивираме бутона, за да предотвратим повторни изпращания
        submitBtn.textContent = 'Анализиране...';
        submitBtn.disabled = true;

        if (messageBox) {
            messageBox.textContent = '';
            messageBox.className = '';
        }

        // Динамични съобщения за прогреса на анализа
        const progressMessages = [
            'Обработваме вашите изображения...',
            'Идентифицираме ирисови знаци...',
            'Анализираме вашата анамнеза...',
            'Генерираме персонален холистичен анализ...'
        ];
        let messageIndex = 0;
        let progressInterval;
        let spinner;
        let messageTextNode;

        if (messageBox) {
            messageBox.className = 'info-box';
            spinner = document.createElement('i');
            spinner.className = 'loading-spinner fas fa-spinner fa-spin';
            messageTextNode = document.createTextNode(progressMessages[messageIndex]);
            messageBox.textContent = '';
            messageBox.appendChild(spinner);
            messageBox.appendChild(messageTextNode);
            progressInterval = setInterval(() => {
                messageIndex = (messageIndex + 1) % progressMessages.length;
                messageTextNode.textContent = progressMessages[messageIndex];
            }, 4000);
        }

        const leftInput = document.getElementById('left-eye-upload');
        const rightInput = document.getElementById('right-eye-upload');

        const leftFile = leftInput.files[0] ? await compressImage(leftInput.files[0]) : null;
        const rightFile = rightInput.files[0] ? await compressImage(rightInput.files[0]) : null;

        const formData = new FormData(this);
        if (leftFile) formData.set('left-eye-upload', leftFile, leftFile.name);
        if (rightFile) formData.set('right-eye-upload', rightFile, rightFile.name);

        const storedForm = {};
        for (const [key, value] of formData.entries()) {
            if (value instanceof File) {
                storedForm[key] = await readFileAsDataURL(value);
            } else {
                storedForm[key] = value;
            }
        }
        localStorage.setItem('iridologyFormData', JSON.stringify(storedForm));

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
            if (progressInterval) clearInterval(progressInterval);
            if (spinner) spinner.remove();
            console.log("Получен успешен анализ:", data);

            // Съхраняваме получения JSON анализ в localStorage на браузъра
            localStorage.setItem('iridologyReport', JSON.stringify(data));

            // Пренасочваме потребителя към страницата за показване на доклада
            // (трябва да създадете файл 'report.html')
            window.location.href = 'report.html';
        })
        .catch(error => {
            if (progressInterval) clearInterval(progressInterval);
            if (spinner) spinner.remove();
            console.error('Критична грешка при изпращане на формуляра:', error);
            showError('Възникна грешка при анализа: ' + error.message);

            // Връщаме бутона в нормалното му състояние, за да може потребителят да опита отново
            submitBtn.innerHTML = originalBtnText;
            submitBtn.disabled = false;
        });
    });

});
