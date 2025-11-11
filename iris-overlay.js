/**
 * Iris Zone Overlay Visualization Module
 * Creates topographic zone overlays for iris images using biotech-style SVG
 * Based on the design from upload.html
 */

/**
 * Generates the biotech-style SVG overlay for iris topographic mapping
 * @returns {string} - SVG string for the overlay
 */
export function generateBiotechOverlaySVG() {
  return `
    <svg viewBox="-400 -400 800 800" width="100%" height="100%" aria-label="Futuristic iris scanner overlay">
      <defs>
        <!-- Filters for Glows -->
        <filter id="outerGlow"><feGaussianBlur stdDeviation="6" result="blur"/></filter>
        <filter id="centerGlow"><feGaussianBlur stdDeviation="4" result="blur"/></filter>
        
        <!-- Gradient for Outer Ring -->
        <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#ff00cc" />
          <stop offset="50%" style="stop-color:#00f0ff" />
          <stop offset="100%" style="stop-color:#ff00cc" />
        </linearGradient>

        <!-- Hexagon pattern -->
        <pattern id="hexPattern" width="30" height="26" patternUnits="userSpaceOnUse" patternTransform="scale(1.5)">
            <path d="M15 0 L30 7.5 L30 22.5 L15 30 L0 22.5 L0 7.5 Z" fill="none" stroke="#00f0ff" stroke-width="1.2"/>
        </pattern>
      </defs>

      <!-- Main Group for HUD Elements -->
      <g id="hud-elements">

          <!-- Subtle Hexagonal Grid Background -->
          <circle r="335" fill="url(#hexPattern)" opacity="0.1"/>

          <!-- Faint grid circles -->
          <circle r="120" stroke="#00f0ff" stroke-width="1" stroke-opacity="0.4" fill="none" stroke-dasharray="5, 8"/>
          <circle r="200" stroke="#00f0ff" stroke-width="1.5" stroke-opacity="0.5" fill="none"/>
          <circle r="260" stroke="#00f0ff" stroke-width="1" stroke-opacity="0.4" fill="none" stroke-dasharray="80, 10"/>
          <circle r="320" stroke="#00f0ff" stroke-width="2.5" stroke-opacity="0.8" fill="none"/>

          <!-- Sector lines (every 30 degrees) -->
          <g stroke="#00f0ff" stroke-width="1.5" stroke-opacity="0.4">
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
          <g fill="#ff00cc" stroke="#ff00cc" stroke-width="1.5" opacity="0.8">
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
          <circle r="350" stroke="url(#ringGradient)" stroke-width="4" fill="none" filter="url(#outerGlow)"/>
          
          <!-- Center sensor complex -->
          <g class="center-dot-complex">
              <circle r="10" fill="#ff00cc" filter="url(#centerGlow)"/>
              <circle r="25" fill="none" stroke="#ff00cc" stroke-width="1.5" opacity="0.6"/>
              <circle r="35" stroke="#00f0ff" stroke-width="1" stroke-opacity="0.5" fill="none" stroke-dasharray="5, 8"/>
              <g stroke="#00f0ff" stroke-width="0.8" stroke-opacity="0.3">
                <line x1="-50" y1="0" x2="50" y2="0"/>
                <line x1="0" y1="-50" x2="0" y2="50"/>
              </g>
          </g>

          <!-- Targeting Brackets / HUD Elements -->
          <g stroke="#00ff8c" stroke-width="2.5" fill="none" opacity="0.7">
              <path d="M -250 -350 L -300 -350 L -300 -300" />
              <path d="M  250 -350 L  300 -350 L  300 -300" />
              <path d="M -250  350 L -300  350 L -300  300" />
              <path d="M  250  350 L  300  350 L  300  300" />
          </g>

          <!-- Data readouts -->
          <g font-family="'Lucida Console', 'Courier New', monospace" font-weight="700" fill="#00f0ff" text-anchor="middle">
            <text x="0" y="-285" font-size="16">ID: 84-TRX</text>
            <text x="230" y="-230" font-size="24" fill="#00ff8c">STBL</text>
            <text x="-285" y="0" font-size="14" fill="#7a8a9a" text-anchor="end" transform="rotate(-90, -285, 0)">SEQ. ACTIVE</text>
            <text x="285" y="0" font-size="14" fill="#7a8a9a" text-anchor="start" transform="rotate(90, 285, 0)">LUM: 98.4</text>
          </g>

      </g>

      <!-- Blackout Mask (Must be last to draw over everything) -->
      <path d="M-500,-500 h1000 v1000 h-1000Z M0,360 a360,360 0 1,0 0,-720 a360,360 0 1,0 0,720Z" 
            fill="#040608" fill-rule="evenodd" />

    </svg>
  `;
}


/**
 * Creates a complete iris overlay using the biotech SVG design
 * @param {HTMLCanvasElement} canvas - Target canvas element
 * @param {HTMLImageElement} irisImage - Iris image to overlay
 * @param {Object} options - Configuration options
 */
export function createIrisOverlay(canvas, irisImage, options = {}) {
  const ctx = canvas.getContext('2d');

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw the iris image
  ctx.drawImage(irisImage, 0, 0, canvas.width, canvas.height);

  // Create SVG overlay
  const svgString = generateBiotechOverlaySVG();
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
  const svgUrl = URL.createObjectURL(svgBlob);

  const svgImage = new Image();
  svgImage.onload = () => {
    // Draw SVG over the iris image with semi-transparency
    ctx.globalAlpha = options.zoneOpacity || 0.8;
    ctx.drawImage(svgImage, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;
    URL.revokeObjectURL(svgUrl);
  };
  svgImage.src = svgUrl;
}

/**
 * Creates an interactive iris overlay with manual positioning controls
 * @param {HTMLCanvasElement} canvas - Target canvas element
 * @param {HTMLImageElement} irisImage - Iris image to overlay
 * @param {Function} onUpdate - Callback when position/scale changes
 * @returns {Object} - Control object with methods
 */
export function createInteractiveOverlay(canvas, irisImage, onUpdate = null) {
  let centerX = canvas.width / 2;
  let centerY = canvas.height / 2;
  let irisRadius = Math.min(canvas.width, canvas.height) * 0.4;

  const redraw = () => {
    createIrisOverlay(canvas, irisImage, {
      centerX,
      centerY,
      irisRadius,
      zoneOpacity: 0.8
    });
    if (onUpdate) {
      onUpdate({ centerX, centerY, irisRadius });
    }
  };

  // Initial draw
  redraw();

  return {
    setCenter(x, y) {
      centerX = x;
      centerY = y;
      redraw();
    },
    setRadius(r) {
      irisRadius = r;
      redraw();
    },
    getParams() {
      return { centerX, centerY, irisRadius };
    },
    redraw
  };
}

/**
 * Detects iris position in an image (simple circle detection)
 * @param {HTMLImageElement} image - Iris image
 * @returns {Object} - Detected center and radius
 */
export function detectIrisPosition(image) {
  // Simple heuristic: assume iris is centered and takes up ~80% of image
  return {
    centerX: image.width / 2,
    centerY: image.height / 2,
    irisRadius: Math.min(image.width, image.height) * 0.4
  };
}
