/**
 * Iris Overlay Utilities
 * Преизползваеми функции за топографски overlay на ирисови изображения
 */

/**
 * Създава SVG overlay елемент за топографска карта на ириса
 * @returns {SVGElement} SVG елемент с топографския overlay
 */
export function createIrisTopographicOverlay() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '-400 -400 800 800');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.pointerEvents = 'none';
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';

  svg.innerHTML = `
        <defs>
            <!-- Filters for Glows -->
            <filter id="outerGlow"><feGaussianBlur stdDeviation="6" result="blur"/></filter>
            <filter id="centerGlow"><feGaussianBlur stdDeviation="4" result="blur"/></filter>

            <!-- Gradient for Outer Ring -->
            <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:var(--accent)" />
                <stop offset="50%" style="stop-color:var(--primary)" />
                <stop offset="100%" style="stop-color:var(--accent)" />
            </linearGradient>

            <!-- Hexagon pattern -->
            <pattern id="hexPattern" width="30" height="26" patternUnits="userSpaceOnUse" patternTransform="scale(1.5)">
                <path d="M15 0 L30 7.5 L30 22.5 L15 30 L0 22.5 L0 7.5 Z" fill="none" stroke="var(--primary)" stroke-width="1.2"/>
            </pattern>
        </defs>

        <!-- Main Group for HUD Elements -->
        <g id="hud-elements">

            <!-- Subtle Hexagonal Grid Background -->
            <circle r="335" class="hex-grid" fill="url(#hexPattern)" opacity="0.1"/>

            <!-- Faint grid circles -->
            <circle r="120" class="ring-dashed" stroke="var(--primary)" stroke-width="1" stroke-opacity="0.4" fill="none" stroke-dasharray="5, 8"/>
            <circle r="200" class="ring-main" stroke="var(--primary)" stroke-width="1.5" stroke-opacity="0.5" fill="none"/>
            <circle r="260" class="ring-dashed" stroke="var(--primary)" stroke-width="1" stroke-opacity="0.4" fill="none" stroke-dasharray="80, 10"/>
            <circle r="320" class="ring-main" stroke="var(--primary)" stroke-width="2.5" stroke-opacity="0.8" fill="none"/>

            <!-- Sector lines (every 30 degrees) -->
            <g class="sector-line" stroke="var(--primary)" stroke-width="1.5" stroke-opacity="0.4">
                <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(0)"/>
                <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(30)"/>
                <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(60)"/>
                <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(90)"/>
                <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(120)"/>
                <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(150)"/>
                <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(180)"/>
                <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(210)"/>
                <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(240)"/>
                <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(270)"/>
                <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(300)"/>
                <line x1="0" y1="-80" x2="0" y2="-320" transform="rotate(330)"/>
            </g>

            <!-- Triangular Markers on outer ring -->
            <g class="marker-shape" fill="var(--accent)" stroke="var(--accent)" stroke-width="1.5" opacity="0.8">
                <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(0)"/>
                <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(30)"/>
                <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(60)"/>
                <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(90)"/>
                <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(120)"/>
                <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(150)"/>
                <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(180)"/>
                <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(210)"/>
                <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(240)"/>
                <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(270)"/>
                <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(300)"/>
                <path d="M -8 -320 L 8 -320 L 0 -335 Z" transform="rotate(330)"/>
            </g>

            <!-- Prominent outer ring with gradient -->
            <circle r="350" class="outer-ring-grad" stroke="url(#ringGradient)" stroke-width="4" fill="none" filter="url(#outerGlow)"/>

            <!-- Center sensor complex -->
            <g class="center-dot-complex">
                <circle r="10" class="center-dot" fill="var(--accent)" filter="url(#centerGlow)"/>
                <circle r="25" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.6"/>
                <circle r="35" class="ring-dashed" stroke="var(--primary)" stroke-width="1" stroke-opacity="0.5" fill="none" stroke-dasharray="5, 8"/>
                <g class="crosshair-fine" stroke="var(--primary)" stroke-width="0.8" stroke-opacity="0.3">
                    <line x1="-50" y1="0" x2="50" y2="0"/>
                    <line x1="0" y1="-50" x2="0" y2="50"/>
                </g>
            </g>

            <!-- Targeting Brackets / HUD Elements -->
            <g class="targeting-bracket" stroke="var(--success)" stroke-width="2.5" fill="none" opacity="0.7">
                <path d="M -250 -350 L -300 -350 L -300 -300" />
                <path d="M  250 -350 L  300 -350 L  300 -300" />
                <path d="M -250  350 L -300  350 L -300  300" />
                <path d="M  250  350 L  300  350 L  300  300" />
            </g>

            <!-- Data readouts -->
            <g class="data-text" font-family="'Lucida Console', 'Courier New', monospace" font-weight="700" fill="var(--primary)" text-anchor="middle">
                <text x="0" y="-285" font-size="16">SCAN MODE</text>
                <text x="230" y="-230" font-size="24" fill="var(--success)">ACTV</text>
            </g>
        </g>
    `;

  return svg;
}

