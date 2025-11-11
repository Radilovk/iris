# Документация за Процеса на Качване и Визуализация на Изображения

## Обобщение
Този документ описва подробно процеса на качване, центриране и визуализация на ирисови изображения в приложението, включително проследяването на топографския шаблон (SVG overlay) на всяка стъпка.

## Тестови Изображения
- **IMG1.jpg**: 498x665 пиксела, JPEG формат (ляво око)
- **IMG2.jpg**: 492x656 пиксела, JPEG формат (дясно око)
- Местоположение: `res/` директория

## Процес на Качване и Центриране

### Стъпка 1: Избор на Изображение (analysis.html - Стъпка 3)
**Файл**: `analysis.html` (линии 296-1393)
**Скрипт**: `script.js` (линии 157-204)

1. Потребителят избира изображение чрез file input
2. `FileReader` чете изображението като dataURL
3. Изображението се показва като background-image в preview области
4. **Нов код**: Добавен error handler за FileReader.onerror

**Проверка на грешки**:
- ✅ Невалиден файлов формат → показва се грешка
- ✅ Файл над 20MB → показва се грешка
- ✅ FileReader грешка → показва се грешка

### Стъпка 2: Визуализация на Overlay Tool (analysis.html)
**Файл**: `script.js` (линии 206-220)

1. `showOverlayTool()` показва контейнера за центриране
2. Изображението се зарежда в `<img id="${eyeSide}-eye-photo">`
3. SVG overlay се визуализира върху изображението
4. **Нов код**: Добавен error handler за img.onerror

**SVG Overlay Компоненти** (analysis.html, линии 614-933):
- Хексагонална решетка (hex-grid)
- Концентрични кръгове на различни радиуси (120, 200, 260, 320px)
- Радиални линии на всеки 30 градуса (12 сектора)
- Триъгълни маркери на външния пръстен
- Централна точка с кръстосани линии
- Таргет скоби в ъглите
- **Alpha Channel Маска**: Blackout mask (линия 927-932)
  ```html
  <path d="M-500,-500 h1000 v1000 h-1000Z M0,360 a360,360 0 1,0 0,-720 a360,360 0 1,0 0,720Z" 
        fill="#040608" fill-rule="evenodd" />
  ```
  - Тази маска създава черен фон извън кръга (радиус 360px)
  - Използва evenodd fill-rule за създаване на "дупка" в центъра

### Стъпка 3: Интерактивно Центриране
**Файл**: `script.js` (линии 238-320)

1. Потребителят използва 1 пръст за преместване (pan)
2. Потребителят използва 2 пръста за мащабиране (pinch-zoom)
3. Трансформациите се прилагат чрез CSS transform:
   ```javascript
   img.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
   ```
4. SVG overlay остава фиксиран (pointer-events: none)

**Цел**: Центрирането на центъра на ириса с централната точка на overlay-а, и оразмеряването така че външният ръб на ириса да съвпадне с вътрешния кръг (радиус ~120-200px)

### Стъпка 4: Потвърждаване и Capture (Бутон "Потвърди")
**Файл**: `script.js` (линии 322-422)

1. `captureImage(eyeSide)` се извиква при натискане на "Потвърди"
2. Създава се Canvas (800x800px) с черен фон
3. Прилагат се трансформациите от потребителя:
   ```javascript
   ctx.translate(overlaySize / 2, overlaySize / 2);
   ctx.scale(state.scale * scaleFactor, state.scale * scaleFactor);
   ctx.translate(state.tx / state.scale, state.ty / state.scale);
   ```
4. Изображението се рисува върху canvas
5. **Прилага се кръгла маска** (линии 359-365):
   ```javascript
   ctx.globalCompositeOperation = 'destination-in';
   ctx.beginPath();
   ctx.arc(overlaySize / 2, overlaySize / 2, overlaySize * 0.45, 0, Math.PI * 2);
   ctx.fill();
   ```
   - Тази операция създава alpha channel - прозрачност извън кръга
   - Радиус на маската: 0.45 × 800px = 360px (съвпада с SVG маската)
6. Canvas се конвертира в PNG blob с alpha channel
7. **Нов код**: Добавена проверка за null blob

**Alpha Channel Проверка**:
- ✅ Canvas създава изображение с прозрачен фон извън кръга
- ✅ Центрираното изображение е PNG с alpha channel
- ✅ Размер: 800x800px, кръгла маска с радиус 360px

### Стъпка 5: Side-by-Side Preview (analysis.html)
**Файл**: `script.js` (линии 424-456), `analysis.html` (линии 1337-1377)

