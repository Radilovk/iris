# Iris-Holistica AI

Cloudflare Worker и статичен фронтенд за холистичен анализ на ирисови изображения.

## Как работи

1. Потребителят попълва форма и качва снимки на двете очи (`index.html`, `script.js`).
2. `worker.js` приема `multipart/form-data`, зарежда контекст от Cloudflare KV:
   - `iris_diagnostic_map`
   - `holistic_interpretation_knowledge`
   - `remedy_and_recommendation_base`
3. Worker-ът извиква Gemini (`gemini-pro-vision` и `gemini-pro`), генерира финален JSON доклад и го връща на клиента.

Всички функции за Worker-а са в един файл и не използват браузърни API.

## Настройка

```bash
npm install
```

1. Настройте KV namespace и качете JSON файловете от папката `kv/`.
2. Задайте `GEMINI_API_KEY` в Cloudflare (`wrangler secret put gemini_api_key`).
3. Деплой чрез `wrangler publish`.
4. Хоствайте статичните файлове (например GitHub Pages на `https://radilovk.github.io`).

### Пример: задаване на AI модел и промпт

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
