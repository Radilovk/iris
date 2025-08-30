import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateKv } from './kv-sync.js';

test('validateKv приема валиден ключ', () => {
  const data = { 'VALID_KEY': '{"a":1}' };
  const entries = validateKv(data);
  assert.deepEqual(entries, [{ key: 'VALID_KEY', value: '{"a":1}' }]);
});

test('validateKv хвърля грешка при невалиден ключ', () => {
  const data = { 'invalid-key': '{"a":1}' };
  assert.throws(() => validateKv(data));
});
