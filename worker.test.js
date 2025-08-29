import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { validateImageSize, fileToBase64, corsHeaders, getAIProvider, getAIModel, callOpenAIAPI, callGeminiAPI, fetchRagData, fetchExternalInfo, generateSummary } from './worker.js';
import { KV_DATA } from './kv-data.js';

test('Worker не използва браузърни API', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.localStorage, 'undefined');
});

test('ROLE_PROMPT съдържа ключ missing_data', () => {
  const data = JSON.parse(KV_DATA.ROLE_PROMPT);
  assert.ok(Object.hasOwn(data, 'missing_data'));
  assert.equal(typeof data.missing_data, 'string');
});

test('validateImageSize връща грешка при твърде голям файл', async () => {
  const bigBuffer = Buffer.alloc(11 * 1024 * 1024, 0); // 11MB
  const bigFile = new File([bigBuffer], 'big.jpg', { type: 'image/jpeg' });
  await assert.rejects(() => validateImageSize(bigFile));
});

test('fileToBase64 работи за малък файл', async () => {
  const smallBuffer = Buffer.alloc(1024 * 1024, 0); // 1MB
  const smallFile = new File([smallBuffer], 'small.jpg', { type: 'image/jpeg' });
  const result = await fileToBase64(smallFile);
  assert.match(result.data, /^[A-Za-z0-9+/=]+$/);
  assert.equal(result.type, 'image/jpeg');
});

test('fileToBase64 обработва файл по-голям от 8KB', async () => {
  const buffer = Buffer.alloc(20 * 1024, 123); // 20KB
  const file = new File([buffer], 'chunk.jpg', { type: 'image/jpeg' });
  const expected = buffer.toString('base64');
  const result = await fileToBase64(file);
  assert.equal(result.data, expected);
  assert.equal(result.type, 'image/jpeg');
});

test('corsHeaders поддържа wildcard "*"', () => {
  const request = new Request('https://api.example', { headers: { Origin: 'https://myapp.example' }});
  const headers = corsHeaders(request, { allowed_origin: '*' });
  assert.equal(headers.get('Access-Control-Allow-Origin'), 'https://myapp.example');
  assert.equal(headers.get('Vary'), 'Origin');
});

test('corsHeaders добавя Allow-Credentials при Authorization', () => {
  const request = new Request('https://api.example', {
    headers: { Origin: 'https://myapp.example', Authorization: 'Basic abc' }
  });
  const headers = corsHeaders(request, { allowed_origin: '*' });
  assert.equal(headers.get('Access-Control-Allow-Credentials'), 'true');
});

test('corsHeaders позволява конкретен домейн', () => {
  const request = new Request('https://api.example', { headers: { Origin: 'https://myapp.example' }});
  const env = { allowed_origin: 'https://myapp.example,https://other.example' };
  const headers = corsHeaders(request, env);
  assert.equal(headers.get('Access-Control-Allow-Origin'), 'https://myapp.example');
  assert.equal(headers.get('Vary'), 'Origin');
});

test('corsHeaders обработва домейни с интервали', () => {
  const request = new Request('https://api.example', { headers: { Origin: 'https://a.com' }});
  const env = { allowed_origin: 'https://a.com, https://b.com' };
  const headers = corsHeaders(request, env);
  assert.equal(headers.get('Access-Control-Allow-Origin'), 'https://a.com');
  assert.equal(headers.get('Vary'), 'Origin');
});

test('corsHeaders връща null за неразрешен домейн', () => {
  const request = new Request('https://api.example', { headers: { Origin: 'https://evil.example' }});
  const headers = corsHeaders(request, { allowed_origin: 'https://myapp.example' });
  assert.equal(headers.get('Access-Control-Allow-Origin'), 'null');
  assert.equal(headers.get('Vary'), 'Origin');
});

test('corsHeaders включва всички методи', () => {
  const request = new Request('https://api.example', { headers: { Origin: 'https://foo.example' }});
  const headers = corsHeaders(request, { allowed_origin: '*' });
  assert.equal(headers.get('Access-Control-Allow-Methods'), 'GET, POST, PUT, DELETE, OPTIONS');
});

test('corsHeaders добавя Access-Control-Max-Age', () => {
  const request = new Request('https://api.example', { headers: { Origin: 'https://foo.example' }});
  const headers = corsHeaders(request, { allowed_origin: '*' });
  assert.equal(headers.get('Access-Control-Max-Age'), '86400');
});

