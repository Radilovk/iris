import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resizeImage, fileToBase64, corsHeaders } from './worker.js';

test('resizeImage връща грешка при твърде голям файл', async () => {
  const bigBuffer = Buffer.alloc(6 * 1024 * 1024, 0); // 6MB
  const bigFile = new File([bigBuffer], 'big.jpg', { type: 'image/jpeg' });
  await assert.rejects(() => resizeImage(bigFile));
});

test('fileToBase64 работи за малък файл', async () => {
  const smallBuffer = Buffer.alloc(1024 * 1024, 0); // 1MB
  const smallFile = new File([smallBuffer], 'small.jpg', { type: 'image/jpeg' });
  const base64 = await fileToBase64(smallFile, {});
  assert.match(base64, /^[A-Za-z0-9+/=]+$/);
});

test('corsHeaders поддържа wildcard "*"', () => {
  const request = new Request('https://api.example', { headers: { Origin: 'https://myapp.example' }});
  const headers = corsHeaders(request, { ALLOWED_ORIGINS: '*' });
  assert.equal(headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(headers.get('Vary'), null);
});

test('corsHeaders позволява конкретен домейн', () => {
  const request = new Request('https://api.example', { headers: { Origin: 'https://myapp.example' }});
  const env = { ALLOWED_ORIGINS: 'https://myapp.example,https://other.example' };
  const headers = corsHeaders(request, env);
  assert.equal(headers.get('Access-Control-Allow-Origin'), 'https://myapp.example');
  assert.equal(headers.get('Vary'), 'Origin');
});

test('corsHeaders връща null за неразрешен домейн', () => {
  const request = new Request('https://api.example', { headers: { Origin: 'https://evil.example' }});
  const headers = corsHeaders(request, { ALLOWED_ORIGINS: 'https://myapp.example' });
  assert.equal(headers.get('Access-Control-Allow-Origin'), 'null');
  assert.equal(headers.get('Vary'), 'Origin');
});
