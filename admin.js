import { KV_DATA } from './kv-data.js';
import { WORKER_BASE_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
  const syncBtn = document.getElementById('sync-btn');
  const uploadBtn = document.getElementById('upload-btn');
  const listEl = document.getElementById('kv-list');
  const viewer = document.getElementById('kv-viewer');
  const loadingEl = document.getElementById('loading');
  const messageBox = document.getElementById('message-box');
  const promptEditor = document.getElementById('role-prompt');
  const savePromptBtn = document.getElementById('save-prompt');
  const providerSelect = document.getElementById('provider-select');
  const modelSelect = document.getElementById('model-select');
  const saveModelBtn = document.getElementById('save-model');
  const newModelInput = document.getElementById('new-model');
  const addModelBtn = document.getElementById('add-model');
  const modelListEl = document.getElementById('model-list');

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

  function renderModelList(provider) {
    modelListEl.innerHTML = '';
    (MODEL_OPTIONS[provider] || []).forEach(m => {
      const li = document.createElement('li');
      li.textContent = m + ' ';
      const btn = document.createElement('button');
      btn.textContent = 'Изтрий';
      btn.className = 'delete-model';
      btn.dataset.model = m;
      li.appendChild(btn);
      modelListEl.appendChild(li);
    });
  }

  async function saveModelOptions() {
    const res = await fetch(`${WORKER_BASE_URL}/admin/put`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ key: 'MODEL_OPTIONS', value: JSON.stringify(MODEL_OPTIONS) })
    });
    if (!res.ok) throw new Error(await res.text());
  }

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
      renderModelList(provider);
    } catch (err) {
      showMessage('Грешка при зареждане на модела: ' + err.message);
    } finally {
      hideLoading();
    }
  }

  async function loadKeys() {
    listEl.innerHTML = '';
    showLoading();
    try {
        const res = await fetch(`${WORKER_BASE_URL}/admin/keys`, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      data.keys.forEach(k => {
        const li = document.createElement('li');
        li.textContent = k;
        li.addEventListener('click', () => showKey(k));
        listEl.appendChild(li);
      });
    } catch (err) {
      showMessage('Грешка при извличането: ' + err.message);
    } finally {
      hideLoading();
    }
  }

  async function showKey(key) {
    showLoading();
    try {
        const res = await fetch(`${WORKER_BASE_URL}/admin/get?key=${encodeURIComponent(key)}`, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      let val = data.value || '';
      try { val = JSON.stringify(JSON.parse(val), null, 2); } catch {}
      viewer.textContent = val;
      viewer.style.display = 'block';
    } catch (err) {
      showMessage('Грешка: ' + err.message);
    } finally {
      hideLoading();
    }
  }

  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    showLoading();
    try {
      const diffRes = await fetch(`${WORKER_BASE_URL}/admin/diff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(KV_DATA)
      });
      if (!diffRes.ok) throw new Error(await diffRes.text());
      const diff = await diffRes.json();
      showMessage(
        `Разлики - нови: ${diff.added.length}, промени: ${diff.changed.length}, изтрити: ${diff.deleted.length}`,
        'warn'
      );

      const syncRes = await fetch(`${WORKER_BASE_URL}/admin/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(KV_DATA)
      });
      if (!syncRes.ok) throw new Error(await syncRes.text());
      const result = await syncRes.json();
      showMessage(
        `Синхронизирано. Обновени: ${result.updated.length}, изтрити: ${result.deleted.length}`,
        'success'
      );
      await loadKeys();
    } catch (err) {
      showMessage('Грешка: ' + err.message);
    } finally {
      hideLoading();
      syncBtn.disabled = false;
    }
  });

  uploadBtn.addEventListener('click', async () => {
    uploadBtn.disabled = true;
    showLoading();
    try {
      const res = await fetch(`${WORKER_BASE_URL}/admin/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(KV_DATA)
      });
      if (!res.ok) throw new Error(await res.text());
      showMessage('Ключовете са качени успешно', 'success');
      await loadKeys();
    } catch (err) {
      showMessage('Грешка: ' + err.message);
    } finally {
      hideLoading();
      uploadBtn.disabled = false;
    }
  });

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

  addModelBtn.addEventListener('click', async () => {
    const provider = providerSelect.value.trim();
    if (!provider) {
      showMessage('Моля, изберете доставчик');
      return;
    }
    const model = newModelInput.value.trim();
    if (!model) {
      showMessage('Въведете име на модел');
      return;
    }
    if (!MODEL_OPTIONS[provider]) MODEL_OPTIONS[provider] = [];
    if (MODEL_OPTIONS[provider].includes(model)) return;
    showLoading();
    try {
      MODEL_OPTIONS[provider].push(model);
      await saveModelOptions();
      showMessage('Моделът е добавен', 'success');
      populateModelOptions(provider, model);
      renderModelList(provider);
      newModelInput.value = '';
    } catch (err) {
      showMessage('Грешка: ' + err.message);
    } finally {
      hideLoading();
    }
  });

  modelListEl.addEventListener('click', async (e) => {
    if (e.target.classList.contains('delete-model')) {
      const provider = providerSelect.value;
      const model = e.target.dataset.model;
      showLoading();
      try {
        MODEL_OPTIONS[provider] = (MODEL_OPTIONS[provider] || []).filter(m => m !== model);
        await saveModelOptions();
        showMessage('Моделът е изтрит', 'success');
        populateModelOptions(provider);
        renderModelList(provider);
      } catch (err) {
        showMessage('Грешка: ' + err.message);
      } finally {
        hideLoading();
      }
    }
  });

  providerSelect.addEventListener('change', () => {
    populateModelOptions(providerSelect.value);
    renderModelList(providerSelect.value);
  });

  loadPrompt();
  loadModel();
  loadKeys();
  checkAnalysisKeys();
});