1. `updateSideBySidePreview()` се извиква след capture
2. Центрираните canvas се копират в preview canvas елементи
3. SVG overlay се показва върху всеки canvas
4. Използва `<use href="#iris-overlay-template">` за преизползване на overlay
5. **Нов код**: Добавени null checks за canvas елементи

**Визуализация**:
- ✅ Лява и дясна очи се показват един до друг
- ✅ Всяко око има SVG overlay върху него
- ✅ Preview използва същия SVG template като overlay tool
- ✅ Alpha channel се визуализира коректно (прозрачност извън кръга)

### Стъпка 6: Изпращане за Анализ
**Файл**: `script.js` (линии 438-509)

1. Form се submitва с центрираните изображения
2. `saveFormDataForReanalysis()` запазва данните в localStorage (линии 536-600)
3. Центрираните изображения се конвертират в dataURL и се съхраняват
4. FormData се изпраща към Worker-а за AI анализ

**LocalStorage Съдържание**:
- `iridologyFormData`: Съдържа всички form полета + dataURL на центрираните изображения
- `left-eye-upload`: dataURL на центрираното ляво око (PNG с alpha channel)
- `right-eye-upload`: dataURL на центрираното дясно око (PNG с alpha channel)

### Стъпка 7: Визуализация в Доклада (report.html)
**Файл**: `report.html` (линии 1212-1381, 1390-1452)

1. `createVisualComposite()` създава визуален композит
2. За всяко око се създава отделен контейнер с:
   - `<img>` елемент за ириса
   - SVG overlay върху него
   - Маркери за идентифицирани знаци (ако има)
3. `applyIrisTransformation()` зарежда изображенията от localStorage
4. Изображенията се показват в тъмен контейнер с градиент фон

**SVG Overlay в Доклада** (линии 1279-1375):
- Същите компоненти като в upload интерфейса
- Blackout mask с fill="#0f1820" (съвпада с контейнер фона)
- Пълна топографска решетка (rings, sectors, markers)

**Alpha Channel Визуализация**:
- ✅ Прозрачните области се виждат като тъмен фон (#0f1820)
- ✅ SVG overlay е видим върху ириса
- ✅ Центрирането от потребителя е запазено
- ✅ Изображението се показва без допълнителни трансформации

## Резюме на Alpha Channel Template

### Тип на Маската
**Canvas Mask (Стъпка 4)**: 
- Използва `globalCompositeOperation = 'destination-in'`
- Създава **истински alpha channel** в PNG изображението
- Пиксели извън кръга са напълно прозрачни (alpha = 0)
- Пиксели в кръга запазват оригиналната си непрозрачност

**SVG Blackout Mask** (Upload & Report):
- Визуален елемент, не истинска маска
- Рисува черен/тъмен фон извън определен радиус
- Използва fill-rule="evenodd" за създаване на "дупка"
- Цвят варира в зависимост от контейнера:
  - `#040608` в upload интерфейса (светъл фон)
  - `#0f1820` в report (тъмен градиент фон)

### Съответствие на Размерите
- Canvas: 800x800px, маска радиус 360px (0.45 × 800)
- SVG viewBox: -400,-400 до 400,400 (800 единици общо)
- SVG маска: радиус 360px
- ✅ Перфектно съвпадение между canvas и SVG маската

## Проверени Функционалности

### ✅ Upload Interface
- [x] Файлова валидация работи коректно
- [x] FileReader error handling добавен
- [x] Overlay tool се показва с изображението
- [x] SVG overlay е видим и правилно позициониран
- [x] Touch gestures работят (pan и pinch-zoom)
- [x] Capture създава PNG с alpha channel
- [x] Side-by-side preview показва центрираните изображения с overlay

### ✅ Report Visualization
- [x] Изображенията се зареждат от localStorage
- [x] SVG overlay се показва върху изображенията
- [x] Alpha channel се визуализира коректно (прозрачен фон)
- [x] Топографският шаблон е ясно видим
- [x] Центрирането от потребителя е запазено

### ✅ Error Handling
- [x] FileReader.onerror handler
- [x] Image.onerror handler
- [x] canvas.toBlob null check
- [x] Preview canvas null checks
- [x] Всички грешки показват user-friendly съобщения

## Заключение

Процесът на качване и визуализация работи коректно:

1. **Alpha Channel Маската**: Създава се правилно в captureImage() и се запазва в PNG формат
2. **SVG Overlay**: Показва се последователно в upload interface, side-by-side preview и report
3. **Визуализация**: И трите места (upload, preview, report) показват ириса с топографския шаблон
4. **Error Handling**: Всички критични точки имат error handling

Няма грешки в основния workflow. Добавените error handlers ще предотвратят проблеми при edge cases като:
- Повредени файлове
- Грешки при четене
- Canvas операции които се провалят
- Липсващи DOM елементи