test('getAIProvider избира "gemini" по подразбиране', async () => {
  assert.equal(await getAIProvider({}), 'gemini');
});

test('getAIProvider може да избира OpenAI', async () => {
  assert.equal(await getAIProvider({ AI_PROVIDER: 'openai' }), 'openai');
});

test('getAIProvider чете стойност от KV', async () => {
  const env = { iris_rag_kv: { get: async () => 'openai' } };
  assert.equal(await getAIProvider(env), 'openai');
});

test('getAIModel връща стойност по подразбиране според доставчика', async () => {
  assert.equal(await getAIModel({ AI_PROVIDER: 'openai' }), 'gpt-4o');
  assert.equal(await getAIModel({ AI_PROVIDER: 'gemini' }), 'gemini-1.5-pro');
});

test('getAIModel може да чете от env и KV', async () => {
  assert.equal(await getAIModel({ AI_MODEL: 'gpt-4o-mini' }), 'gpt-4o-mini');
  const env = {
    iris_rag_kv: {
      get: async (key, type) => {
        assert.equal(key, 'AI_MODEL');
        assert.equal(type, 'json');
        return 'gemini-1.5-flash';
      }
    }
  };
  assert.equal(await getAIModel(env), 'gemini-1.5-flash');
});

test('getAIModel игнорира празни или невалидни стойности от KV', async () => {
  const emptyEnv = {
    iris_rag_kv: { get: async () => null },
    AI_PROVIDER: 'openai'
  };
  assert.equal(await getAIModel(emptyEnv), 'gpt-4o');

  const invalidEnv = {
    iris_rag_kv: { get: async () => 123 },
    AI_PROVIDER: 'openai'
  };
  assert.equal(await getAIModel(invalidEnv), 'gpt-4o');
});

test('Изборът OpenAI/gpt-4o-mini се подава към API', async () => {
  const env = { openai_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-4o-mini');
    assert.equal(body.messages[0].content[1].image_url.url, 'data:image/png;base64,a');
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };
  await callOpenAIAPI('gpt-4o-mini', 'p', {}, { data: 'a', type: 'image/png' }, { data: 'b', type: 'image/png' }, env, false);
  globalThis.fetch = originalFetch;
});

test('Изборът Gemini/gemini-1.5-flash се подава към API', async () => {
  const env = { gemini_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.ok(url.includes('gemini-1.5-flash-latest'));
    const body = JSON.parse(options.body);
    assert.equal(body.contents[0].parts[1].inline_data.mime_type, 'image/png');
    assert.equal(body.contents[0].parts[1].inline_data.data, 'a');
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 });
  };
  await callGeminiAPI('gemini-1.5-flash', 'p', {}, { data: 'a', type: 'image/png' }, { data: 'b', type: 'image/png' }, env, false);
  globalThis.fetch = originalFetch;
});

test('callOpenAIAPI изпраща json_schema и връща масив при expectJson=true', async () => {
  const env = { openai_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.response_format, {
      type: 'json_schema',
      json_schema: {
        name: 'rag_keys',
        schema: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          additionalItems: false
        }
      }
    });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '["x","y"]' } }] }),
      { status: 200 }
    );
  };
  const result = await callOpenAIAPI(
    'gpt-4o',
    'p',
    {},
    { data: 'a', type: 'image/png' },
    { data: 'b', type: 'image/png' },
    env,
    true
  );
  assert.deepEqual(JSON.parse(result), ['x', 'y']);
  globalThis.fetch = originalFetch;
});

test('callOpenAIAPI изпраща max_tokens', async () => {
  const env = { openai_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.max_tokens, 77);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };
  await callOpenAIAPI('gpt-4o', 'p', { max_tokens: 77 }, { data: 'a', type: 'image/png' }, { data: 'b', type: 'image/png' }, env, false);
  globalThis.fetch = originalFetch;
});

test('callGeminiAPI изпраща generationConfig.maxOutputTokens', async () => {
  const env = { gemini_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.maxOutputTokens, 88);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 });
  };
  await callGeminiAPI('gemini-1.5-pro', 'p', { maxOutputTokens: 88 }, { data: 'a', type: 'image/png' }, { data: 'b', type: 'image/png' }, env, false);
  globalThis.fetch = originalFetch;
});

