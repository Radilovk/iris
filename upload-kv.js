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

async function main() {
  if (!ACCOUNT_ID || !NAMESPACE_ID || !API_TOKEN) {
    console.error('Липсват променливи CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID или CF_API_TOKEN.');
    process.exit(1);
  }

  const files = await fs.readdir(KV_DIR);
  const entries = [];
  for (const file of files) {
    const value = await fs.readFile(path.join(KV_DIR, file), 'utf8');
    try {
      JSON.parse(value);
    } catch (err) {
      console.error(`Файлът ${file} съдържа невалиден JSON: ${err.message}`);
      process.exit(1);
    }
    entries.push({ key: file, value });
  }
  await bulkUpload(entries);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
