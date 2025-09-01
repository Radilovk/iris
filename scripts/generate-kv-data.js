import fs from 'node:fs/promises';
import path from 'node:path';

const KV_DIR = path.resolve('KV');
const OUTPUT_FILE = path.resolve('kv-data.js');

async function main() {
  const files = await fs.readdir(KV_DIR);
  const kvData = {};
  for (const file of files) {
    if (file.startsWith('.')) continue;
    const raw = await fs.readFile(path.join(KV_DIR, file), 'utf8');
    let json;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      console.error(`${file}: невалиден JSON (${err.message})`);
      process.exit(1);
    }
    kvData[file] = JSON.stringify(json, null, 2);
  }

  const content = `export const KV_DATA = ${JSON.stringify(kvData, null, 2)}\n`;
  await fs.writeFile(OUTPUT_FILE, content);
  console.log('kv-data.js е генериран.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
