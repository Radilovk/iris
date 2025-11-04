# Как да допринесете към Iris-Holistica AI

Благодарим ви за интереса да допринесете! Всяко подобрение е добре дошло.

## 🚀 Започване

1. **Fork на репозиторито**
   ```bash
   # Кликнете "Fork" в GitHub UI, след това:
   git clone https://github.com/your-username/iris.git
   cd iris
   ```

2. **Инсталирайте зависимостите**
   ```bash
   npm install
   ```

3. **Създайте нов branch**
   ```bash
   git checkout -b feature/your-feature-name
   # или
   git checkout -b fix/your-bugfix-name
   ```

## 📝 Насоки за код

### Code Style

Проектът използва ESLint и Prettier за code quality. Преди commit:

```bash
# Проверка за грешки
npm run lint

# Автоматично поправяне
npm run lint:fix

# Форматиране на кода
npm run format
```

### Cloudflare Worker Constraints

**ВАЖНО**: `worker.js` се изпълнява в Cloudflare Workers environment:

- ❌ **Забранено**: `localStorage`, `window`, `document`, DOM API
- ❌ **Забранено**: Node.js specific modules (`fs`, `path`, etc.)
- ✅ **Разрешено**: Web Standards APIs (fetch, crypto, etc.)
- ✅ **Разрешено**: Cloudflare Workers APIs (KV, env, ctx)

### Testing

Всяка промяна в `worker.js` трябва да е покрита с тестове:

```bash
npm test
```

Добавете нови тестове в `worker.test.js` за нова функционалност.

## 🔨 Типове промени

### 🐛 Bug Fixes

1. Опишете проблема в issue (ако няма съществуващ)
2. Създайте branch `fix/issue-description`
3. Напишете тест, който демонстрира проблема
4. Поправете бъга
5. Уверете се че всички тестове минават

### ✨ Нови функции

1. Отворете issue за дискусия на функцията
2. Получете одобрение от maintainers
3. Създайте branch `feature/feature-name`
4. Имплементирайте функцията
5. Добавете тестове
6. Обновете документацията

### 📚 Документация

Подобрения в документацията са винаги добре дошли:

- README.md
- PROJECT_GUIDE.md
- SECURITY.md
- Code comments
- Inline JSDoc

## 📋 Checklist преди Pull Request

- [ ] Кодът минава `npm test`
- [ ] Кодът минава `npm run lint`
- [ ] Кодът е форматиран с `npm run format`
- [ ] Добавени са тестове за нова функционалност
- [ ] Документацията е обновена (ако е нужно)
- [ ] Commit messages са ясни и описателни
- [ ] Няма security уязвимости (проверено с `npm audit`)
- [ ] Не са добавени ненужни dependencies

## 🔐 Security Issues

Ако откриете security уязвимост:

1. **НЕ** отваряйте public issue
2. Свържете се директно с maintainers
3. Вижте [SECURITY.md](SECURITY.md) за повече информация

## 💡 Предложения за принос

Ако търсите идеи какво да подобрите:

### Приоритетни области

1. **Security**
   - Добавяне на authentication за admin endpoints
   - Имплементация на rate limiting
   - Input sanitization подобрения

2. **Тестове**
   - Увеличаване на test coverage
   - Integration тестове
   - Performance тестове

3. **Accessibility**
   - WCAG 2.1 AA съответствие
   - Screen reader тестване
   - Keyboard navigation подобрения

4. **Performance**
   - Кеширане на AI responses
   - Image optimization
   - Lazy loading

5. **Internationalization**
   - Мултиезична поддръжка
   - RTL layout support

### По-малки задачи

- Добавяне на missing JSDoc comments
- Подобряване на error messages
- Code refactoring за по-добра четимост
- Добавяне на примери в документацията

## 📫 Комуникация

- **GitHub Issues**: За bug reports и feature requests
- **Pull Requests**: За code contributions
- **Discussions**: За въпроси и идеи

## 🎨 Commit Message Format

Използвайте ясни и описателни commit messages:

```
<type>: <subject>

<body>

<footer>
```

**Types:**
- `feat`: Нова функция
- `fix`: Bug fix
- `docs`: Промени в документацията
- `style`: Code formatting (без логически промени)
- `refactor`: Code refactoring
- `test`: Добавяне или промяна на тестове
- `chore`: Maintenance задачи

**Примери:**
```
feat: add rate limiting to worker endpoints

Implemented rate limiting using Cloudflare Rate Limiting API
to prevent abuse of the analysis endpoint.

Closes #123
```

```
fix: validate file types before upload

Added MIME type validation to prevent non-image files
from being processed by the AI analysis endpoint.

Fixes #456
```

## 📄 Лиценз

Като допринасяте към този проект, вие се съгласявате че вашите промени
ще бъдат лицензирани под ISC License.

## 🙏 Благодарности

Благодарим на всички contributors за тяхното време и усилия!

---

**Въпроси?** Не се колебайте да питате чрез GitHub Issues или Discussions.
