export function validateKv(data) {
  const keyRegex = /^(grouped(:[a-z]+)?|[A-Z0-9_]+)$/;
  const entries = [];
  for (const [key, value] of Object.entries(data)) {
    if (!keyRegex.test(key)) {
      throw new Error(`Невалиден ключ: ${key}`);
    }
    if (
      value === "" ||
      value === null ||
      (typeof value === 'string' && value.trim() === '') ||
      (value && typeof value === 'object' && Object.keys(value).length === 0)
    ) {
      entries.push({ key, delete: true });
      continue;
    }
    let stringified;
    try {
      stringified = JSON.stringify(value);
    } catch (err) {
      throw new Error(`Невалиден JSON в ${key}: ${err.message}`);
    }
    entries.push({ key, value: stringified });
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
  const deleteRequested = entries.filter(e => e.delete).map(e => e.key);
  const uploadEntries = entries.filter(e => !e.delete);
  const existingKeys = await fetchExistingKeys({ accountId, namespaceId, apiToken });
  const keys = uploadEntries.map(e => e.key);
  const missing = existingKeys.filter(k => !keys.includes(k));
  const toDelete = [...new Set([...deleteRequested, ...missing])];
  const finalUpload = [
    ...uploadEntries,
    ...toDelete.map(k => ({ key: k, delete: true }))
  ];
  if (finalUpload.length) {
    await bulkUpload(finalUpload, { accountId, namespaceId, apiToken });
  }
  const groups = groupKeys(uploadEntries);
  return { updated: keys, deleted: toDelete, groups };
}
