# Iris-Holistica AI

Cloudflare Worker и статичен фронтенд за холистичен анализ на ирисови изображения с използване на AI модели (Gemini / OpenAI).

## 🌟 Характеристики

- **AI-базиран анализ**: Използва Gemini или OpenAI за визуален анализ на ирисови изображения
- **Персонализирани препоръки**: Генерира индивидуализирани здравни препоръки базирани на ирисова конституция
- **Multi-Query генериране на доклади**: Подобрено качество чрез разделяне на анализа на фокусирани стъпки (виж [MULTI_QUERY_REPORT.md](MULTI_QUERY_REPORT.md))
- **RAG (Retrieval Augmented Generation)**: Интегрира знания от Cloudflare KV за точни интерпретации
- **Многоезичен**: Пълна поддръжка на български език
- **Сигурност**: Конфигурируем CORS, валидация на файлове, error handling

## Как работи

1. Потребителят попълва форма и качва снимки на двете очи (`index.html`, `script.js`)
2. `worker.js` приема `multipart/form-data`, зарежда контекст от Cloudflare KV:
   - `iris_diagnostic_map`
   - `holistic_interpretation_knowledge`
   - `remedy_and_recommendation_base`
3. Worker-ът извиква AI модел за визуален анализ и генерира финален JSON доклад

Всички функции за Worker-а са в един файл и не използват браузърни API.

## 📋 Изисквания

- Node.js 18+ (за локално разработване и тестване)
- Cloudflare Account с Workers и KV
- API ключ за Gemini или OpenAI

## 🚀 Настройка

### 1. Инсталация

```bash
npm install
```

### 2. Конфигурация

Копирайте `.env.example` и задайте необходимите стойности:

```bash
cp .env.example .env
```

Редактирайте `.env`:

```env
WORKER_URL=https://your-worker.workers.dev/
CF_ACCOUNT_ID=your_account_id
CF_KV_NAMESPACE_ID=your_namespace_id
CF_API_TOKEN=your_api_token
ALLOWED_ORIGIN=https://your-frontend-domain.com
```

### 3. Настройка на KV namespace

1. Създайте KV namespace в Cloudflare:

```bash
wrangler kv:namespace create iris_rag_kv
```

2. Качете JSON файловете от папката `kv/`:

**Препоръчан метод (с автоматизиран скрипт):**

```bash
export CF_KV_NAMESPACE_ID=YOUR_NAMESPACE_ID
./scripts/deploy-kv.sh
```

**Алтернативен метод (ръчно):**

```bash
wrangler kv:key put --namespace-id=YOUR_NAMESPACE_ID iris_config_kv --path=kv/iris_config_kv.json
wrangler kv:key put --namespace-id=YOUR_NAMESPACE_ID iris_diagnostic_map --path=kv/iris_diagnostic_map.json
wrangler kv:key put --namespace-id=YOUR_NAMESPACE_ID holistic_interpretation_knowledge --path=kv/holistic_interpretation_knowledge.json
wrangler kv:key put --namespace-id=YOUR_NAMESPACE_ID remedy_and_recommendation_base --path=kv/remedy_and_recommendation_base.json
```

3. Верифицирайте конфигурацията:

```bash
export CF_KV_NAMESPACE_ID=YOUR_NAMESPACE_ID
./scripts/verify-kv.sh
```

