:root {
    --bg-color: #f4f7f9;
    --text-color: #333;
    --primary-color: #007bff;
    --primary-gradient: linear-gradient(135deg, #4facfe, #00f2fe);
    --secondary-color: #28a745;
    --error-color: #dc3545;
    --card-bg: #ffffff;
    --border-color: #e0e0e0;
}

* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: 'Poppins', sans-serif;
    background-color: var(--bg-color);
    color: var(--text-color);
    line-height: 1.6;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
}

/* =============================================== */
/* === ОСНОВНА СТРАНИЦА (HERO & FORM) === */
/* =============================================== */

.hero-section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 80vh;
    gap: 2rem;
}
.hero-content { flex: 1; }
.hero-content h1 {
    font-size: 3.5rem;
    font-weight: 700;
    line-height: 1.2;
    margin-bottom: 1.5rem;
    background: var(--primary-gradient);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}
.hero-content p { font-size: 1.1rem; color: #555; margin-bottom: 2rem; }
.cta-button {
    display: inline-block;
    background: var(--primary-gradient);
    color: white;
    padding: 1rem 2.5rem;
    border-radius: 50px;
    text-decoration: none;
    font-weight: 600;
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    box-shadow: 0 4px 15px rgba(0, 123, 255, 0.3);
}
.cta-button:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 25px rgba(0, 123, 255, 0.4);
}
.hero-image { flex: 1; text-align: center; }
.hero-image img { max-width: 100%; height: auto; animation: float 6s ease-in-out infinite; }

@keyframes float { 0% { transform: translateY(0px); } 50% { transform: translateY(-20px); } 100% { transform: translateY(0px); } }

.analysis-section { padding-top: 4rem; text-align: center; }
.analysis-section h2 { font-size: 2.5rem; margin-bottom: 2rem; }
.card {
    background: var(--card-bg);
    border-radius: 24px;
    padding: 2.5rem;
    box-shadow: 0 10px 40px rgba(0,0,0,0.08);
    text-align: left;
}

