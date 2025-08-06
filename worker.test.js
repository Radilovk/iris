import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resizeImage, fileToBase64 } from './worker.js';

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
