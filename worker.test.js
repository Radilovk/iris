import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { validateImageSize, fileToBase64, corsHeaders, getAIProvider, getAIModel, callOpenAIAPI, callGeminiAPI, fetchRagData } from './worker.js';
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
  const bigBuffer = Buffer.alloc(6 * 1024 * 1024, 0); // 6MB
  const bigFile = new File([bigBuffer], 'big.jpg', { type: 'image/jpeg' });
  await assert.rejects(() => validateImageSize(bigFile));
});

test('fileToBase64 работи за малък файл', async () => {
  const smallBuffer = Buffer.alloc(1024 * 1024, 0); // 1MB
  const smallFile = new File([smallBuffer], 'small.jpg', { type: 'image/jpeg' });
  const base64 = await fileToBase64(smallFile);
  assert.match(base64, /^[A-Za-z0-9+/=]+$/);
});

test('fileToBase64 обработва файл по-голям от 8KB', async () => {
  const buffer = Buffer.alloc(20 * 1024, 123); // 20KB
  const file = new File([buffer], 'chunk.jpg', { type: 'image/jpeg' });
  const expected = buffer.toString('base64');
  const result = await fileToBase64(file);
  assert.equal(result, expected);
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
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };
  await callOpenAIAPI('gpt-4o-mini', 'p', {}, 'a', 'b', env, false);
  globalThis.fetch = originalFetch;
});

test('Изборът Gemini/gemini-1.5-flash се подава към API', async () => {
  const env = { gemini_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.ok(url.includes('gemini-1.5-flash-latest'));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 });
  };
  await callGeminiAPI('gemini-1.5-flash', 'p', {}, 'a', 'b', env, false);
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
  await callOpenAIAPI('gpt-4o', 'p', { max_tokens: 77 }, 'a', 'b', env, false);
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
  await callGeminiAPI('gemini-1.5-pro', 'p', { maxOutputTokens: 88 }, 'a', 'b', env, false);
  globalThis.fetch = originalFetch;
});

test('callOpenAIAPI връща грешка при 404', async () => {
  const env = { openai_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 404 });
  await assert.rejects(
    () => callOpenAIAPI('gpt-4o', 'p', {}, 'a', 'b', env, false),
    /Моделът gpt-4o не е наличен/
  );
  globalThis.fetch = originalFetch;
});

test('callOpenAIAPI логва JSON и хвърля HTTP статус', async () => {
  const env = { openai_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'x' }), { status: 500 });
  await assert.rejects(
    () => callOpenAIAPI('gpt-4o', 'p', {}, 'a', 'b', env, false),
    /HTTP 500/
  );
  globalThis.fetch = originalFetch;
});

test('callGeminiAPI връща грешка при 404', async () => {
  const env = { gemini_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 404 });
  await assert.rejects(
    () => callGeminiAPI('gemini-1.5-flash', 'p', {}, 'a', 'b', env, false),
    /Моделът gemini-1.5-flash не е наличен/
  );
  globalThis.fetch = originalFetch;
});

test('callGeminiAPI логва JSON и хвърля HTTP статус', async () => {
  const env = { gemini_api_key: 'key' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'x' }), { status: 500 });
  await assert.rejects(
    () => callGeminiAPI('gemini-1.5-pro', 'p', {}, 'a', 'b', env, false),
    /HTTP 500/
  );
  globalThis.fetch = originalFetch;
});

test('handleAnalysisRequest връща 400 при празен OpenAI API ключ', async () => {
  const req = new Request('https://example.com/analyze', { method: 'POST' });
  const env = { AI_PROVIDER: 'openai', openai_api_key: '' };
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
  assert.equal(await res.text(), 'OpenAI API ключът липсва');
});