/* Stepper */
.stepper-nav { display: flex; align-items: center; justify-content: center; margin-bottom: 2rem; padding: 0; }
.step { display: flex; flex-direction: column; align-items: center; color: #ccc; transition: color 0.3s ease; list-style: none; }
.step span { width: 40px; height: 40px; border-radius: 50%; background-color: #eee; color: #aaa; display: flex; justify-content: center; align-items: center; font-weight: 700; transition: all 0.3s ease; border: 2px solid #eee; }
.step p { font-size: 0.9rem; margin-top: 0.5rem; }
.step.active span { background-color: var(--primary-color); color: white; border-color: var(--primary-color); }
.step.active p { color: var(--primary-color); font-weight: 600; }
.step.completed span { background-color: var(--secondary-color); color: white; border-color: var(--secondary-color); }
.step.completed p { color: var(--secondary-color); font-weight: 600; }
.step-line { flex-grow: 1; height: 2px; background-color: #eee; margin: 0 1rem; transform: translateY(-10px); }

/* Form */
.form-step { display: none; }
.form-step.active { display: block; animation: slideIn 0.5s forwards; }
@keyframes slideIn { from { opacity: 0; transform: translateX(50px); } to { opacity: 1; transform: translateX(0); } }

.form-step h3 { text-align: center; margin-bottom: 2rem; font-weight: 600; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
.form-group.full-width { grid-column: 1 / -1; }
.form-group label { display: block; margin-bottom: 0.5rem; font-weight: 600; }
.form-group input, .form-group select, .form-group textarea { width: 100%; padding: 0.8rem; border: 1px solid var(--border-color); border-radius: 8px; font-family: 'Poppins', sans-serif; font-size: 1rem; transition: border-color 0.3s, box-shadow 0.3s; }
.form-group input:focus, .form-group select:focus, .form-group textarea:focus { outline: none; border-color: var(--primary-color); box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.2); }

/* --- НОВО: Стилове за валидация --- */
.form-group.error input,
.form-group.error select,
.form-group.error textarea {
    border-color: var(--error-color);
    box-shadow: 0 0 0 3px rgba(220, 53, 69, 0.2);
}

/* --- НОВО: Стилове за чекбоксове --- */
.checkbox-group { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
.checkbox-item { display: flex; align-items: center; background: #f8f9fa; padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid var(--border-color); cursor: pointer; transition: all 0.2s ease; }
.checkbox-item:hover { border-color: var(--primary-color); }
.checkbox-item input { margin-right: 0.5rem; width: 1.1em; height: 1.1em; accent-color: var(--primary-color); }

.button-group { display: flex; justify-content: space-between; margin-top: 2rem; }
.btn { padding: 0.8rem 1.5rem; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.3s ease; }
.btn:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-primary { background-color: var(--primary-color); color: white; }
.btn-primary:hover:not(:disabled) { background-color: #0056b3; }
.btn-secondary { background-color: #eee; color: #555; }
.btn-secondary:hover:not(:disabled) { background-color: #ddd; }

/* Upload Area */
.upload-instructions { text-align: center; background: #f8f9fa; padding: 1.5rem; border-radius: 12px; margin-bottom: 2rem; }
.upload-instructions i.fa-camera { font-size: 2rem; color: var(--primary-color); margin-bottom: 1rem; }
.upload-instructions ul { list-style: none; text-align: left; display: inline-block; padding: 0; }
.upload-instructions li { margin-bottom: 0.5rem; }
.upload-instructions i.fa-check-circle { color: var(--secondary-color); margin-right: 0.5rem; }
.upload-area-container { display: flex; gap: 2rem; justify-content: center; }
.upload-area { text-align: center; }
.upload-area input[type="file"] { display: none; }
.upload-area .upload-preview { width: 180px; height: 180px; border: 2px dashed var(--border-color); border-radius: 50%; display: flex; flex-direction: column; justify-content: center; align-items: center; cursor: pointer; transition: all 0.3s ease; background-size: cover; background-position: center; overflow: hidden; }
.upload-area .upload-preview:hover { border-color: var(--primary-color); background-color: #f0f8ff; }
.upload-area .upload-preview i { font-size: 3rem; color: #ccc; }
.upload-area .upload-preview p { color: #aaa; margin-top: 0.5rem; }
.upload-area .file-name { display: block; margin-top: 0.5rem; font-size: 0.8rem; color: #555; text-align: center; }

/* --- НОВО: Стилове за примерите със снимки --- */
.photo-examples-container { display: flex; justify-content: center; gap: 1rem; margin-top: 1.5rem; flex-wrap: wrap; }
.photo-example { text-align: center; }
.photo-example img { width: 100px; height: 100px; border-radius: 8px; object-fit: cover; border: 2px solid var(--border-color); }
.photo-example p { font-size: 0.8rem; margin-top: 0.5rem; color: #555; }

.upload-note { margin-top: 1rem; font-size: 0.9rem; color: #555; text-align: center; }
.disclaimer-note { display: flex; align-items: center; gap: 1rem; background-color: #f8f9fa; padding: 1rem; border-radius: 8px; margin-top: 2rem; border-left: 4px solid var(--primary-color); }
.disclaimer-note i { color: var(--primary-color); font-size: 1.5rem; }
.disclaimer-note p { font-size: 0.9rem; color: #555; margin: 0; text-align: left; }

/* Message Box & Progress Bar */
#message-box { margin-top: 1.5rem; width: 100%; text-align: center; }
.message-content { padding: 1rem; border-radius: 8px; font-weight: 600; display: none; /* Ще се показва само когато има съобщение */ }
.message-content.active { display: block; }
.error-box .message-content { color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; }
.success-box .message-content { color: #155724; background-color: #d4edda; border: 1px solid #c3e6cb; }
.info-box .message-content { color: #0c5460; background-color: #d1ecf1; border: 1px solid #bee5eb; }

/* --- НОВО: Стилове за progress bar --- */
.progress-bar-container { width: 100%; background-color: #e9ecef; border-radius: 8px; overflow: hidden; margin-bottom: 0.5rem; }
.progress-bar { height: 10px; width: 0%; background: var(--primary-gradient); transition: width 0.5s ease-in-out; }


/* =============================================== */
/* === СТРАНИЦА С ДОКЛАД (REPORT) === */
/* =============================================== */
.report-header { text-align: center; margin-bottom: 2rem; }
.report-header h2 { font-size: 2.5rem; margin-bottom: 0.5rem; background: var(--primary-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.report-header p { font-size: 1.1rem; color: #555; }
#report-card.card { box-shadow: none; padding: 0; }
.report-section { margin-bottom: 2.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--border-color); }
.report-section:last-of-type { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
.report-section h3 { display: flex; align-items: center; font-size: 1.5rem; color: var(--text-color); margin-bottom: 1rem; }
.report-section h3 i { color: var(--primary-color); font-size: 1.3rem; margin-right: 1rem; width: 30px; text-align: center; }
.report-section p, .report-section ul { font-size: 1rem; line-height: 1.7; color: #555; }
.report-section ul { list-style: none; padding-left: 0; }
.report-section ul li { display: flex; align-items: flex-start; margin-bottom: 0.8rem; }
.report-section ul li i { color: var(--secondary-color); margin-right: 1rem; margin-top: 5px; }
.report-disclaimer { display: flex; align-items: flex-start; gap: 1rem; background-color: #f8f9fa; padding: 1.5rem; border-radius: 12px; margin-top: 2rem; border-left: 4px solid var(--primary-color); }
.report-disclaimer i { color: var(--primary-color); font-size: 1.5rem; margin-top: 3px; }
.report-disclaimer p { font-size: 0.9rem; margin: 0; }
.loading-box { display: flex; justify-content: center; align-items: center; font-size: 1.2rem; color: #555; padding: 3rem; }
.loading-box i { margin-right: 1rem; font-size: 1.5rem; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* =============================================== */
/* === RESPONSIVE DESIGN === */
/* =============================================== */
@media (max-width: 992px) {
    .hero-section { flex-direction: column; text-align: center; min-height: auto; padding-top: 2rem; }
    .hero-image { margin-top: 2rem; }
    .form-grid { grid-template-columns: 1fr; }
    .upload-area-container { flex-direction: column; align-items: center; }
}
@media (max-width: 767px) {
    .container { padding: 1.5rem; }
    .card { padding: 1.5rem; }
    .hero-content h1 { font-size: 2.5rem; }
    .button-group { flex-direction: column-reverse; gap: 1rem; }
    .button-group .btn { width: 100%; }
    .form-step .button-group { flex-direction: column; }
    .form-step .button-group .prev-btn { order: 2; }
    .form-step .button-group .next-btn, .form-step .button-group .submit-btn { order: 1; }
}
