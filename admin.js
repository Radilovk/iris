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
  let currentConfig = {};

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

  async function loadActiveConfig() {
    showLoading();
    try {
      const headers = {
        'Content-Type': 'application/json'
      };
      await hasGeminiKey();
      await hasOpenAIKey();
      const res = await fetch(`${WORKER_BASE_URL}/admin/get?key=iris_config_kv`, { headers });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      currentConfig = JSON.parse(data.value || '{}');
      promptEditor.value = currentConfig.report_prompt || '';
      populateProviderOptions(currentConfig.provider);
      populateModelOptions(currentConfig.provider, currentConfig.analysis_model || currentConfig.report_model);
      if (currentConfig.name) {
        configNameInput.value = currentConfig.name;
        configSelect.value = currentConfig.name;
      }
    } catch (err) {
      showMessage('Грешка при зареждане на конфигурация: ' + err.message);
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
      currentConfig = { ...cfg, name };
      promptEditor.value = cfg.report_prompt || '';
      populateProviderOptions(cfg.provider);
      populateModelOptions(cfg.provider, cfg.analysis_model || cfg.report_model);
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
      await loadActiveConfig();
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

  async function setActiveConfig(cfg) {
    const res = await fetch(`${WORKER_BASE_URL}/admin/set`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ key: 'iris_config_kv', value: JSON.stringify(cfg) })
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
    currentConfig.report_prompt = promptEditor.value;
    showLoading();
    try {
      await saveConfig(currentConfig.name || 'default', currentConfig);
      await setActiveConfig(currentConfig);
      showMessage('Промптът е записан успешно', 'success');
    } catch (err) {
      showMessage('Грешка: ' + err.message);
    } finally {
      hideLoading();
    }
  });

  saveModelBtn.addEventListener('click', async () => {
    currentConfig.provider = providerSelect.value;
    currentConfig.analysis_model = currentConfig.report_model = modelSelect.value;
    showLoading();
    try {
      await saveConfig(currentConfig.name || 'default', currentConfig);
      await setActiveConfig(currentConfig);
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
    if (!name) return;
    await loadConfig(name);
    configNameInput.value = name;
    try {
      await setActiveConfig(currentConfig);
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
      name,
      analysis_prompt: currentConfig.analysis_prompt || '',
      report_prompt: promptEditor.value,
      provider: providerSelect.value,
      analysis_model: modelSelect.value,
      report_model: modelSelect.value
    };
    showLoading();
    try {
      await saveConfig(name, data);
      await setActiveConfig(data);
      await loadConfigList();
      showMessage('Конфигурацията е записана успешно', 'success');
    } catch (err) {
      showMessage('Грешка: ' + err.message);
    } finally {
      hideLoading();
    }
  });

  loadConfigKV();
  checkAnalysisKeys();
  loadConfigList();
});

