import fs from 'node:fs/promises';
import path from 'node:path';

const KV_DIR = path.resolve('KV');
const OUTPUT_FILE = path.resolve('rag-keys.js');

async function main() {
  const files = (await fs.readdir(KV_DIR))
    .filter(f => !f.startsWith('.'))
    .sort();
  const content = `// Автоматично генериран от scripts/generate-rag-keys.js\nexport const RAG_REQUIRED_KEYS = ${JSON.stringify(files, null, 2)};\n`;

  if (process.argv.includes('--check')) {
    try {
      const existing = await fs.readFile(OUTPUT_FILE, 'utf8');
      if (existing !== content) {
        console.error('rag-keys.js не е актуализиран. Изпълни: node scripts/generate-rag-keys.js');
        process.exit(1);
      }
      console.log('rag-keys.js е актуален.');
    } catch {
      console.error('rag-keys.js липсва или е невалиден. Изпълни: node scripts/generate-rag-keys.js');
      process.exit(1);
    }
  } else {
    await fs.writeFile(OUTPUT_FILE, content);
    console.log('rag-keys.js е генериран.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