test('handleAnalysisRequest връща 400 при липсващ Gemini API ключ', async () => {
  const req = new Request('https://example.com/analyze', { method: 'POST' });
  const env = { AI_PROVIDER: 'gemini', gemini_api_key: '' };
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 400);
  assert.equal(await res.text(), 'Gemini API ключът липсва');
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

test('/admin/keys изисква Basic Auth', async () => {
  const reqNoAuth = new Request('https://example.com/admin/keys');
  const resNoAuth = await worker.fetch(reqNoAuth, {});
  assert.equal(resNoAuth.status, 401);

  const auth = 'Basic ' + Buffer.from('admin:pass').toString('base64');
  const env = {
    ADMIN_USER: 'admin',
    ADMIN_PASS: 'pass',
    iris_rag_kv: { list: async () => ({ keys: [] }) }
  };
  const reqAuth = new Request('https://example.com/admin/keys', {
    headers: { Authorization: auth }
  });
  const resAuth = await worker.fetch(reqAuth, env);
  assert.equal(resAuth.status, 200);
  assert.deepEqual(await resAuth.json(), { keys: [] });
});


test('/admin/secret връща наличност на OpenAI ключ и изисква Basic Auth', async () => {
  const reqNoAuth = new Request('https://example.com/admin/secret');
  const resNoAuth = await worker.fetch(reqNoAuth, {});
  assert.equal(resNoAuth.status, 401);

  const auth = 'Basic ' + Buffer.from('admin:pass').toString('base64');
  const envWithKey = { ADMIN_USER: 'admin', ADMIN_PASS: 'pass', openai_api_key: 'k' };
  const reqAuth1 = new Request('https://example.com/admin/secret', {
    headers: { Authorization: auth }
  });
  const resAuth1 = await worker.fetch(reqAuth1, envWithKey);
  assert.equal(resAuth1.status, 200);
  assert.deepEqual(await resAuth1.json(), { exists: true });

  const envWithoutKey = { ADMIN_USER: 'admin', ADMIN_PASS: 'pass' };
  const reqAuth2 = new Request('https://example.com/admin/secret', {
    headers: { Authorization: auth }
  });
  const resAuth2 = await worker.fetch(reqAuth2, envWithoutKey);
  assert.equal(resAuth2.status, 200);
  assert.deepEqual(await resAuth2.json(), { exists: false });
});

test('/admin/secret/gemini връща наличност на Gemini ключ и изисква Basic Auth', async () => {
  const reqNoAuth = new Request('https://example.com/admin/secret/gemini');
  const resNoAuth = await worker.fetch(reqNoAuth, {});
  assert.equal(resNoAuth.status, 401);

  const auth = 'Basic ' + Buffer.from('admin:pass').toString('base64');
  const envWithKey = { ADMIN_USER: 'admin', ADMIN_PASS: 'pass', gemini_api_key: 'k' };
  const reqAuth1 = new Request('https://example.com/admin/secret/gemini', {
    headers: { Authorization: auth }
  });
  const resAuth1 = await worker.fetch(reqAuth1, envWithKey);
  assert.equal(resAuth1.status, 200);
  assert.deepEqual(await resAuth1.json(), { exists: true });

  const envWithoutKey = { ADMIN_USER: 'admin', ADMIN_PASS: 'pass' };
  const reqAuth2 = new Request('https://example.com/admin/secret/gemini', {
    headers: { Authorization: auth }
  });
  const resAuth2 = await worker.fetch(reqAuth2, envWithoutKey);
  assert.equal(resAuth2.status, 200);
  assert.deepEqual(await resAuth2.json(), { exists: false });
});

test('/admin/sync връща грешка при липсваща конфигурация', async () => {
  const auth = 'Basic ' + Buffer.from('admin:pass').toString('base64');
  const req = new Request('https://example.com/admin/sync', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: '{}'
  });
  const env = { ADMIN_USER: 'admin', ADMIN_PASS: 'pass' };
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 500);
  assert.match(await res.text(), /Липсват конфигурационни променливи/);
});

test('/admin/diff връща грешка при липсваща конфигурация', async () => {
  const auth = 'Basic ' + Buffer.from('admin:pass').toString('base64');
  const req = new Request('https://example.com/admin/diff', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: '{}'
  });
  const env = { ADMIN_USER: 'admin', ADMIN_PASS: 'pass' };
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 500);
  assert.match(await res.text(), /Липсват конфигурационни променливи/);
});

test('/admin/sync синхронизира данни', async () => {
  const auth = 'Basic ' + Buffer.from('admin:pass').toString('base64');
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
    ADMIN_USER: 'admin',
    ADMIN_PASS: 'pass',
    CF_ACCOUNT_ID: 'acc',
    CF_KV_NAMESPACE_ID: 'ns',
    CF_API_TOKEN: 'token'
  };
  const req = new Request('https://example.com/admin/sync', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
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