test('callOpenAIAPI връща грешка при 404', async () => {
  const env = { openai_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 404 });
  await assert.rejects(
    () => callOpenAIAPI('gpt-4o', 'p', {}, { data: 'a', type: 'image/png' }, { data: 'b', type: 'image/png' }, env, false),
    /Моделът gpt-4o не е наличен/
  );
  globalThis.fetch = originalFetch;
});

test('callOpenAIAPI логва JSON и хвърля HTTP статус', async () => {
  const env = { openai_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'x' }), { status: 500 });
  await assert.rejects(
    () => callOpenAIAPI('gpt-4o', 'p', {}, { data: 'a', type: 'image/png' }, { data: 'b', type: 'image/png' }, env, false),
    /HTTP 500/
  );
  globalThis.fetch = originalFetch;
});

test('callGeminiAPI връща грешка при 404', async () => {
  const env = { gemini_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 404 });
  await assert.rejects(
    () => callGeminiAPI('gemini-1.5-flash', 'p', {}, { data: 'a', type: 'image/png' }, { data: 'b', type: 'image/png' }, env, false),
    /Моделът gemini-1.5-flash не е наличен/
  );
  globalThis.fetch = originalFetch;
});

test('callGeminiAPI логва JSON и хвърля HTTP статус', async () => {
  const env = { gemini_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'x' }), { status: 500 });
  await assert.rejects(
    () => callGeminiAPI('gemini-1.5-pro', 'p', {}, { data: 'a', type: 'image/png' }, { data: 'b', type: 'image/png' }, env, false),
    /HTTP 500/
  );
  globalThis.fetch = originalFetch;
});

test('handleAnalysisRequest връща 400 при празен OpenAI API ключ', async () => {
  const req = new Request('https://example.com/analyze', { method: 'POST' });
  const env = { AI_PROVIDER: 'openai', openai_api_key: '' };
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'OpenAI API ключът липсва' });
});

test('handleAnalysisRequest връща 400 при липсващ Gemini API ключ', async () => {
  const req = new Request('https://example.com/analyze', { method: 'POST' });
  const env = { AI_PROVIDER: 'gemini', gemini_api_key: '' };
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Gemini API ключът липсва' });
});

test('handleAnalysisRequest връща 400 при липсващи изображения', async () => {
  const form = new FormData();
  const req = new Request('https://example.com/analyze', { method: 'POST', body: form });
  const env = { AI_PROVIDER: 'gemini', gemini_api_key: 'k' };
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Не е подадено изображение.' });
});

test('handleAnalysisRequest връща контролирано съобщение при невалиден AI JSON', async () => {
  const buf = Buffer.alloc(10, 0);
  const form = new FormData();
  form.append('left-eye', new File([buf], 'l.jpg', { type: 'image/jpeg' }));
  form.append('right-eye', new File([buf], 'r.jpg', { type: 'image/jpeg' }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'няма json' } }] }), { status: 200 });

  const req = new Request('https://example.com/analyze', { method: 'POST', body: form });
  const env = { AI_PROVIDER: 'openai', openai_api_key: 'k' };
  const res = await worker.fetch(req, env);

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error.includes('Очакван JSON масив'));

  globalThis.fetch = originalFetch;
});

test('handleAnalysisRequest връща грешка при отговор { error: ... }', async () => {
  const buf = Buffer.alloc(10, 0);
  const form = new FormData();
  form.append('left-eye', new File([buf], 'l.jpg', { type: 'image/jpeg' }));
  form.append('right-eye', new File([buf], 'r.jpg', { type: 'image/jpeg' }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ error: 'AI грешка' }) } }] }),
      { status: 200 }
    );

  const req = new Request('https://example.com/analyze', { method: 'POST', body: form });
  const env = { AI_PROVIDER: 'openai', openai_api_key: 'k' };
  const res = await worker.fetch(req, env);

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'AI грешка' });

  globalThis.fetch = originalFetch;
});

test('handleAnalysisRequest улавя грешка чрез наследено поле', async () => {
  const buf = Buffer.alloc(10, 0);
  const form = new FormData();
  form.append('left-eye', new File([buf], 'l.jpg', { type: 'image/jpeg' }));
  form.append('right-eye', new File([buf], 'r.jpg', { type: 'image/jpeg' }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ error: 'AI грешка' }) } }] }),
      { status: 200 }
    );

  const originalParse = JSON.parse;
  JSON.parse = (str) => {
    if (str === JSON.stringify({ error: 'AI грешка' })) {
      return Object.create({ error: 'AI грешка' });
    }
    return originalParse(str);
  };

  const req = new Request('https://example.com/analyze', { method: 'POST', body: form });
  const env = { AI_PROVIDER: 'openai', openai_api_key: 'k' };
  const res = await worker.fetch(req, env);

  JSON.parse = originalParse;

  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'AI грешка' });

  globalThis.fetch = originalFetch;
});

