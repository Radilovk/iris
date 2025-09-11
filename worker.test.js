import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

const env = {
  iris_config_kv: {
    get: (key) =>
      key === 'iris_config_kv'
        ? Promise.resolve({
            provider: 'gemini',
            analysis_prompt: '',
            analysis_model: 'gemini-1.5-flash-latest',
            report_prompt: '',
            report_model: 'gemini-1.5-flash-latest'
          })
        : Promise.resolve(null)
  }
};

test('Worker не използва браузърни API', () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.localStorage, 'undefined');
});

test('OPTIONS заявка връща CORS хедъри', async () => {
  const req = new Request('https://example.com', { method: 'OPTIONS' });
  const res = await worker.fetch(req, env, { waitUntil(){} });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://radilovk.github.io');
});

test('GET заявка връща 405', async () => {
  const req = new Request('https://example.com', { method: 'GET' });
  const res = await worker.fetch(req, env, { waitUntil(){} });
  assert.equal(res.status, 405);
});

test('POST без снимки връща 400', async () => {
  const form = new FormData();
  const req = new Request('https://example.com', { method: 'POST', body: form });
  const res = await worker.fetch(req, env, { waitUntil(){} });
  assert.equal(res.status, 400);
});
