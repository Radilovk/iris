import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateKv, syncKv } from './kv-sync.js';

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID;
const API_TOKEN = process.env.CF_API_TOKEN;
const KV_DIR = path.resolve('KV');

async function main() {
  if (!ACCOUNT_ID || !NAMESPACE_ID || !API_TOKEN) {
    console.error('Липсват променливи CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID или CF_API_TOKEN.');
    process.exit(1);
  }

  const files = await fs.readdir(KV_DIR);
  if (!files.includes('ROLE_PROMPT')) {
    console.warn('Внимание: липсва файл ROLE_PROMPT в директорията KV.');
  }
  const data = {};
  for (const file of files) {
    data[file] = await fs.readFile(path.join(KV_DIR, file), 'utf8');
  }

  try {
    const entries = validateKv(data);
    const result = await syncKv(entries, {
      accountId: ACCOUNT_ID,
      namespaceId: NAMESPACE_ID,
      apiToken: API_TOKEN
    });
    console.log(`Обновени: ${result.updated.length}, изтрити: ${result.deleted.length}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
