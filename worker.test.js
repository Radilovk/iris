import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { resizeImage, fileToBase64, corsHeaders, getAIProvider, getAIModel, callOpenAIAPI, callGeminiAPI } from './worker.js';
import { KV_DATA } from './kv-data.js';

test('resizeImage връща грешка при твърде голям файл', async () => {
  const bigBuffer = Buffer.alloc(6 * 1024 * 1024, 0); // 6MB
  const bigFile = new File([bigBuffer], 'big.jpg', { type: 'image/jpeg' });
  await assert.rejects(() => resizeImage(bigFile));
});

test('fileToBase64 работи за малък файл', async () => {
  const smallBuffer = Buffer.alloc(1024 * 1024, 0); // 1MB
  const smallFile = new File([smallBuffer], 'small.jpg', { type: 'image/jpeg' });
  const base64 = await fileToBase64(smallFile);
  assert.match(base64, /^[A-Za-z0-9+/=]+$/);
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
  const env = { iris_rag_kv: { get: async () => 'gemini-1.5-flash' } };
  assert.equal(await getAIModel(env), 'gemini-1.5-flash');
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

