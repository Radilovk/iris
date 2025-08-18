# AGENTS

## Cloudflare Worker

- Всички функции за Worker-а трябва да са в един файл `worker.js`.
- Забранено е използването на `localStorage`, DOM или други браузърни API.
- `worker.js` се деплойва самостоятелно. Не добавяйте `import` към локални модули, нито обекти като `window` или `localStorage`.

При промени изпълнявайте релевантните тестове с `npm test`.
