import 'dotenv/config';
import { validateKv, syncKv } from '../kv-sync.js';

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;
const API_TOKEN = process.env.CF_API_TOKEN;

const TARGET_KEYS = ['AI_MODEL', 'AI_PROVIDER', 'MODEL_OPTIONS'];

async function fetchKey(key) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${API_TOKEN}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Неуспешно извличане на ${key}: ${text}`);
  }
  let value = await res.text();
  if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
    try {
      value = JSON.parse(value);
    } catch {
      // стойността не е валиден JSON, оставяме както е
    }
  }
  return JSON.stringify(value);
}

async function main() {
  if (!ACCOUNT_ID || !NAMESPACE_ID || !API_TOKEN) {
    console.error('Липсват променливи CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID или CF_API_TOKEN.');
    process.exit(1);
  }

  const data = {};
  for (const key of TARGET_KEYS) {
    data[key] = await fetchKey(key);
  }

  const entries = validateKv(data);
  const result = await syncKv(entries, {
    accountId: ACCOUNT_ID,
    namespaceId: NAMESPACE_ID,
    apiToken: API_TOKEN
  });

  console.log(`Обновени ключове: ${result.updated.join(', ')}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
