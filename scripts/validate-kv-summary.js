import fs from 'node:fs/promises';
import path from 'node:path';

const SUMMARY_FILE = path.resolve('rag-kv-summary.json');
const KV_DIR = path.resolve('KV');

async function main() {
  const raw = await fs.readFile(SUMMARY_FILE, 'utf8');
  const summary = JSON.parse(raw);
  const keys = Object.keys(summary).filter(k => /^[A-Z0-9_]+$/.test(k));
  const missing = [];

  for (const key of keys) {
    const candidates = [path.join(KV_DIR, key), path.join(KV_DIR, `${key}.json`)];
    let exists = false;
    for (const file of candidates) {
      try {
        await fs.access(file);
        exists = true;
        break;
      } catch {}
    }
    if (!exists) {
      missing.push(key);
    }
  }

  if (missing.length) {
    console.error(`Липсващи KV записи: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log('Всички записи от rag-kv-summary.json са налични в KV/');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