**⚠️ Важно:** При всяка промяна в `kv/*.json` файловете, винаги изпълнявайте `./scripts/deploy-kv.sh` за да приложите промените! За детайлни инструкции вижте [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

### 4. Задаване на API ключове

```bash
wrangler secret put GEMINI_API_KEY
# или
wrangler secret put OPENAI_API_KEY
```

### 5. Деплой

```bash
wrangler publish
```

### 6. Хостване на статични файлове

Хоствайте `index.html`, `analysis.html`, `report.html`, `style.css`, `script.js` и `res/` на GitHub Pages или друга CDN платформа.

## 🧪 Разработка и тестове

- Основна логика: `worker.js`
- Клиент: `index.html`, `analysis.html`, `report.html`, `script.js`, `style.css`
- Тестове: `npm test` (изпълнява `worker.test.js`)
- Linting: `npm run lint` или `npm run lint:fix`
- Formatting: `npm run format` или `npm run format:check`

```bash
# Пускане на тестове
npm test

# Проверка на код качеството
npm run lint

# Автоматично форматиране на кода
npm run format
```

## 📝 Примерна заявка

Админ панелът записва стойности в `iris_config_kv`:

```js
// смяна на модела
fetch('https://<worker-url>/admin/set', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'AI_MODEL', value: 'gemini-1.5-flash-latest' })
});

// задаване на ROLE_PROMPT
fetch('https://<worker-url>/admin/put', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'ROLE_PROMPT', value: JSON.stringify({ prompt: 'Ти си холистичен консултант...' }) })
});
```

Подобно се задава и `AI_PROVIDER`.

При зареждане админ панелът автоматично показва всички текущи ключове и стойности от `iris_config_kv`.

### Настройка на контекстните записи

`max_context_entries` контролира колко RAG обобщения и външни източници се изпращат към модела.

- Препоръчителни стойности: `4` за компактни модели (напр. `gpt-4o-mini`, `gemini-1.5-flash`), `6` по подразбиране за балансирани модели (`gpt-4o`, `gemini-1.5-pro`), `8` за разширени модели с голям контекст.
- Примерен запис в `iris_config_kv.json`:
  ```json
  {
    "max_context_entries": 6
  }
  ```

Работерът автоматично прилага стойност `6`, ако ключът липсва.

## Примерна заявка

```bash
curl -F "left-eye-upload=@left.jpg" -F "right-eye-upload=@right.jpg" \
     -F "name=Мария" https://<worker-url>
```

Отговорът е JSON с генерирания доклад.

## Разработка и тестове

- Основна логика: `worker.js`
- Клиент: `index.html`, `script.js`, `style.css`
- Тестове: `npm test` (изпълнява `worker.test.js`)

## Дисклеймър

Анализът е образователен и не представлява медицинска диагноза или лечение.

## 🔐 Сигурност

- **CORS**: Конфигурируйте `ALLOWED_ORIGIN` в `wrangler.toml` за ограничаване на достъпа
- **Файлове**: Автоматична валидация на размера (макс. 20MB)
- **Admin панел**: Използвайте защитени credentials за Cloudflare API
- **API ключове**: Съхранявайте API ключове като Cloudflare Secrets (не в код)

## 🛠️ Конфигурация на AI модели

### Чрез Admin панел

Админ панелът (`admin.html`) позволява управление на конфигурацията през UI.

### Multi-Query генериране на доклади

Новата функционалност разделя генерирането на доклада на 4 фокусирани стъпки за по-високо качество:

1. **Конституционална синтеза** - Обединяване на находките от двете очи
2. **Интерпретация на знаците** - Анализ на здравните импликации
3. **Персонализирани препоръки** - Конкретни и приложими съвети
4. **Финално сглобяване** - Структуриран доклад

**Активиране в `iris_config_kv.json`:**

```json
{
  "use_multi_query_report": true
}
```

**Предимства:**

- По-високо качество на анализа
- По-детайлни препоръки
- Фокусиран контекст за всяка стъпка
- Обратна съвместимост

За повече информация вижте [MULTI_QUERY_REPORT.md](MULTI_QUERY_REPORT.md).

## 📁 Структура на проекта

```
iris/
├── worker.js                 # Cloudflare Worker (основна логика)
├── worker.test.js           # Тестове за worker
├── index.html               # Landing page
├── analysis.html            # Формуляр за анализ
├── report.html              # Показване на резултати
├── about.html               # Информация за проекта
├── admin.html               # Admin панел
├── script.js                # Клиентска логика за формуляра
├── admin.js                 # Клиентска логика за admin панел
├── style.css                # Стилове
├── config.js                # Споделена конфигурация
├── wrangler.toml            # Cloudflare Workers конфигурация
├── package.json             # NPM dependencies и scripts
├── .eslintrc.json          # ESLint конфигурация
├── .prettierrc.json        # Prettier конфигурация
├── kv/                      # KV данни (JSON файлове)
└── res/                     # Ресурси (изображения)
```

## 🤝 Принос

Проектът е отворен за подобрения. При промени:

1. Уверете се че тестовете минават: `npm test`
2. Проверете code quality: `npm run lint`
3. Форматирайте кода: `npm run format`

## 📄 Лиценз

ISC License

---

**За повече информация вижте:**

- [AI_VISION_DOCUMENTATION.md](AI_VISION_DOCUMENTATION.md) - Какво "вижда" AI моделът при анализ
- [PROJECT_GUIDE.md](PROJECT_GUIDE.md) - Детайлно ръководство за организация
- [MULTI_QUERY_REPORT.md](MULTI_QUERY_REPORT.md) - Multi-Query генериране на доклади
- [AGENTS.md](AGENTS.md) - Инструкции за AI agents
