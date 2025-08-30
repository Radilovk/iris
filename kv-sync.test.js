import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateKv, syncKv } from './kv-sync.js';

test('syncKv премахва празни стойности', async () => {
  const data = {
    KEEP: '"value"',
    EMPTY_STRING: '""',
    EMPTY_OBJECT: '{}'
  };
  const entries = validateKv(data);
  assert.deepEqual(entries.find(e => e.key === 'KEEP'), { key: 'KEEP', value: '"value"' });
  assert.deepEqual(entries.find(e => e.key === 'EMPTY_STRING'), { key: 'EMPTY_STRING', delete: true });
  assert.deepEqual(entries.find(e => e.key === 'EMPTY_OBJECT'), { key: 'EMPTY_OBJECT', delete: true });

  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (url, init) => {
    if (url.includes('/keys')) {
      return new Response(
        JSON.stringify({
          result: [{ name: 'KEEP' }, { name: 'EMPTY_STRING' }, { name: 'EXTRA' }],
          result_info: { list_complete: true }
        }),
        { status: 200 }
      );
    }
    if (init && init.method === 'PUT') {
      bodies.push(JSON.parse(init.body));
      return new Response('', { status: 200 });
    }
    return new Response('', { status: 200 });
  };

  const res = await syncKv(entries, { accountId: 'a', namespaceId: 'n', apiToken: 't' });

  globalThis.fetch = originalFetch;

  assert.deepEqual(res.updated, ['KEEP']);
  assert.deepEqual(res.deleted.sort(), ['EMPTY_OBJECT', 'EMPTY_STRING', 'EXTRA']);
  const sortByKey = arr => arr.slice().sort((a, b) => a.key.localeCompare(b.key));
  assert.deepEqual(sortByKey(bodies[0]), sortByKey([
    { key: 'KEEP', value: '"value"' },
    { key: 'EMPTY_OBJECT', delete: true },
    { key: 'EMPTY_STRING', delete: true },
    { key: 'EXTRA', delete: true }
  ]));
});
