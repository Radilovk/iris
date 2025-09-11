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

  const DEFAULT_MODEL_OPTIONS = {
    gemini: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    openai: ['gpt-4o', 'gpt-4o-mini']
  };
  let MODEL_OPTIONS = JSON.parse(JSON.stringify(DEFAULT_MODEL_OPTIONS));

  function populateProviderOptions(selected) {
    providerSelect.innerHTML = '';
    if (!Object.keys(MODEL_OPTIONS).length) {
      MODEL_OPTIONS = JSON.parse(JSON.stringify(DEFAULT_MODEL_OPTIONS));
    }
    Object.keys(MODEL_OPTIONS).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      providerSelect.appendChild(opt);
    });
    providerSelect.value = selected && MODEL_OPTIONS[selected]
      ? selected
      : Object.keys(MODEL_OPTIONS)[0];
  }

  function populateModelOptions(provider, selected) {
    modelSelect.innerHTML = '';
    (MODEL_OPTIONS[provider] || []).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      modelSelect.appendChild(opt);
    });
    const first = (MODEL_OPTIONS[provider] || [])[0];
    modelSelect.value = selected && (MODEL_OPTIONS[provider] || []).includes(selected)
      ? selected
      : first || '';
  }

  // управление на списъка с модели е премахнато

  async function hasOpenAIKey() {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/admin/secret`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) return false;
      const data = await res.json();
      return !!data.exists;
    } catch {
      return false;
    }
  }

  async function hasGeminiKey() {
    try {
      const res = await fetch(`${WORKER_BASE_URL}/admin/secret/gemini`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data.exists) {
        showMessage('Gemini API ключ липсва. Задайте го чрез `wrangler secret put gemini_api_key`.', 'error');
      }
      return !!data.exists;
    } catch {
      showMessage('Грешка при проверка за Gemini API ключ.', 'error');
      return false;
    }
  }

  function showLoading() {
    loadingEl.style.display = 'flex';
  }

  function hideLoading() {
    loadingEl.style.display = 'none';
  }

  function showMessage(msg, type = 'error') {
    messageBox.textContent = msg;
    messageBox.className =
      type === 'error' ? 'error-box'
      : type === 'success' ? 'success-box'
      : 'warn-box';
  }

  function normalizeValue(val) {
    val = val.trim();
    if (val.startsWith('{') || val.startsWith('[')) {
      return JSON.stringify(JSON.parse(val));
    }
    return JSON.stringify(val);
  }

  async function checkAnalysisKeys() {
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      const [lastRes, holRes] = await Promise.all([
        fetch(`${WORKER_BASE_URL}/admin/get?key=lastAnalysis`, { headers }),
        fetch(`${WORKER_BASE_URL}/admin/get?key=holistic_analysis`, { headers })
      ]);
      const lastData = lastRes.ok ? await lastRes.json() : { value: '{}' };
      const holData = holRes.ok ? await holRes.json() : { value: '' };
      const lastEmpty = !lastData.value || lastData.value === '{}';
      const holEmpty = !holData.value;
      if (lastEmpty || holEmpty) {
        showMessage('Предупреждение: липсват запазени анализи.', 'warn');
      }
    } catch (err) {
      showMessage('Грешка при проверка на анализите: ' + err.message);
    }
  }

  async function loadPrompt() {
    showLoading();
    try {
      const res = await fetch(`${WORKER_BASE_URL}/admin/get?key=ROLE_PROMPT`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const obj = JSON.parse(data.value || '{}');
      promptEditor.value = obj.prompt || '';
    } catch (err) {
      showMessage('Грешка при зареждане на промпта: ' + err.message);
    } finally {
      hideLoading();
    }
  }

  async function loadModel() {
    showLoading();
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      const [optionsRes, providerRes, modelRes, keySet] = await Promise.all([
        fetch(`${WORKER_BASE_URL}/admin/get?key=MODEL_OPTIONS`, { headers }),
        fetch(`${WORKER_BASE_URL}/admin/get?key=AI_PROVIDER`, { headers }),
        fetch(`${WORKER_BASE_URL}/admin/get?key=AI_MODEL`, { headers }),
        hasOpenAIKey()
      ]);

      await hasGeminiKey();

      if (optionsRes.status === 404) {
        MODEL_OPTIONS = JSON.parse(JSON.stringify(DEFAULT_MODEL_OPTIONS));
        showMessage('MODEL_OPTIONS не е намерен. Използвам стойности по подразбиране.', 'error');
      } else {
        if (!optionsRes.ok) throw new Error(await optionsRes.text());
        const optionsData = await optionsRes.json();
        MODEL_OPTIONS = JSON.parse(optionsData.value || '{}');
        if (!Object.keys(MODEL_OPTIONS).length) {
          MODEL_OPTIONS = JSON.parse(JSON.stringify(DEFAULT_MODEL_OPTIONS));
        }
      }

      if (!providerRes.ok) throw new Error(await providerRes.text());
      const providerData = await providerRes.json();

      let provider;
      const defaultProvider = Object.keys(DEFAULT_MODEL_OPTIONS)[0];
      try {
        provider = JSON.parse(providerData.value);
      } catch (err) {
        provider = providerData.value?.trim() || defaultProvider;
        showMessage('Невалиден формат за AI_PROVIDER: ' + err.message + '. Използвам "' + provider + '".', 'error');
      }
      if (!provider || !MODEL_OPTIONS[provider]) provider = defaultProvider;

      let model;
      if (modelRes.status === 404) {
        model = (MODEL_OPTIONS[provider] || [])[0];
        showMessage('AI_MODEL не е намерен. Използвам резервен модел "' + model + '".', 'error');
      } else {
        if (!modelRes.ok) throw new Error(await modelRes.text());
        const modelData = await modelRes.json();
        try {
          model = JSON.parse(modelData.value);
        } catch (err) {
          model = modelData.value?.trim() || (MODEL_OPTIONS[provider] || [])[0];
          showMessage('Невалиден формат за AI_MODEL: ' + err.message + '. Използвам "' + model + '".', 'error');
        }
      }
      if (!model) model = (MODEL_OPTIONS[provider] || [])[0];

      populateProviderOptions(provider);
      const hasKey = keySet;
      if (!hasKey) {
        const opt = providerSelect.querySelector('option[value="openai"]');
        if (opt) opt.disabled = true;
        if (provider === 'openai') {
          provider = Object.keys(MODEL_OPTIONS)[0];
          model = (MODEL_OPTIONS[provider] || [])[0];
          showMessage('OpenAI API ключ липсва. Задайте го чрез `wrangler secret put openai_api_key`.', 'error');
          providerSelect.value = provider;
        }
      }

      populateModelOptions(provider, model);
    } catch (err) {
      showMessage('Грешка при зареждане на модела: ' + err.message);
    } finally {
      hideLoading();
    }
  }

  async function loadConfig(name) {
    showLoading();
    try {
      const res = await fetch(`${WORKER_BASE_URL}/admin/get?key=CONFIG:${encodeURIComponent(name)}`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const cfg = JSON.parse(data.value || '{}');
      promptEditor.value = cfg.prompt || '';
      if (cfg.provider) {
        populateProviderOptions(cfg.provider);
        populateModelOptions(cfg.provider, cfg.model);
      } else {
        populateModelOptions(providerSelect.value, cfg.model);
      }
    } catch (err) {
      showMessage('Грешка при зареждане на конфигурация: ' + err.message);
    } finally {
      hideLoading();
    }
  }

  async function loadConfigList() {
    showLoading();
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      const res = await fetch(`${WORKER_BASE_URL}/admin/keys`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const configs = data.keys
        .filter(k => k.startsWith('CONFIG:'))
        .map(k => k.slice(7));
      configSelect.innerHTML = '';
      configs.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        configSelect.appendChild(opt);
      });
      const activeRes = await fetch(`${WORKER_BASE_URL}/admin/get?key=ACTIVE_CONFIG`, { headers });
      if (activeRes.ok) {
        const activeData = await activeRes.json();
        let active;
        try {
          active = JSON.parse(activeData.value);
        } catch {
          active = activeData.value;
        }
        if (active && configs.includes(active)) {
          configSelect.value = active;
          configNameInput.value = active;
          await loadConfig(active);
        }
      }
    } catch (err) {
      showMessage('Грешка при зареждане на конфигурациите: ' + err.message);
    } finally {
      hideLoading();
    }
  }

  async function saveConfig(name, data) {
    const res = await fetch(`${WORKER_BASE_URL}/admin/put`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ key: `CONFIG:${name}`, value: JSON.stringify(data) })
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async function setActiveConfig(name) {
    const res = await fetch(`${WORKER_BASE_URL}/admin/set`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ key: 'ACTIVE_CONFIG', value: normalizeValue(name) })
    });
    if (!res.ok) throw new Error(await res.text());
  }
  async function loadConfigKV() {
    showLoading();
    try {
      const res = await fetch(`${WORKER_BASE_URL}/admin/keys`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const all = {};
      for (const k of data.keys) {
        const vRes = await fetch(`${WORKER_BASE_URL}/admin/get?key=${encodeURIComponent(k)}`, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        if (vRes.ok) {
          const vData = await vRes.json();
          try {
            all[k] = JSON.parse(vData.value);
          } catch {
            all[k] = vData.value;
          }
        }
      }
      viewer.textContent = JSON.stringify(all, null, 2);
    } catch (err) {
      showMessage('Грешка при извличането: ' + err.message);
    } finally {
      hideLoading();
    }
  }

  savePromptBtn.addEventListener('click', async () => {
    const prompt = promptEditor.value;
    showLoading();
    try {
      const res = await fetch(`${WORKER_BASE_URL}/admin/put`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ key: 'ROLE_PROMPT', value: JSON.stringify({ prompt }) })
      });
      if (!res.ok) throw new Error(await res.text());
      showMessage('Промптът е записан успешно', 'success');
    } catch (err) {
      showMessage('Грешка: ' + err.message);
    } finally {
      hideLoading();
    }
  });

  saveModelBtn.addEventListener('click', async () => {
    const provider = providerSelect.value;
    const model = modelSelect.value;
    showLoading();
    let providerVal, modelVal;
    try {
      providerVal = normalizeValue(provider);
      modelVal = normalizeValue(model);
    } catch (err) {
      hideLoading();
      showMessage('Невалиден JSON: ' + err.message);
      return;
    }
    try {
      const res1 = await fetch(`${WORKER_BASE_URL}/admin/set`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ key: 'AI_PROVIDER', value: providerVal })
      });
      if (!res1.ok) throw new Error(await res1.text());

      const res2 = await fetch(`${WORKER_BASE_URL}/admin/set`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ key: 'AI_MODEL', value: modelVal })
      });
      if (!res2.ok) throw new Error(await res2.text());
      showMessage('Моделът е записан успешно', 'success');
    } catch (err) {
      showMessage('Грешка: ' + err.message);
    } finally {
      hideLoading();
    }
  });

  providerSelect.addEventListener('change', () => {
    populateModelOptions(providerSelect.value);
  });

  configSelect.addEventListener('change', async () => {
    const name = configSelect.value;
    configNameInput.value = name;
    await loadConfig(name);
    try {
      await setActiveConfig(name);
    } catch (err) {
      showMessage('Грешка: ' + err.message);
    }
  });

  saveConfigBtn.addEventListener('click', async () => {
    const name = configNameInput.value.trim();
    if (!name) {
      showMessage('Въведете име на конфигурация');
      return;
    }
    const data = {
      prompt: promptEditor.value,
      provider: providerSelect.value,
      model: modelSelect.value
    };
    showLoading();
    try {
      await saveConfig(name, data);
      await setActiveConfig(name);
      await loadConfigList();
      showMessage('Конфигурацията е записана успешно', 'success');
    } catch (err) {
      showMessage('Грешка: ' + err.message);
    } finally {
      hideLoading();
    }
  });

  loadPrompt();
  loadModel();
  loadConfigKV();
  checkAnalysisKeys();
  loadConfigList();
});

