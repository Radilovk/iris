import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockAgent, setGlobalDispatcher, Agent } from 'undici';
import worker, { resizeImage, fileToBase64, corsHeaders, getAIProvider } from './worker.js';

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
  assert.equal(headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(headers.get('Vary'), null);
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

test('getAIProvider избира "gemini" по подразбиране', () => {
  assert.equal(getAIProvider({}), 'gemini');
});

test('getAIProvider може да избира OpenAI', () => {
  assert.equal(getAIProvider({ AI_PROVIDER: 'openai' }), 'openai');
});

test('/admin/keys изисква Basic Auth', async () => {
  const reqNoAuth = new Request('https://example.com/admin/keys');
  const resNoAuth = await worker.fetch(reqNoAuth, {});
  assert.equal(resNoAuth.status, 401);

  const mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  const cf = mockAgent.get('https://api.cloudflare.com');
  cf.intercept({
    path: '/client/v4/accounts/accid/storage/kv/namespaces/ns/keys',
    method: 'GET',
    query: { limit: '1000' }
  }).reply(200, { result: [], result_info: { list_complete: true } });

  const auth = 'Basic ' + Buffer.from('admin:pass').toString('base64');
  const env = {
    ADMIN_USER: 'admin',
    ADMIN_PASS: 'pass',
    CF_ACCOUNT_ID: 'accid',
    CF_KV_NAMESPACE_ID: 'ns',
    CF_API_TOKEN: 'tok'
  };
  const reqAuth = new Request('https://example.com/admin/keys', {
    headers: { Authorization: auth }
  });
  const resAuth = await worker.fetch(reqAuth, env);
  assert.equal(resAuth.status, 200);
  assert.deepEqual(await resAuth.json(), { keys: [] });

  mockAgent.assertNoPendingInterceptors();
  mockAgent.close();
  setGlobalDispatcher(new Agent());
});

