import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateKv, syncKv } from './kv-sync.js';

test('validateKv приема валиден ключ', () => {
  const data = { 'grouped:findings': '{"a":1}' };
  const entries = validateKv(data);
  assert.deepEqual(entries, [{ key: 'grouped:findings', value: '{"a":1}' }]);
});

test('validateKv хвърля грешка при невалиден ключ', () => {
  const data = { 'invalid-key': '{"a":1}' };
  assert.throws(() => validateKv(data));
});

test('validateKv маркира празни стойности за изтриване', () => {
  const data = {
    'EMPTY': '""',
    'EMPTY_OBJ': '{}',
    'NULL': 'null',
    'SPACES': '"   "'
  };
  const entries = validateKv(data);
  assert.deepEqual(entries, [
    { key: 'EMPTY', delete: true },
    { key: 'EMPTY_OBJ', delete: true },
    { key: 'NULL', delete: true },
    { key: 'SPACES', delete: true }
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

  const entries = validateKv({
    KEEP: '"ok"',
    DROP1: '""',
    DROP2: '{}',
    DROP3: 'null',
    DROP4: '"   "',
    'grouped:findings': '{"a":1}'
  });
  const res = await syncKv(entries, { accountId: 'a', namespaceId: 'n', apiToken: 't' });

  assert.deepEqual(uploaded, [
    { key: 'KEEP', value: '"ok"' },
    { key: 'grouped:findings', value: '{"a":1}' },
    { key: 'DROP1', delete: true },
    { key: 'DROP2', delete: true },
    { key: 'DROP3', delete: true },
    { key: 'DROP4', delete: true },
    { key: 'EXTRA', delete: true }
  ]);
  assert.deepEqual(res.updated.sort(), ['KEEP', 'grouped:findings'].sort());
  assert.deepEqual(
    res.deleted.sort(),
    ['DROP1', 'DROP2', 'DROP3', 'DROP4', 'EXTRA'].sort()
  );
  assert.deepEqual(res.groups, { KEEP: ['KEEP'], grouped: ['grouped:findings'] });

  global.fetch = originalFetch;
});
