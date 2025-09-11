import { WORKER_BASE_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
  const viewer = document.getElementById('kv-viewer');
  const loadingEl = document.getElementById('loading');
  const messageBox = document.getElementById('message-box');
  const promptEditor = document.getElementById('role-prompt');
  const savePromptBtn = document.getElementById('save-prompt');
  const providerSelect = document.getElementById('provider-select');
  const modelSelect = document.getElementById('model-select');
  const saveModelBtn = document.getElementById('save-model');
  const configNameInput = document.getElementById('config-name');
  const configSelect = document.getElementById('config-select');
  const saveConfigBtn = document.getElementById('save-config');

  // Дефиниция на наличните модели по доставчик
  const MODEL_OPTIONS = {
    gemini: ['gemini-pro', 'gemini-pro-vision', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    // openai: ['gpt-4o', 'gpt-4o-mini'] // Пример за бъдещо разширение
  };
  
  // Променлива за съхранение на текущо заредената/редактирана конфигурация
  let currentConfig = {};

  function populateProviderOptions(selected) {
    providerSelect.innerHTML = '';
    Object.keys(MODEL_OPTIONS).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      providerSelect.appendChild(opt);
    });
    providerSelect.value = selected && MODEL_OPTIONS[selected] ? selected : Object.keys(MODEL_OPTIONS)[0];
  }

  function populateModelOptions(provider, selected) {
    modelSelect.innerHTML = '';
    const models = MODEL_OPTIONS[provider] || [];
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      modelSelect.appendChild(opt);
    });
    modelSelect.value = selected && models.includes(selected) ? selected : models[0] || '';
  }

  function showLoading() { loadingEl.style.display = 'flex'; }
  function hideLoading() { loadingEl.style.display = 'none'; }
  function showMessage(msg, type = 'info') {
    messageBox.textContent = msg;
    messageBox.className = type === 'error' ? 'error-box' : (type === 'success' ? 'success-box' : 'info-box');
    setTimeout(() => messageBox.textContent = '', 5000);
  }

  /**
   * Зарежда списъка със запазени конфигурации (ключове с префикс 'CONFIG:')
   * и след това зарежда активната конфигурация.
   */
  async function loadConfigList() {
    showLoading();
    try {
      const res = await fetch(`${WORKER_BASE_URL}/admin/keys`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      
      const configs = data.keys
        .filter(k => k.name.startsWith('CONFIG:'))
        .map(k => k.name.slice(7));
      
      configSelect.innerHTML = '<option value="">-- Избери конфигурация --</option>';
      configs.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        configSelect.appendChild(opt);
      });
      // След зареждане на списъка, зареждаме активната конфигурация
      await loadActiveConfig();
    } catch (err) {
      showMessage('Грешка при зареждане на списъка с конфигурации: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  /**
   * Зарежда активната конфигурация от 'iris_config_kv' и обновява UI.
   */
  async function loadActiveConfig() {
    showLoading();
    try {
      const res = await fetch(`${WORKER_BASE_URL}/admin/get?key=iris_config_kv`);
      if (!res.ok) throw new Error('Активната конфигурация `iris_config_kv` не е намерена.');
      
      const data = await res.json();
      currentConfig = JSON.parse(data.value || '{}');
      
      updateUIFromConfig(currentConfig);

      // Синхронизираме падащото меню и името
      if (currentConfig.name) {
        configSelect.value = currentConfig.name;
        configNameInput.value = currentConfig.name;
      }
      showMessage(`Заредена е активната конфигурация: '${currentConfig.name || 'N/A'}'`, 'info');

    } catch (err) {
      showMessage('Грешка при зареждане на активна конфигурация: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  /**
   * Зарежда конкретна именувана конфигурация и обновява UI.
   */
  async function loadConfig(name) {
    if (!name) return;
    showLoading();
    try {
      const res = await fetch(`${WORKER_BASE_URL}/admin/get?key=CONFIG:${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(await res.text());
      
      const data = await res.json();
      currentConfig = JSON.parse(data.value || '{}');
      updateUIFromConfig(currentConfig);
      
      configNameInput.value = name; // Уверяваме се, че името е в полето
      showMessage(`Заредена е конфигурация '${name}' за преглед/редакция.`, 'info');
    } catch (err) {
      showMessage(`Грешка при зареждане на конфигурация '${name}': ` + err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  /**
   * Помощна функция за обновяване на всички UI полета от конфигурационен обект.
   */
  function updateUIFromConfig(config) {
    promptEditor.value = config.report_prompt_template || '';
    populateProviderOptions(config.provider);
    // За модела използваме report_model като основен, тъй като той е по-вероятно да се сменя
    populateModelOptions(config.provider, config.report_model);
  }

  /**
   * Запазва конфигурационен обект под дадено име (в ключ 'CONFIG:name').
   */
  async function saveConfig(name, configData) {
    const res = await fetch(`${WORKER_BASE_URL}/admin/put`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: `CONFIG:${name}`, value: JSON.stringify(configData) })
    });
    if (!res.ok) throw new Error(await res.text());
  }

  /**
   * Задава конфигурационен обект като активен (записва го в 'iris_config_kv').
   */
  async function setActiveConfig(configData) {
    const res = await fetch(`${WORKER_BASE_URL}/admin/put`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'iris_config_kv', value: JSON.stringify(configData) })
    });
    if (!res.ok) throw new Error(await res.text());
  }
  
  /**
   * Зарежда и показва всички ключове и техните стойности от KV.
   */
  async function loadAllKV() {
    showLoading();
    try {
        const res = await fetch(`${WORKER_BASE_URL}/admin/keys`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        const all = {};
        for (const k of data.keys) {
            const vRes = await fetch(`${WORKER_BASE_URL}/admin/get?key=${encodeURIComponent(k.name)}`);
            if (vRes.ok) {
                const vData = await vRes.json();
                try {
                    all[k.name] = JSON.parse(vData.value);
                } catch {
                    all[k.name] = vData.value;
                }
            }
        }
        viewer.textContent = JSON.stringify(all, null, 2);
    } catch (err) {
        showMessage('Грешка при извличане на KV данните: ' + err.message, 'error');
    } finally {
        hideLoading();
    }
  }

  // --- Event Listeners ---

  providerSelect.addEventListener('change', () => {
    populateModelOptions(providerSelect.value);
  });

  configSelect.addEventListener('change', async () => {
    const name = configSelect.value;
    if (!name) return;
    await loadConfig(name);
    // След като заредим конфигурацията, я правим и активна
    try {
      await setActiveConfig(currentConfig);
      showMessage(`Конфигурация '${name}' е заредена и активирана.`, 'success');
    } catch (err) {
      showMessage('Грешка при активиране на конфигурацията: ' + err.message, 'error');
    }
  });

  saveConfigBtn.addEventListener('click', async () => {
    const name = configNameInput.value.trim();
    if (!name) {
      showMessage('Въведете име на конфигурация.', 'error');
      return;
    }

    // Създаваме нов обект с данни от UI и запазваме някои нередактируеми полета
    const dataToSave = {
      ...currentConfig, // Запазваме analysis_prompt_template и др.
      name: name,
      report_prompt_template: promptEditor.value,
      provider: providerSelect.value,
      // Задаваме и двата модела да са еднакви за по-лесно управление от UI
      analysis_model: modelSelect.value,
      report_model: modelSelect.value
    };

    showLoading();
    try {
      await saveConfig(name, dataToSave);
      await setActiveConfig(dataToSave);
      await loadConfigList(); // Презареждаме списъка, за да включи новата опция
      configSelect.value = name; // Избираме новосъздадената конфигурация
      showMessage(`Конфигурацията '${name}' е записана и активирана.`, 'success');
    } catch (err) {
      showMessage('Грешка при запис на конфигурация: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  });

  // Бутоните за бърз запис вече променят само текущата конфигурация
  savePromptBtn.addEventListener('click', async () => {
    if (!currentConfig.name) {
        showMessage('Първо заредете или запишете конфигурация.', 'error');
        return;
    }
    currentConfig.report_prompt_template = promptEditor.value;
    showLoading();
    try {
      await saveConfig(currentConfig.name, currentConfig);
      await setActiveConfig(currentConfig);
      showMessage(`Промптът е записан в конфигурация '${currentConfig.name}'.`, 'success');
    } catch (err) {
      showMessage('Грешка: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  });

  saveModelBtn.addEventListener('click', async () => {
     if (!currentConfig.name) {
        showMessage('Първо заредете или запишете конфигурация.', 'error');
        return;
    }
    currentConfig.provider = providerSelect.value;
    currentConfig.analysis_model = modelSelect.value;
    currentConfig.report_model = modelSelect.value;
    showLoading();
    try {
      await saveConfig(currentConfig.name, currentConfig);
      await setActiveConfig(currentConfig);
      showMessage(`Моделът е записан в конфигурация '${currentConfig.name}'.`, 'success');
    } catch (err) {
      showMessage('Грешка: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  });

  // Първоначално зареждане
  loadConfigList();
  loadAllKV();
});
