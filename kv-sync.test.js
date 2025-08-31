import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateKv, syncKv } from './kv-sync.js';

test('validateKv приема валиден ключ', () => {
  const data = { grouped: '{"findings":{}}' };
  const entries = validateKv(data);
  assert.deepEqual(entries, [{ key: 'grouped', value: '{"findings":{}}' }]);
});

test('validateKv хвърля грешка при невалиден ключ', () => {
  const data = { 'invalid-key': '{"a":1}' };
  assert.throws(() => validateKv(data));
});

test('validateKv маркира празни стойности за изтриване', () => {
  const data = { 'EMPTY': '""', 'EMPTY_OBJ': '{}' };
  const entries = validateKv(data);
  assert.deepEqual(entries, [
    { key: 'EMPTY', delete: true },
    { key: 'EMPTY_OBJ', delete: true }
  ]);
});

test('syncKv изчиства празните ключове', async () => {
  const originalFetch = global.fetch;
  let uploaded;
  global.fetch = async (url, opts) => {
    if (url.includes('/keys')) {
      return {
        ok: true,
        json: async () => ({
          result: [{ name: 'DROP1' }, { name: 'EXTRA' }],
          result_info: { list_complete: true }
        })
      };
    }
    uploaded = JSON.parse(opts.body);
    return { ok: true, text: async () => '' };
  };

  const entries = validateKv({ KEEP: '"ok"', DROP1: '""', DROP2: '{}', grouped: '{"findings":{}}' });
  const res = await syncKv(entries, { accountId: 'a', namespaceId: 'n', apiToken: 't' });

  assert.deepEqual(uploaded, [
    { key: 'KEEP', value: '"ok"' },
    { key: 'grouped', value: '{"findings":{}}' },
    { key: 'DROP1', delete: true },
    { key: 'DROP2', delete: true },
    { key: 'EXTRA', delete: true }
  ]);
  assert.deepEqual(res.updated.sort(), ['KEEP', 'grouped'].sort());
  assert.deepEqual(res.deleted.sort(), ['DROP1', 'DROP2', 'EXTRA'].sort());
  assert.deepEqual(res.groups, { KEEP: ['KEEP'], grouped: ['grouped'] });

  global.fetch = originalFetch;
});
