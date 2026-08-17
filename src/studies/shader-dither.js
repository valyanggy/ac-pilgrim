import '../styles.css';

const canvas = document.querySelector('.shader-canvas');
const frame = document.querySelector('.shader-image-frame');
const context = canvas.getContext('2d', { alpha: false });

const SOURCE_WIDTH = 640;
const SOURCE_HEIGHT = 353;
const GLYPH_COUNT = 36;
const GLYPH_RASTER_SIZE = 128;

const settings = {
  cell: 12,
  detailThreshold: 0.1,
  maxScale: 4,
  gradation: 37,
  blackPoint: 0.06,
  whitePoint: 0.9,
  glyphScale: 0.9,
  invert: true,
  mode: 'grid',
  ramp: 'blue',
  radius: 72,
  life: 1.25
};

const rampPresets = {
  blue: ['#001725', '#003a5c', '#00689a', '#008bc0', '#60caff', '#f12b16'],
  green: ['#071b0a', '#0b3610', '#12651a', '#20a62a', '#63db35', '#b5ff67'],
  mono: ['#181818', '#3d3d3d', '#656565', '#929292', '#c5c5c5', '#f3f3f3']
};

const sampleCanvas = document.createElement('canvas');
sampleCanvas.width = SOURCE_WIDTH;
sampleCanvas.height = SOURCE_HEIGHT;
const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });

canvas.width = SOURCE_WIDTH;
canvas.height = SOURCE_HEIGHT;

let sourceData = null;
let sourceImage = null;
let defaultSourceImage = null;
let customSourceActive = false;
let glyphs = [];
let ready = false;
let renderQueued = false;
let animationFrame = 0;
let lastAnimationTime = 0;
let previousPointer = null;
const trailPoints = [];
const MAX_TRAIL_POINTS = 48;

function bindRange(id, callback, format = (value) => value.toFixed(2)) {
  const input = document.getElementById(id);
  const output = document.querySelector(`[data-for="${id}"]`);
  const update = () => {
    const value = Number(input.value);
    output.textContent = format(value);
    callback(value);
  };
  input.addEventListener('input', update);
  update();
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function drawImageCover(targetContext, image) {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const targetRatio = SOURCE_WIDTH / SOURCE_HEIGHT;
  const imageRatio = imageWidth / imageHeight;
  let sourceX = 0;
  let sourceY = 0;
  let sourceWidth = imageWidth;
  let sourceHeight = imageHeight;

  if (imageRatio > targetRatio) {
    sourceWidth = imageHeight * targetRatio;
    sourceX = (imageWidth - sourceWidth) * 0.5;
  } else {
    sourceHeight = imageWidth / targetRatio;
    sourceY = (imageHeight - sourceHeight) * 0.5;
  }

  targetContext.clearRect(0, 0, SOURCE_WIDTH, SOURCE_HEIGHT);
  targetContext.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    SOURCE_WIDTH,
    SOURCE_HEIGHT
  );
}

function setSourceImage(image, label) {
  sourceImage = image;
  drawImageCover(sampleContext, sourceImage);
  sourceData = sampleContext.getImageData(0, 0, SOURCE_WIDTH, SOURCE_HEIGHT);
  trailPoints.length = 0;
  previousPointer = null;
  document.getElementById('shader-image-name').textContent = label;
  queueRender();
}

function rasterizeGlyph(image, color) {
  const glyphCanvas = document.createElement('canvas');
  glyphCanvas.width = GLYPH_RASTER_SIZE;
  glyphCanvas.height = GLYPH_RASTER_SIZE;
  const glyphContext = glyphCanvas.getContext('2d');
  glyphContext.drawImage(image, 0, 0, GLYPH_RASTER_SIZE, GLYPH_RASTER_SIZE);
  glyphContext.globalCompositeOperation = 'source-in';
  glyphContext.fillStyle = color;
  glyphContext.fillRect(0, 0, GLYPH_RASTER_SIZE, GLYPH_RASTER_SIZE);
  glyphContext.globalCompositeOperation = 'source-over';
  return glyphCanvas;
}

