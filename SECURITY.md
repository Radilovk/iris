# Сигурност

## Докладване на уязвимости

Ако откриете security уязвимост в този проект, моля свържете се с поддръжниците чрез GitHub Issues (маркирайте като "Security").

## Защитени практики

### 1. CORS Конфигурация

**⚠️ ВАЖНО**: По подразбиране CORS е конфигуриран да приема заявки от всички домейни (`*`). За продукционна среда задължително задайте `ALLOWED_ORIGIN`:

```toml
# wrangler.toml
[vars]
ALLOWED_ORIGIN = "https://your-production-domain.com"
```

Или през environment variable:
```bash
wrangler secret put ALLOWED_ORIGIN
```

### 2. API Ключове

**Никога не съхранявайте API ключове директно в код!** Използвайте Cloudflare Secrets:

```bash
wrangler secret put GEMINI_API_KEY
wrangler secret put OPENAI_API_KEY
```

### 3. Admin Endpoints

Admin endpoints (`/admin/*`) използват Cloudflare API credentials. Препоръчва се:

- Ограничаване на достъпа до admin панела чрез IP whitelist или authentication
- Използване на отделен Worker с ограничени permissions за admin операции
- Регулярна ротация на CF_API_TOKEN

### 4. Валидация на входни данни

Worker-ът автоматично валидира:
- Размер на качените файлове (макс. 20MB)
- Тип на файловете (само изображения)
- Формат на formData

### 5. Rate Limiting

За продукционна среда препоръчваме:

- Cloudflare Rate Limiting rules за защита от abuse
- Мониторинг на Worker usage и costs
- Логване на подозрителни заявки

### 6. Content Security Policy

Добавете CSP headers в статичните файлове:

```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; 
               style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; 
               img-src 'self' data: https:;">
```

### 7. Dependency Security

Редовно проверявайте зависимостите за известни уязвимости:

```bash
npm audit
npm audit fix
```

### 8. Environment Variables

Никога не commit-вайте `.env` файла. Използвайте `.env.example` като template.

### 9. Error Messages

Worker-ът не разкрива чувствителна информация в error messages (stack traces, API keys, internal paths).

## Security Checklist за продукция

- [ ] CORS ограничен до production domain
- [ ] API ключове като Cloudflare Secrets
- [ ] Rate limiting активиран
- [ ] Admin endpoints защитени
- [ ] CSP headers добавени
- [ ] Dependencies актуализирани
- [ ] Logs review за suspicious activity
- [ ] Backup на KV data
- [ ] Monitoring и alerting setup

## Известни ограничения

1. Worker-ът не съхранява user data permanent (всичко е ephemeral)
2. Качените изображения не се записват в storage (само се обработват в паметта)
3. Няма session management или user authentication

## Полезни ресурси

- [Cloudflare Workers Security Best Practices](https://developers.cloudflare.com/workers/platform/security/)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [npm Security Best Practices](https://docs.npmjs.com/security-best-practices)
