import fs from 'node:fs/promises';
import path from 'node:path';

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;
const API_TOKEN = process.env.CF_API_TOKEN;
const KV_DIR = path.resolve('KV');

async function bulkUpload(entries) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}/bulk`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(entries)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Неуспешно качване: ${text}`);
  }
  console.log('Качването завърши успешно.');
}

async function fetchExistingKeys() {
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}/keys`;
  const keys = [];
  let cursor;
  do {
    const params = new URLSearchParams({ limit: '1000' });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`${baseUrl}?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${API_TOKEN}` }
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

async function main() {
  if (!ACCOUNT_ID || !NAMESPACE_ID || !API_TOKEN) {
    console.error('Липсват променливи CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID или CF_API_TOKEN.');
    process.exit(1);
  }

  const files = await fs.readdir(KV_DIR);
  const existingKeys = await fetchExistingKeys();
  const toDelete = existingKeys.filter(k => !files.includes(k));

  const entries = [];
  for (const file of files) {
    const value = await fs.readFile(path.join(KV_DIR, file), 'utf8');
    entries.push({ key: file, value });
  }
  for (const key of toDelete) {
    entries.push({ key, delete: true });
  }

  if (files.length) {
    console.log('Ще бъдат обновени ключове:', files.join(', '));
  }
  if (toDelete.length) {
    console.log('Ще бъдат изтрити ключове:', toDelete.join(', '));
  }

  await bulkUpload(entries);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
