export function validateKv(data) {
  const entries = [];
  for (const [key, value] of Object.entries(data)) {
    try {
      JSON.parse(value);
    } catch (err) {
      throw new Error(`Невалиден JSON в ${key}: ${err.message}`);
    }
    entries.push({ key, value });
  }
  return entries;
}

export function groupKeys(entries) {
  const groups = {};
  for (const { key } of entries) {
    const category = key.split(/[:_]/)[0];
    if (!groups[category]) groups[category] = [];
    groups[category].push(key);
  }
  return groups;
}

export async function bulkUpload(entries, { accountId, namespaceId, apiToken }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/bulk`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(entries)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Неуспешно качване: ${text}`);
  }
}

async function fetchExistingKeys({ accountId, namespaceId, apiToken }) {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys`;
  const keys = [];
  let cursor;
  do {
    const params = new URLSearchParams({ limit: '1000' });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`${baseUrl}?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${apiToken}` }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Неуспешно извличане на ключове: ${text}`);
    }
    const data = await res.json();
    keys.push(...data.result.map(k => k.name));
    cursor = data.result_info?.cursor;
    if (data.result_info?.cursor === undefined || data.result_info?.list_complete) {
      cursor = null;
    }
  } while (cursor);
  return keys;
}

export async function syncKv(entries, opts) {
  const { accountId, namespaceId, apiToken } = opts;
  const existingKeys = await fetchExistingKeys({ accountId, namespaceId, apiToken });
  const keys = entries.map(e => e.key);
  const toDelete = existingKeys.filter(k => !keys.includes(k));
  const uploadEntries = [...entries, ...toDelete.map(k => ({ key: k, delete: true }))];
  if (uploadEntries.length) {
    await bulkUpload(uploadEntries, { accountId, namespaceId, apiToken });
  }
  const groups = groupKeys(entries);
  return { updated: keys, deleted: toDelete, groups };
}
