/**
 * Iris Zone Overlay Visualization Module
 * Creates topographic zone overlays for iris images
 */

/**
 * Draws the 7 concentric zones of iris topography on a canvas
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {number} centerX - X coordinate of iris center
 * @param {number} centerY - Y coordinate of iris center
 * @param {number} radius - Outer radius of iris
 * @param {Object} options - Styling options
 */
export function drawIrisZones(ctx, centerX, centerY, radius, options = {}) {
  const {
    showLabels = true,
    lineColor = 'rgba(58, 123, 213, 0.8)',
    lineWidth = 2,
    fontSize = 12
  } = options;

  // Zone definitions based on iris_diagnostic_map.txt
  const zones = [
    { zone: 1, name: 'Стомашна', ratio: 0.15 },
    { zone: 2, name: 'Чревна', ratio: 0.30 },
    { zone: 3, name: 'Хуморална', ratio: 0.45 },
    { zone: 4, name: 'Мускулна', ratio: 0.60 },
    { zone: 5, name: 'Костна', ratio: 0.75 },
    { zone: 6, name: 'Лимфна', ratio: 0.90 },
    { zone: 7, name: 'Кожна', ratio: 1.0 }
  ];

  ctx.save();

  // Draw zones from outer to inner for proper layering
  for (let i = zones.length - 1; i >= 0; i--) {
    const zone = zones[i];
    const zoneRadius = radius * zone.ratio;

    // Draw zone circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, zoneRadius, 0, Math.PI * 2);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // Add zone label
    if (showLabels && i % 2 === 0) {
      ctx.fillStyle = lineColor;
      ctx.font = `${fontSize}px Poppins, sans-serif`;
      ctx.textAlign = 'center';
      const labelRadius = zoneRadius + 15;
      ctx.fillText(
        `Зона ${zone.zone}`,
        centerX,
        centerY - labelRadius
      );
    }
  }

  ctx.restore();
}

/**
 * Draws organ sector lines (clock positions) on iris
 * @param {CanvasRenderingContext2D} ctx - Canvas 2D context
 * @param {number} centerX - X coordinate of iris center
 * @param {number} centerY - Y coordinate of iris center
 * @param {number} radius - Outer radius of iris
 * @param {Object} options - Styling options
 */
export function drawIrisSectors(ctx, centerX, centerY, radius, options = {}) {
  const {
    lineColor = 'rgba(58, 123, 213, 0.5)',
    lineWidth = 1
  } = options;

  ctx.save();

  // Draw 12 sector lines (like clock hours)
  for (let hour = 0; hour < 12; hour++) {
    const angle = (hour * 30 - 90) * Math.PI / 180; // -90 to start at 12 o'clock

    ctx.beginPath();
    ctx.moveTo(
      centerX + Math.cos(angle) * radius * 0.15,
      centerY + Math.sin(angle) * radius * 0.15
    );
    ctx.lineTo(
      centerX + Math.cos(angle) * radius,
      centerY + Math.sin(angle) * radius
    );
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Creates a complete iris overlay on a canvas element
 * @param {HTMLCanvasElement} canvas - Target canvas element
 * @param {HTMLImageElement} irisImage - Iris image to overlay
 * @param {Object} options - Configuration options
 */
export function createIrisOverlay(canvas, irisImage, options = {}) {
  const {
    showZones = true,
    showSectors = true,
    zoneOpacity = 0.3,
    centerX = null,
    centerY = null,
    irisRadius = null
  } = options;

  const ctx = canvas.getContext('2d');

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw the iris image
  ctx.drawImage(irisImage, 0, 0, canvas.width, canvas.height);

  // Calculate iris center and radius (defaults to center of image)
  const cx = centerX !== null ? centerX : canvas.width / 2;
  const cy = centerY !== null ? centerY : canvas.height / 2;
  const radius = irisRadius !== null ? irisRadius : Math.min(canvas.width, canvas.height) * 0.4;

  // Draw sector lines first (behind zones)
  if (showSectors) {
    drawIrisSectors(ctx, cx, cy, radius, {
      lineColor: `rgba(58, 123, 213, ${zoneOpacity * 0.7})`,
      lineWidth: 1
    });
  }

  // Draw zones
  if (showZones) {
    drawIrisZones(ctx, cx, cy, radius, {
      showLabels: true,
      zoneColor: `rgba(58, 123, 213, ${zoneOpacity})`,
      lineColor: `rgba(58, 123, 213, ${zoneOpacity * 2})`,
      lineWidth: 2,
      fontSize: Math.max(10, Math.floor(radius / 20))
    });
  }
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
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;

  const redraw = () => {
    createIrisOverlay(canvas, irisImage, {
      centerX,
      centerY,
      irisRadius,
      zoneOpacity: 0.4
    });
    if (onUpdate) {
      onUpdate({ centerX, centerY, irisRadius });
    }
  };

  // Mouse/touch event handlers for dragging center
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);

    if (distance < 30) {
      isDragging = true;
      dragStartX = x - centerX;
      dragStartY = y - centerY;
      canvas.style.cursor = 'grabbing';
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = canvas.getBoundingClientRect();
    centerX = e.clientX - rect.left - dragStartX;
    centerY = e.clientY - rect.top - dragStartY;
    redraw();
  });

  canvas.addEventListener('mouseup', () => {
    isDragging = false;
    canvas.style.cursor = 'default';
  });

  canvas.addEventListener('mouseleave', () => {
    isDragging = false;
    canvas.style.cursor = 'default';
  });

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
 * This is a basic implementation - could be enhanced with AI
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

/**
 * Converts canvas to data URL for storage
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {string} format - Image format (default: 'image/png')
 * @returns {string} - Data URL
 */
export function canvasToDataURL(canvas, format = 'image/png') {
  return canvas.toBlob((blob) => {
    return URL.createObjectURL(blob);
  }, format);
}