function measureCoverage(image) {
  const mask = rasterizeGlyph(image, '#ffffff');
  const pixels = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data;
  let alpha = 0;
  for (let index = 3; index < pixels.length; index += 4) alpha += pixels[index];
  return alpha / 255 / (mask.width * mask.height);
}

function bakeGlyphColors() {
  const colors = rampPresets[settings.ramp];
  glyphs.forEach((glyph) => {
    glyph.rasters = colors.map((color) => rasterizeGlyph(glyph.image, color));
  });
}

function luminanceAt(pixelIndex) {
  return sourceData.data[pixelIndex];
}

function regionStats(x, y, width, height) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(SOURCE_WIDTH, Math.ceil(x + width));
  const y1 = Math.min(SOURCE_HEIGHT, Math.ceil(y + height));
  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let sampleY = y0; sampleY < y1; sampleY += 1) {
    let pixel = (sampleY * SOURCE_WIDTH + x0) * 4;
    for (let sampleX = x0; sampleX < x1; sampleX += 1) {
      const value = luminanceAt(pixel);
      sum += value;
      sumSquares += value * value;
      count += 1;
      pixel += 4;
    }
  }

  if (!count) return { mean: 0, deviation: 0 };
  const mean = sum / count;
  return {
    mean,
    deviation: Math.sqrt(Math.max(0, sumSquares / count - mean * mean))
  };
}

function gridCells() {
  const cells = [];
  const size = Math.max(2, settings.cell);
  for (let y = 0; y < SOURCE_HEIGHT; y += size) {
    for (let x = 0; x < SOURCE_WIDTH; x += size) {
      cells.push({ x, y, size, mean: regionStats(x, y, size, size).mean });
    }
  }
  return cells;
}

function quadtreeCells() {
  const cells = [];
  const minimum = Math.max(2, settings.cell);
  const rootSize = minimum * settings.maxScale;

  function subdivide(x, y, size) {
    const stats = regionStats(x, y, size, size);
    const canSplit = size / 2 >= minimum;
    if (canSplit && stats.deviation / 255 > settings.detailThreshold) {
      const half = size / 2;
      subdivide(x, y, half);
      subdivide(x + half, y, half);
      subdivide(x, y + half, half);
      subdivide(x + half, y + half, half);
      return;
    }
    cells.push({ x, y, size, mean: stats.mean });
  }

  for (let y = 0; y < SOURCE_HEIGHT; y += rootSize) {
    for (let x = 0; x < SOURCE_WIDTH; x += rootSize) subdivide(x, y, rootSize);
  }
  return cells;
}

function normalizedTone(mean) {
  let tone = mean / 255;
  if (settings.invert) tone = 1 - tone;
  const range = settings.whitePoint - settings.blackPoint;
  if (range > 0) tone = (tone - settings.blackPoint) / range;
  return Math.max(0, Math.min(1, tone));
}

function glyphIndexForTone(tone) {
  let band = Math.floor(tone * settings.gradation);
  band = Math.min(settings.gradation - 1, band);
  if (band === 0 || !glyphs.length) return -1;
  const span = settings.gradation - 2;
  const position = span > 0 ? (band - 1) / span : 1;
  return Math.min(glyphs.length - 1, Math.round(position * (glyphs.length - 1)));
}

function rampIndexForTone(tone) {
  return Math.min(5, Math.floor(tone * 6));
}

