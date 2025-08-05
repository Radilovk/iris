document.addEventListener('DOMContentLoaded', function() {
    const formSteps = document.querySelectorAll('.form-step');
    const nextBtns = document.querySelectorAll('.next-btn');
    const prevBtns = document.querySelectorAll('.prev-btn');
    const stepperSteps = document.querySelectorAll('.step');

    let currentStep = 1;

    function updateStepper() {
        stepperSteps.forEach((step, index) => {
            if (index + 1 === currentStep) {
                step.classList.add('active');
            } else {
                step.classList.remove('active');
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

    // File Upload Preview
    function setupFileUpload(inputId, previewId) {
        const input = document.getElementById(inputId);
        const preview = document.getElementById(previewId);
        
        input.addEventListener('change', function() {
            const file = this.files[0];
            if (file) {
                const reader = new FileReader();
                preview.innerHTML = ''; // Clear icon and text
                reader.onload = function(e) {
                    preview.style.backgroundImage = `url(${e.target.result})`;
                    preview.style.borderStyle = 'solid';
                }
                reader.readAsDataURL(file);
            }
        });
    }

    setupFileUpload('left-eye-upload', 'left-eye-preview');
    setupFileUpload('right-eye-upload', 'right-eye-preview');

    // Form submission
    const form = document.getElementById('iridology-form');
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        // Here you would gather all form data and send to your backend (worker.js)
        alert('Формулярът е изпратен за анализ!');
        // const formData = new FormData(this);
        // fetch('/your-worker-endpoint', { method: 'POST', body: formData })
        // .then(response => response.json())
        // .then(data => { console.log(data); window.location.href = 'report.html'; });
    });

});