test('/admin/keys връща списък с ключове', async () => {
  const req = new Request('https://example.com/admin/keys');
  const env = {
    iris_rag_kv: { list: async () => ({ keys: [] }) }
  };
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { keys: [] });
});


test('/admin/secret връща наличност на OpenAI ключ', async () => {
  const req1 = new Request('https://example.com/admin/secret');
  const envWithKey = { openai_api_key: 'k' };
  const res1 = await worker.fetch(req1, envWithKey);
  assert.equal(res1.status, 200);
  assert.deepEqual(await res1.json(), { exists: true });

  const req2 = new Request('https://example.com/admin/secret');
  const res2 = await worker.fetch(req2, {});
  assert.equal(res2.status, 200);
  assert.deepEqual(await res2.json(), { exists: false });
});

test('/admin/secret/gemini връща наличност на Gemini ключ', async () => {
  const req1 = new Request('https://example.com/admin/secret/gemini');
  const envWithKey = { gemini_api_key: 'k' };
  const res1 = await worker.fetch(req1, envWithKey);
  assert.equal(res1.status, 200);
  assert.deepEqual(await res1.json(), { exists: true });

  const req2 = new Request('https://example.com/admin/secret/gemini');
  const res2 = await worker.fetch(req2, {});
  assert.equal(res2.status, 200);
  assert.deepEqual(await res2.json(), { exists: false });
});