/**
 * Генерира комбинирано изображение от ирис + топографски overlay
 * @param {HTMLImageElement} irisImage - Изображението на ириса
 * @param {Object} transform - Трансформации (scale, tx, ty)
 * @param {number} outputSize - Размер на изходното изображение
 * @returns {Promise<Blob>} Blob на комбинираното изображение
 */
export async function generateIrisWithOverlay(irisImage, transform = {}, outputSize = 800) {
  return new Promise((resolve, reject) => {
    try {
      const { scale = 1, tx = 0, ty = 0 } = transform;

      // Създаваме canvas
      const canvas = document.createElement('canvas');
      canvas.width = outputSize;
      canvas.height = outputSize;
      const ctx = canvas.getContext('2d');

      // Изчистваме canvas
      ctx.fillStyle = '#e0e2e5';
      ctx.fillRect(0, 0, outputSize, outputSize);

      // Изчисляваме центъра
      const centerX = outputSize / 2;
      const centerY = outputSize / 2;

      // Запазваме контекста
      ctx.save();

      // Прилагаме трансформации
      ctx.translate(centerX + tx, centerY + ty);
      ctx.scale(scale, scale);

      // Рисуваме изображението центрирано
      const imgX = -irisImage.naturalWidth / 2;
      const imgY = -irisImage.naturalHeight / 2;
      ctx.drawImage(irisImage, imgX, imgY, irisImage.naturalWidth, irisImage.naturalHeight);

      // Възстановяваме контекста
      ctx.restore();

      // Създаваме SVG overlay
      const svgOverlay = createIrisTopographicOverlay();
      const svgString = new XMLSerializer().serializeToString(svgOverlay);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      // Зареждаме SVG като изображение
      const svgImage = new Image();
      svgImage.onload = () => {
        // Рисуваме SVG overlay върху canvas
        ctx.drawImage(svgImage, 0, 0, outputSize, outputSize);
        URL.revokeObjectURL(svgUrl);

        // Конвертираме canvas в blob
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Неуспешно генериране на изображение'));
          }
        }, 'image/png');
      };

      svgImage.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        reject(new Error('Неуспешно зареждане на SVG overlay'));
      };

      svgImage.src = svgUrl;
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * CSS стилове за overlay компонентите
 */
export const overlayStyles = `
:root {
    --muted: #7a8a9a;
    --primary: #00f0ff;
    --accent: #ff00cc;
    --glow: #00e0ff;
    --success: #00ff8c;
}

.iris-overlay-container {
    position: relative;
    width: 100%;
    height: 100%;
}

.iris-overlay-svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    filter: drop-shadow(0 0 8px rgba(0, 240, 255, 0.35));
}

.overlay-toggle {
    position: absolute;
    bottom: 20px;
    right: 20px;
    background: linear-gradient(135deg, #0077ff, #00aaff);
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 8px;
    font-weight: 600;
    box-shadow: 0 4px 14px rgba(0, 122, 255, 0.3);
    cursor: pointer;
    z-index: 100;
    transition: all 0.3s ease;
}

.overlay-toggle:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0, 122, 255, 0.4);
}

.overlay-toggle:active {
    transform: scale(0.96);
}
`;
