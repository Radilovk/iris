import fs from 'node:fs/promises';
import path from 'node:path';

const BOOKS_DIR = path.resolve('books');
const KV_DIR = path.resolve('KV');

function toKeyName(name) {
  return 'BOOK_' + name.replace(/\.[^/.]+$/, '')
    .replace(/\s+/g, '_')
    .toUpperCase() + '.json';
}

async function main() {
  await fs.mkdir(KV_DIR, { recursive: true });
  const files = await fs.readdir(BOOKS_DIR);
  for (const file of files) {
    if (!file.endsWith('.txt')) continue;
    const filePath = path.join(BOOKS_DIR, file);
    const content = await fs.readFile(filePath, 'utf8');
    const name = path.basename(file, '.txt');
    const keyName = toKeyName(file);
    const json = {
      name,
      summary: content.trim(),
      source: path.join('books', file)
    };
    const outPath = path.join(KV_DIR, keyName);
    await fs.writeFile(outPath, JSON.stringify(json, null, 2));
    console.log(`Създаден ${keyName}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