function cellHash(cell) {
  let value = Math.imul(Math.floor(cell.x) + 17, 374761393)
    ^ Math.imul(Math.floor(cell.y) + 31, 668265263)
    ^ Math.imul(Math.floor(cell.size) + 7, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function cellReveal(cell) {
  if (!trailPoints.length) return false;
  const centerX = cell.x + cell.size * 0.5;
  const centerY = cell.y + cell.size * 0.5;
  let probability = 0;

  for (const point of trailPoints) {
    const distance = Math.hypot(centerX - point.x, centerY - point.y);
    if (distance >= settings.radius) continue;
    const spatial = Math.min(1, (1 - distance / settings.radius) * 1.8);
    const lifetime = Math.max(0, 1 - point.age / settings.life);
    probability = Math.max(probability, spatial * Math.pow(lifetime, 0.72));
  }

  // The mask is deliberately binary per cell. It never becomes a translucent
  // pixel layer, so the source cannot show through a glyph or its black field.
  return cellHash(cell) < probability;
}

function render() {
  renderQueued = false;
  if (!ready) return;

  context.drawImage(sampleCanvas, 0, 0, SOURCE_WIDTH, SOURCE_HEIGHT);

  const cells = settings.mode === 'quad' ? quadtreeCells() : gridCells();
  const padding = 1 - settings.glyphScale;

  cells.forEach((cell) => {
    if (!cellReveal(cell)) return;

    // A revealed cell fully replaces the source before its glyph is drawn.
    // Empty tone band cells therefore become a true black no-character field.
    context.fillStyle = '#000000';
    context.fillRect(cell.x, cell.y, cell.size, cell.size);

    const tone = normalizedTone(cell.mean);
    const glyphIndex = glyphIndexForTone(tone);
    if (glyphIndex < 0) return;

    const inset = cell.size * padding * 0.5;
    const drawSize = cell.size - inset * 2;
    const glyph = glyphs[glyphIndex].rasters[rampIndexForTone(tone)];
    context.drawImage(glyph, cell.x + inset, cell.y + inset, drawSize, drawSize);
  });

  document.getElementById('shader-cell-count').textContent = cells.length.toLocaleString();
}

function animate(now) {
  const delta = lastAnimationTime ? Math.min(0.05, (now - lastAnimationTime) / 1000) : 0;
  lastAnimationTime = now;

  for (let index = trailPoints.length - 1; index >= 0; index -= 1) {
    trailPoints[index].age += delta;
    if (trailPoints[index].age >= settings.life) trailPoints.splice(index, 1);
  }

  render();
  if (trailPoints.length) {
    animationFrame = requestAnimationFrame(animate);
  } else {
    animationFrame = 0;
    lastAnimationTime = 0;
  }
}

function ensureAnimation() {
  if (!animationFrame) animationFrame = requestAnimationFrame(animate);
}

function handlePointerMove(event) {
  const rect = canvas.getBoundingClientRect();
  const inside = event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom;

  if (!inside) {
    previousPointer = null;
    return;
  }

  const point = {
    x: (event.clientX - rect.left) / rect.width * SOURCE_WIDTH,
    y: (event.clientY - rect.top) / rect.height * SOURCE_HEIGHT
  };
  const previous = previousPointer || point;
  const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(6, settings.cell * 0.8)));

  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    trailPoints.push({
      x: previous.x + (point.x - previous.x) * progress,
      y: previous.y + (point.y - previous.y) * progress,
      age: 0
    });
  }
  if (trailPoints.length > MAX_TRAIL_POINTS) {
    trailPoints.splice(0, trailPoints.length - MAX_TRAIL_POINTS);
  }
  previousPointer = point;
  ensureAnimation();
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

function updateLayout() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const isMobile = width < 760;
  const maxWidth = width * (isMobile ? 0.86 : 0.55);
  const maxHeight = height * (isMobile ? 0.48 : 0.78);
  const displayWidth = Math.min(maxWidth, maxHeight * (SOURCE_WIDTH / SOURCE_HEIGHT));
  const displayHeight = displayWidth * (SOURCE_HEIGHT / SOURCE_WIDTH);
  const centerX = width * (isMobile ? 0.5 : 0.53);
  const top = (height - displayHeight) * (isMobile ? 0.36 : 0.5);
  const left = centerX - displayWidth * 0.5;

  Object.assign(canvas.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${displayWidth}px`,
    height: `${displayHeight}px`
  });
  Object.assign(frame.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${displayWidth}px`,
    height: `${displayHeight}px`
  });
}

bindRange('shader-cell', (value) => {
  settings.cell = value;
  queueRender();
}, (value) => `${value.toFixed(0)} PX`);
bindRange('shader-detail', (value) => {
  settings.detailThreshold = value;
  queueRender();
}, (value) => value.toFixed(2));
bindRange('shader-gradation', (value) => {
  settings.gradation = value;
  queueRender();
}, (value) => `${value.toFixed(0)} LV`);
bindRange('shader-black', (value) => {
  settings.blackPoint = value;
  queueRender();
}, (value) => `${Math.round(value * 100)}%`);
bindRange('shader-white', (value) => {
  settings.whitePoint = value;
  queueRender();
}, (value) => `${Math.round(value * 100)}%`);
bindRange('shader-glyph-scale', (value) => {
  settings.glyphScale = value;
  queueRender();
}, (value) => `${Math.round(value * 100)}%`);
bindRange('shader-radius', (value) => {
  settings.radius = value;
}, (value) => `${value.toFixed(0)} PX`);
bindRange('shader-life', (value) => {
  settings.life = value;
}, (value) => `${value.toFixed(2)} S`);

