import fs from 'node:fs/promises';
import path from 'node:path';

const KV_DIR = path.resolve('KV');
const OUTPUT_FILE = path.resolve('kv-data.js');

async function main() {
  const entries = await fs.readdir(KV_DIR, { withFileTypes: true });
  const kvData = {};

  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const filePath = path.join(KV_DIR, ent.name);

    if (ent.isDirectory()) {
      if (ent.name !== 'grouped') continue;
      const grouped = {};
      const groupFiles = await fs.readdir(filePath);
      for (const gf of groupFiles) {
        if (gf.startsWith('.')) continue;
        const gPath = path.join(filePath, gf);
        const raw = await fs.readFile(gPath, 'utf8');
        let json;
        try {
          json = JSON.parse(raw);
        } catch (err) {
          console.error(`grouped/${gf}: невалиден JSON (${err.message})`);
          process.exit(1);
        }
        grouped[gf.replace(/\.json$/, '')] = json;
      }
      kvData.grouped = JSON.stringify(grouped, null, 2);
    } else {
      const raw = await fs.readFile(filePath, 'utf8');
      let json;
      try {
        json = JSON.parse(raw);
      } catch (err) {
        console.error(`${ent.name}: невалиден JSON (${err.message})`);
        process.exit(1);
      }
      kvData[ent.name] = JSON.stringify(json, null, 2);
    }
  }

  const content = `export const KV_DATA = ${JSON.stringify(kvData, null, 2)};\n`;
  await fs.writeFile(OUTPUT_FILE, content);
  console.log('kv-data.js е генериран.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
