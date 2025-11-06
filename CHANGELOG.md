# Changelog

Всички значими промени в този проект ще бъдат документирани в този файл.

Форматът е базиран на [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
и проектът следва [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Deployment скриптове за KV конфигурация** (2025-11-06)
  - `scripts/deploy-kv.sh` - Автоматизиран скрипт за деплойване на KV данни
  - `scripts/verify-kv.sh` - Скрипт за верификация на KV конфигурация
  - NPM scripts: `npm run deploy:kv` и `npm run verify:kv`
  - `DEPLOYMENT_GUIDE.md` - Пълно ръководство за деплойване на подобренията
- Конфигурируем CORS чрез `ALLOWED_ORIGIN` environment variable
- Валидация на размера на качените файлове (макс 20MB)
- ESLint конфигурация за code quality
- Prettier конфигурация за code formatting
- NPM scripts за linting и formatting (`npm run lint`, `npm run format`)
- SEO meta tags (Open Graph, Twitter Cards) в index.html
- Accessibility подобрения (ARIA labels, role attributes)
- SECURITY.md с security best practices
- CONTRIBUTING.md с насоки за contributors
- GitHub Actions CI workflow за автоматично тестване
- Разширена документация в README.md
- Структура на проекта в README.md
- `.gitignore` записи за linting cache файлове

### Changed

- **README.md обновен с инструкции за деплойване на KV** (2025-11-06)
  - Препоръки за използване на deployment скриптовете
  - Важно предупреждение за деплойване на промени в KV файлове
  - Референция към DEPLOYMENT_GUIDE.md
- CORS headers сега използват environment variable вместо hardcoded `*`
- README.md обновен с детайлни setup инструкции
- `.env.example` обновен със security settings
- `wrangler.toml` обновен с `ALLOWED_ORIGIN` variable
- Подобрена структура на документацията

### Fixed

- **Проблем с деплойване на аналитични подобрения** (2025-11-06)
  - Идентифициран проблем: подобренията в `kv/iris_config_kv.json` не се виждаха в продукция
  - Причина: липса на процес за деплойване на KV данни
  - Решение: създадени автоматизирани скриптове за деплойване и верификация
  - Документиран процес за актуализиране на KV конфигурация

### Fixed

- Security риск от неограничен CORS
- Липса на валидация на file size

### Security

- CORS сега е ограничен до специфичен домейн (конфигурируем)
- Файлове се валидират за размер преди обработка
- Добавена документация за security best practices

## [1.0.0] - 2024-12-XX

### Added

- Първоначално release на Iris-Holistica AI
- Cloudflare Worker за AI анализ на ирисови изображения
- Поддръжка за Gemini и OpenAI AI модели
- RAG (Retrieval Augmented Generation) с Cloudflare KV
- Multi-step формуляр за събиране на потребителски данни
- Генериране на персонализирани здравни препоръки
- Admin панел за управление на конфигурация
- Тестово покритие с Node.js test runner
- Landing page с информация за проекта
- Responsive дизайн за мобилни устройства

[Unreleased]: https://github.com/Radilovk/iris/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Radilovk/iris/releases/tag/v1.0.0