document.querySelectorAll('#shader-mode button').forEach((button) => {
  button.addEventListener('click', () => {
    settings.mode = button.dataset.mode;
    document.querySelectorAll('#shader-mode button').forEach((item) => {
      item.classList.toggle('is-active', item === button);
    });
    queueRender();
  });
});

const maxScaleOutput = document.getElementById('shader-max-output');
document.querySelectorAll('#shader-max-scale button').forEach((button) => {
  button.addEventListener('click', () => {
    settings.maxScale = Number(button.dataset.scale);
    maxScaleOutput.textContent = `${settings.maxScale}×`;
    document.querySelectorAll('#shader-max-scale button').forEach((item) => {
      item.classList.toggle('is-active', item === button);
    });
    queueRender();
  });
});

document.getElementById('shader-invert').addEventListener('change', (event) => {
  settings.invert = event.target.checked;
  queueRender();
});

const rampPreview = document.getElementById('shader-ramp-preview');
function setRamp(name) {
  settings.ramp = name;
  rampPreview.style.background = `linear-gradient(90deg, ${rampPresets[name].join(', ')})`;
  document.querySelectorAll('#shader-ramp button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.ramp === name);
  });
  if (glyphs.length) bakeGlyphColors();
  queueRender();
}

document.querySelectorAll('#shader-ramp button').forEach((button) => {
  button.addEventListener('click', () => setRamp(button.dataset.ramp));
});
setRamp('blue');

const imageUpload = document.getElementById('shader-image-upload');
const imageReset = document.getElementById('shader-image-reset');
imageUpload.addEventListener('change', async () => {
  const [file] = imageUpload.files;
  if (!file) return;

  const imageName = document.getElementById('shader-image-name');
  const previousLabel = imageName.textContent;
  const objectUrl = URL.createObjectURL(file);
  imageName.textContent = 'LOADING…';
  try {
    const uploadedImage = await loadImage(objectUrl);
    customSourceActive = true;
    setSourceImage(uploadedImage, file.name.toUpperCase());
  } catch (error) {
    imageName.textContent = previousLabel;
    console.error('Uploaded image could not be decoded.', error);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
});
imageReset.addEventListener('click', () => {
  if (!defaultSourceImage) return;
  customSourceActive = false;
  imageUpload.value = '';
  setSourceImage(defaultSourceImage, 'DEFAULT X-RAY');
});

window.addEventListener('resize', updateLayout);
window.addEventListener('pointermove', handlePointerMove, { passive: true });
window.addEventListener('pointerdown', handlePointerMove, { passive: true });
updateLayout();

Promise.all([
  loadImage('/assets/dither-shader-xray.jpg'),
  Promise.all(Array.from({ length: GLYPH_COUNT }, (_, index) => (
    loadImage(`/glyphs/${String(index + 1).padStart(2, '0')}.svg`)
  )))
]).then(([loadedSource, glyphImages]) => {
  defaultSourceImage = loadedSource;
  if (!customSourceActive) setSourceImage(defaultSourceImage, 'DEFAULT X-RAY');

  // Match the supplied renderer: glyph density, not ZIP filename, determines
  // the light-to-dense order used by the tone bands.
  glyphs = glyphImages
    .map((image) => ({ image, coverage: measureCoverage(image), rasters: [] }))
    .sort((a, b) => a.coverage - b.coverage);
  bakeGlyphColors();
  ready = true;
  document.getElementById('shader-glyph-count').textContent = glyphs.length;
  render();
}).catch((error) => {
  document.getElementById('shader-source-state').textContent = 'LOAD ERROR';
  console.error('Static glyph renderer failed to initialize.', error);
});
