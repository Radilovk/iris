import { WORKER_BASE_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
  // DOM елементи
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
  const modelsListEditor = document.getElementById('models-list-editor');
  const saveModelsListBtn = document.getElementById('save-models-list');

  // Глобални променливи за състоянието
  let MODEL_OPTIONS = {}; // Вече не е константа, ще се зареди от KV
  let currentConfig = {}; // Съхранява текущо заредената/редактирана конфигурация

  // --- Функции за управление на UI ---

  function populateProviderOptions(selected) {
    providerSelect.innerHTML = '';
    const providers = Object.keys(MODEL_OPTIONS);
    providers.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      providerSelect.appendChild(opt);
    });
    providerSelect.value = selected && providers.includes(selected) ? selected : providers[0] || '';
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
    setTimeout(() => {
        if (messageBox.textContent === msg) {
            messageBox.textContent = '';
        }
    }, 5000);
  }
  
  function updateUIFromConfig(config) {
    promptEditor.value = config.report_prompt_template || '';
    populateProviderOptions(config.provider);
    populateModelOptions(config.provider, config.report_model);
  }

  // --- Функции за комуникация с Worker (API) ---

  /**
   * (НОВО) Зарежда списъка с налични модели от KV ключа `iris_models_list`.
   */
  async function loadModelsList() {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/admin/models`);
      if (!res.ok) throw new Error(`[${res.status}] ${await res.text()}`);
      const data = await res.json();
      MODEL_OPTIONS = data.models || {}; // Запазваме в глобалната променлива
      // Показваме в текстовото поле за редакция
      modelsListEditor.value = JSON.stringify(MODEL_OPTIONS, null, 2);
    } catch (err) {
      showMessage('Грешка при зареждане на списъка с модели: ' + err.message, 'error');
      modelsListEditor.value = "{}"; // Показваме празен обект при грешка
    }
  }

  /**
   * (НОВО) Запазва списъка с модели в KV ключа `iris_models_list`.
   */
  async function saveModelsList() {
    let modelsJson;
    try {
      // Валидираме дали текстът е валиден JSON
      modelsJson = JSON.parse(modelsListEditor.value);
    } catch (e) {
      showMessage('Грешка: Въведеният текст не е валиден JSON.', 'error');
      return;
    }

    showLoading();
    try {
      const res = await fetch(`${WORKER_BASE_URL}/admin/models`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modelsJson)
      });

      if (!res.ok) throw new Error(`[${res.status}] ${await res.text()}`);
      
      // При успех, обновяваме локалната променлива и UI елементите
      MODEL_OPTIONS = modelsJson;
      updateUIFromConfig(currentConfig); // Обновяваме падащите менюта
      showMessage('Списъкът с модели е запазен успешно!', 'success');

    } catch (err) {
      showMessage('Грешка при запис на списъка с модели: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  async function loadConfigList() {
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
      await loadActiveConfig();
    } catch (err) {
      showMessage('Грешка при зареждане на списъка с конфигурации: ' + err.message, 'error');
    }
  }

  async function loadActiveConfig() {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/admin/get?key=iris_config_kv`);
      if (!res.ok) throw new Error('Активната конфигурация `iris_config_kv` не е намерена.');
      
      const data = await res.json();
      currentConfig = JSON.parse(data.value || '{}');
      updateUIFromConfig(currentConfig);

      if (currentConfig.name) {
        configSelect.value = currentConfig.name;
        configNameInput.value = currentConfig.name;
      }
      showMessage(`Заредена е активната конфигурация: '${currentConfig.name || 'N/A'}'`, 'info');
    } catch (err) {
      showMessage('Грешка при зареждане на активна конфигурация: ' + err.message, 'error');
      currentConfig = {}; // Нулираме при грешка
      updateUIFromConfig({}); // Почистваме UI
    }
  }

  async function loadConfig(name) {
    if (!name) return;
    showLoading();
    try {
      const res = await fetch(`${WORKER_BASE_URL}/admin/get?key=CONFIG:${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error(await res.text());
      
      const data = await res.json();
      currentConfig = JSON.parse(data.value || '{}');
      updateUIFromConfig(currentConfig);
      configNameInput.value = name;
      showMessage(`Заредена е конфигурация '${name}' за преглед/редакция.`, 'info');
    } catch (err) {
      showMessage(`Грешка при зареждане на конфигурация '${name}': ` + err.message, 'error');
    } finally {
      hideLoading();
    }
  }

  async function saveConfig(name, configData) {
    const res = await fetch(`${WORKER_BASE_URL}/admin/put`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: `CONFIG:${name}`, value: JSON.stringify(configData) })
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async function setActiveConfig(configData) {
    const res = await fetch(`${WORKER_BASE_URL}/admin/put`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'iris_config_kv', value: JSON.stringify(configData) })
    });
    if (!res.ok) throw new Error(await res.text());
  }
  
  async function loadAllKV() {
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

    const dataToSave = {
      ...currentConfig,
      name: name,
      report_prompt_template: promptEditor.value,
      provider: providerSelect.value,
      analysis_model: modelSelect.value,
      report_model: modelSelect.value
    };

    showLoading();
    try {
      await saveConfig(name, dataToSave);
      await setActiveConfig(dataToSave);
      await loadConfigList();
      configSelect.value = name;
      showMessage(`Конфигурацията '${name}' е записана и активирана.`, 'success');
    } catch (err) {
      showMessage('Грешка при запис на конфигурация: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  });

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

  // (НОВО) Event listener за бутона за запазване на списъка с модели
  saveModelsListBtn.addEventListener('click', saveModelsList);

  // --- Първоначално зареждане на страницата ---

  async function initialLoad() {
    showLoading();
    // Зареждаме първо списъка с модели, тъй като конфигурациите зависят от него
    await loadModelsList(); 
    // След това зареждаме списъка с конфигурации и активната конфигурация
    await loadConfigList();
    // Накрая зареждаме прегледа на цялото KV хранилище
    await loadAllKV();
    hideLoading();
  }

  initialLoad();
});```

### Обобщение на промените:

1.  **Премахната константа:** `const MODEL_OPTIONS` е премахната. На нейно място е `let MODEL_OPTIONS = {}`, която се попълва при зареждане.
2.  **Нови селектори:** Добавени са променливи за достъп до `models-list-editor` и `save-models-list`.
3.  **Нови функции (`loadModelsList`, `saveModelsList`):** Имплементирани са две нови асинхронни функции, които комуникират с worker-а, за да четат и записват `iris_models_list`.
4.  **Нов Event Listener:** `saveModelsListBtn` вече има закачен `event listener`, който извиква `saveModelsList`.
5.  **Променен ред на зареждане:** Създадена е нова функция `initialLoad()`, която се изпълнява при зареждане на страницата. Тя гарантира, че списъкът с модели се зарежда **преди** списъка с конфигурации, което е критично за правилното функциониране на падащите менюта.
6.  **Обработка на грешки:** Добавена е проверка за валидност на JSON-а в `saveModelsList` и по-добра обработка на грешки при зареждане, за да не "крашва" панелът.

Следващата и последна стъпка е да актуализираме `worker.js`, за да добавим двата нови маршрута (`/admin/models`), които този скрипт вече се опитва да използва.
