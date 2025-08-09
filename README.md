# Iris-Holistica AI Backend

Този проект съдържа Cloudflare Worker, който изпълнява многостъпков RAG анализ на ирисови изображения.

## Конфигурация на Worker URL

Фронтендът използва конфигурационен файл [`config.js`](config.js), за да определи адреса на Cloudflare Worker-а.

```js
// config.js
export const WORKER_URL =
  (typeof process !== 'undefined' && process.env && process.env.WORKER_URL) ||
  (typeof window !== 'undefined' && window.WORKER_URL) ||
  'https://iris.radilov-k.workers.dev/analyze';
```

### Задаване през environment променлива

При разработка може да зададете URL-а чрез променлива на средата:

```bash
export WORKER_URL="https://my-worker.example.com/analyze"
```

### Ръчно задаване

Алтернативно, редактирайте `config.js` и променете стойността по подразбиране.

## Подробно логване

По подразбиране логовете са минимални. За да активирате подробното логване:

```toml
[vars]
DEBUG = "true"
```

Добавете горното в `wrangler.toml` или задайте променливата `DEBUG` в облачната среда. За да изключите логовете, задайте:

```toml
[vars]
DEBUG = "false"
```

## Избор на AI доставчик

Работникът поддържа два доставчика на модели – **Gemini** и **OpenAI**. 
Изберете кой да се използва чрез променливата на средата `AI_PROVIDER`:

```toml
[vars]
AI_PROVIDER = "openai" # или "gemini" (по подразбиране)
```

Ако не зададете стойност, автоматично се избира `"gemini"`.

## Допълнителни бележки
- Логовете не съдържат чувствителни данни; отговорите от AI се съкращават.
- Използвайте режим на разработка само за тестови цели.

## Компресия на големи изображения
Файлове над 5MB се компресират автоматично с минимална загуба на качество преди да бъдат преобразувани в Base64.

```js
const base64 = await fileToBase64(largeFile); // автоматично компресира и връща Base64
```

## Синхронизация с Cloudflare KV

В директорията [`KV`](KV/) се съхраняват всички ключове и стойности, които трябва да бъдат налични в пространството **`iris_rag_kv`**. За да ги качите:

```bash
export CF_ACCOUNT_ID="<your-account-id>"
export CF_KV_NAMESPACE_ID="<namespace-id>"
export CF_API_TOKEN="<api-token>"
npm run upload-kv
```

Скриптът използва [Cloudflare KV Bulk API](https://developers.cloudflare.com/api/operations/kv-namespace-write-multiple-key-value-pairs) и качва съдържанието на всички файлове в `KV` директорията. При неуспех се извежда описателна грешка.