test('/admin/sync връща грешка при липсваща конфигурация', async () => {
  const req = new Request('https://example.com/admin/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  const res = await worker.fetch(req, {});
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.match(body.error, /Липсват конфигурационни променливи/);
});

test('/admin/diff връща грешка при липсваща конфигурация', async () => {
  const req = new Request('https://example.com/admin/diff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  const res = await worker.fetch(req, {});
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.match(body.error, /Липсват конфигурационни променливи/);
});

test('/admin/sync синхронизира данни', async () => {
  const store = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = typeof url === 'string' ? new URL(url) : url;
    if (u.pathname.endsWith('/keys')) {
      return new Response(JSON.stringify({ result: Object.keys(store).map(name => ({ name })), result_info: { list_complete: true } }), { status: 200 });
    }
    if (u.pathname.endsWith('/bulk')) {
      const body = JSON.parse(options.body);
      for (const entry of body) {
        if (entry.delete) delete store[entry.key];
        else store[entry.key] = entry.value;
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };

  const env = {
    CF_ACCOUNT_ID: 'acc',
    CF_KV_NAMESPACE_ID: 'ns',
    CF_API_TOKEN: 'token'
  };
  const req = new Request('https://example.com/admin/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(KV_DATA)
  });
  const res = await worker.fetch(req, env);
  globalThis.fetch = originalFetch;
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.deleted.length, 0);
  const expectedKeys = Object.keys(KV_DATA).sort();
  assert.deepEqual(body.updated.sort(), expectedKeys);
  assert.deepEqual(Object.keys(store).sort(), expectedKeys);
});

test('fetchRagData използва кеша при второ извикване', async () => {
  const store = new Map();
  globalThis.caches = {
    default: {
      match: async req => store.get(req.url) || null,
      put: async (req, res) => { store.set(req.url, res); }
    }
  };
  let kvCalls = 0;
  const env = {
    iris_rag_kv: {
      get: async () => { kvCalls++; return { v: 1 }; }
    },
    RAG_CACHE_TTL: '60'
  };
  const first = await fetchRagData(['a'], env);
  assert.equal(kvCalls, 1);
  const second = await fetchRagData(['a'], env);
  assert.equal(kvCalls, 1);
  assert.deepEqual(first, second);
  delete globalThis.caches;
});

test('fetchRagData извлича само данни за DISPOSITION_ACIDITY', async () => {
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  const fetched = [];
  const env = {
    iris_rag_kv: {
      get: async key => { fetched.push(key); return { key }; }
    }
  };
  const data = await fetchRagData({ DISPOSITION: ['DISPOSITION_ACIDITY'] }, env);
  assert.deepEqual(fetched, ['DISPOSITION_ACIDITY']);
  assert.deepEqual(data, { DISPOSITION: { 'DISPOSITION_ACIDITY': { key: 'DISPOSITION_ACIDITY' } } });
  delete globalThis.caches;
});

test('fetchRagData извлича новите ключове', async () => {
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  const env = {
    iris_rag_kv: {
      get: async key => {
        if (key === 'RECOMMENDATION_HYDRATION') return { water: true };
        if (key === 'DISPOSITION_LYMPHATIC') return { lymph: true };
        return null;
      }
    }
  };
  const data = await fetchRagData({
    RECOMMENDATION: ['RECOMMENDATION_HYDRATION'],
    DISPOSITION: ['DISPOSITION_LYMPHATIC']
  }, env);
  assert.deepEqual(data, {
    RECOMMENDATION: { RECOMMENDATION_HYDRATION: { water: true } },
    DISPOSITION: { DISPOSITION_LYMPHATIC: { lymph: true } }
  });
  delete globalThis.caches;
});

test('fetchRagData логва едно предупреждение за липсващи ключове', async () => {
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  const env = { iris_rag_kv: { get: async () => null } };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = msg => warnings.push(msg);

  await fetchRagData(['a', 'b'], env);

  console.warn = originalWarn;
  assert.deepEqual(warnings, ['Липсващи RAG ключове: a, b']);
  delete globalThis.caches;
});

test('handleAnalysisRequest преобразува алиасите към канонични ключове', async () => {
  const buf = Buffer.alloc(10, 0);
  const form = new FormData();
  form.append('left-eye', new File([buf], 'l.jpg', { type: 'image/jpeg' }));
  form.append('right-eye', new File([buf], 'r.jpg', { type: 'image/jpeg' }));
  const req = new Request('https://example.com/analyze', { method: 'POST', body: form });

  const fetched = [];
  const env = {
    AI_PROVIDER: 'openai',
    openai_api_key: 'k',
    iris_rag_kv: {
      get: async key => {
        if (key === 'AI_MODEL') return 'gpt-4o';
        if (key === 'ROLE_PROMPT') return { prompt: '' };
        fetched.push(key);
        return { ok: true };
      },
      put: async () => {}
    }
  };
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };

  const responses = [
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(['SIGN_RADIAL_FURROW']) } }] }),
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ holistic_analysis: 'ok' }) } }] })
  ];
  let idx = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(responses[idx++], { status: 200 });

  const res = await worker.fetch(req, env);

  globalThis.fetch = originalFetch;
  delete globalThis.caches;

  assert.equal(res.status, 200);
  assert.deepEqual(fetched, ['SIGN_IRIS_RADII_SOLARIS']);
});

test('fetchExternalInfo връща null без предупреждение при липсващи ключове', async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = msg => warnings.push(msg);

  const result = await fetchExternalInfo('test', {});

  console.warn = originalWarn;
  assert.equal(result, null);
  assert.deepEqual(warnings, []);
});

test('generateSummary добавя actions от ragRecords.support', async () => {
  const env = { AI_PROVIDER: 'openai', AI_MODEL: 'gpt-4o-mini', openai_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 's', holistic_analysis: 'h' }) } }] }),
    { status: 200 }
  );
  const res = await generateSummary(['SIGN_A'], { support: ['Drink water'] }, env);
  globalThis.fetch = originalFetch;
  assert.deepEqual(res.actions, ['Drink water']);
});

test('handleAnalysisRequest пропуска извличането на публични източници при липса на Google ключове', async () => {
  const buf = Buffer.alloc(10, 0);
  const form = new FormData();
  form.append('left-eye', new File([buf], 'l.jpg', { type: 'image/jpeg' }));
  form.append('right-eye', new File([buf], 'r.jpg', { type: 'image/jpeg' }));
  const req = new Request('https://example.com/analyze', { method: 'POST', body: form });

  const env = { AI_PROVIDER: 'openai', openai_api_key: 'k', iris_rag_kv: { get: async () => null, put: async () => {} } };
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };

  const responses = [
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(['нервна система']) } }] }),
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ holistic_analysis: 'ok' }) } }] })
  ];
  let idx = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(responses[idx++], { status: 200 });

  const res = await worker.fetch(req, env);

  globalThis.fetch = originalFetch;
  delete globalThis.caches;

  assert.equal(res.status, 200);
  assert.equal(idx, 2);
});

