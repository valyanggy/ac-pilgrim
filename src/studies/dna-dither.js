import '../styles.css';

const canvas = document.querySelector('.shader-canvas');
const frame = document.querySelector('.shader-image-frame');
const context = canvas.getContext('2d', { alpha: true });

const WIDTH = 640;
const HEIGHT = 353;
const GLYPH_COUNT = 36;
const RASTER_SIZE = 128;
const DNA = ['A', 'T', 'C', 'G'];
const OVERSCAN = 64;
const DNA_STYLES = [
  { background: '#008bc0', ink: '#ffffff' },
  { background: '#f12b16', ink: '#ffffff' },
  { background: '#ffffff', ink: '#000000' },
  { background: '#000000', ink: '#ffffff' }
];
const OUTPUT_SCALE = Math.min(3, Math.max(2, window.devicePixelRatio || 1));

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
  hoverMode: 'quad',
  hoverCell: 12,
  hoverDetailThreshold: 0.1,
  hoverMaxScale: 4,
  hoverGlyphScale: 0.9,
  hoverBleed: 18,
  dnaSeed: 143,
  radius: 72,
  hoverDensity: 1,
  life: 1.25
};

const rampPresets = {
  blue: ['#001725', '#003a5c', '#00689a', '#008bc0', '#60caff', '#f12b16'],
  green: ['#071b0a', '#0b3610', '#12651a', '#20a62a', '#63db35', '#b5ff67'],
  mono: ['#181818', '#3d3d3d', '#656565', '#929292', '#c5c5c5', '#f3f3f3']
};

canvas.width = Math.round((WIDTH + OVERSCAN * 2) * OUTPUT_SCALE);
canvas.height = Math.round((HEIGHT + OVERSCAN * 2) * OUTPUT_SCALE);
context.setTransform(
  OUTPUT_SCALE,
  0,
  0,
  OUTPUT_SCALE,
  OVERSCAN * OUTPUT_SCALE,
  OVERSCAN * OUTPUT_SCALE
);
context.imageSmoothingEnabled = true;
context.imageSmoothingQuality = 'high';

const sampleCanvas = document.createElement('canvas');
sampleCanvas.width = WIDTH;
sampleCanvas.height = HEIGHT;
const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });

const baseCanvas = document.createElement('canvas');
baseCanvas.width = Math.round(WIDTH * OUTPUT_SCALE);
baseCanvas.height = Math.round(HEIGHT * OUTPUT_SCALE);
const baseContext = baseCanvas.getContext('2d', { alpha: false });
baseContext.setTransform(OUTPUT_SCALE, 0, 0, OUTPUT_SCALE, 0, 0);
baseContext.imageSmoothingEnabled = true;
baseContext.imageSmoothingQuality = 'high';

let sourceData = null;
let glyphs = [];
let dnaRasters = [];
let baseCells = [];
let hoverCells = [];
let ready = false;
let baseCellsDirty = true;
let hoverCellsDirty = true;
let baseDirty = true;
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

function rasterizeGlyph(image, color) {
  const raster = document.createElement('canvas');
  raster.width = RASTER_SIZE;
  raster.height = RASTER_SIZE;
  const rasterContext = raster.getContext('2d');
  rasterContext.drawImage(image, 0, 0, RASTER_SIZE, RASTER_SIZE);
  rasterContext.globalCompositeOperation = 'source-in';
  rasterContext.fillStyle = color;
  rasterContext.fillRect(0, 0, RASTER_SIZE, RASTER_SIZE);
  return raster;
}

function rasterizeLetter(letter, color) {
  const raster = document.createElement('canvas');
  raster.width = RASTER_SIZE;
  raster.height = RASTER_SIZE;
  const rasterContext = raster.getContext('2d');
  rasterContext.fillStyle = color;
  rasterContext.font = '700 94px "DM Mono", "SFMono-Regular", monospace';
  rasterContext.textAlign = 'center';
  rasterContext.textBaseline = 'middle';
  rasterContext.fillText(letter, RASTER_SIZE / 2, RASTER_SIZE / 2 + 3);
  return raster;
}

function measureCoverage(image) {
  const mask = rasterizeGlyph(image, '#ffffff');
  const pixels = mask.getContext('2d').getImageData(0, 0, RASTER_SIZE, RASTER_SIZE).data;
  let alpha = 0;
  for (let index = 3; index < pixels.length; index += 4) alpha += pixels[index];
  return alpha / 255 / (RASTER_SIZE * RASTER_SIZE);
}

function bakeRasters() {
  const colors = rampPresets[settings.ramp];
  glyphs.forEach((glyph) => {
    glyph.rasters = colors.map((color) => rasterizeGlyph(glyph.image, color));
  });
  dnaRasters = DNA.map((letter, index) => rasterizeLetter(letter, DNA_STYLES[index].ink));
  baseDirty = true;
}

function regionStats(x, y, width, height) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(WIDTH, Math.ceil(x + width));
  const y1 = Math.min(HEIGHT, Math.ceil(y + height));
  let sum = 0;
  let sumSquares = 0;
  let count = 0;

  for (let sampleY = y0; sampleY < y1; sampleY += 1) {
    let pixel = (sampleY * WIDTH + x0) * 4;
    for (let sampleX = x0; sampleX < x1; sampleX += 1) {
      const value = sourceData.data[pixel];
      sum += value;
      sumSquares += value * value;
      count += 1;
      pixel += 4;
    }
  }

  if (!count) {
    const nearestX = Math.max(0, Math.min(WIDTH - 1, Math.floor(x + width * 0.5)));
    const nearestY = Math.max(0, Math.min(HEIGHT - 1, Math.floor(y + height * 0.5)));
    return {
      mean: sourceData.data[(nearestY * WIDTH + nearestX) * 4],
      deviation: 0
    };
  }
  const mean = sum / count;
  return {
    mean,
    deviation: Math.sqrt(Math.max(0, sumSquares / count - mean * mean))
  };
}

function gridCells(cellSize, margin = 0) {
  const result = [];
  const size = Math.max(2, cellSize);
  const startX = Math.floor(-margin / size) * size;
  const startY = Math.floor(-margin / size) * size;
  for (let y = startY; y < HEIGHT + margin; y += size) {
    for (let x = startX; x < WIDTH + margin; x += size) {
      result.push({ x, y, size, mean: regionStats(x, y, size, size).mean });
    }
  }
  return result;
}

function quadtreeCells(cellSize, maxScale, detailThreshold, margin = 0) {
  const result = [];
  const minimum = Math.max(2, cellSize);
  const rootSize = minimum * maxScale;

  function subdivide(x, y, size) {
    const stats = regionStats(x, y, size, size);
    if (size / 2 >= minimum && stats.deviation / 255 > detailThreshold) {
      const half = size / 2;
      subdivide(x, y, half);
      subdivide(x + half, y, half);
      subdivide(x, y + half, half);
      subdivide(x + half, y + half, half);
    } else {
      result.push({ x, y, size, mean: stats.mean });
    }
  }

  const startX = Math.floor(-margin / rootSize) * rootSize;
  const startY = Math.floor(-margin / rootSize) * rootSize;
  for (let y = startY; y < HEIGHT + margin; y += rootSize) {
    for (let x = startX; x < WIDTH + margin; x += rootSize) subdivide(x, y, rootSize);
  }
  return result;
}

function normalizedTone(mean) {
  let tone = mean / 255;
  if (settings.invert) tone = 1 - tone;
  const range = settings.whitePoint - settings.blackPoint;
  if (range > 0) tone = (tone - settings.blackPoint) / range;
  return Math.max(0, Math.min(1, tone));
}

function pilgrimIndex(tone) {
  let band = Math.min(settings.gradation - 1, Math.floor(tone * settings.gradation));
  if (band === 0 || !glyphs.length) return -1;
  const span = settings.gradation - 2;
  const position = span > 0 ? (band - 1) / span : 1;
  return Math.min(glyphs.length - 1, Math.round(position * (glyphs.length - 1)));
}

function rampIndex(tone) {
  return Math.min(5, Math.floor(tone * 6));
}

function refreshBaseCells() {
  if (!baseCellsDirty) return;
  baseCells = settings.mode === 'quad'
    ? quadtreeCells(settings.cell, settings.maxScale, settings.detailThreshold)
    : gridCells(settings.cell);
  baseCellsDirty = false;
  baseDirty = true;
  document.getElementById('shader-base-cell-count').textContent = baseCells.length.toLocaleString();
}

function refreshHoverCells() {
  if (!hoverCellsDirty) return;
  hoverCells = settings.hoverMode === 'quad'
    ? quadtreeCells(
      settings.hoverCell,
      settings.hoverMaxScale,
      settings.hoverDetailThreshold,
      settings.hoverBleed
    )
    : gridCells(settings.hoverCell, settings.hoverBleed);
  hoverCellsDirty = false;
  document.getElementById('shader-hover-cell-count').textContent = hoverCells.length.toLocaleString();
  updateSequenceStats();
}

function rebuildBase() {
  refreshBaseCells();
  if (!baseDirty) return;

  baseContext.fillStyle = '#000000';
  baseContext.fillRect(0, 0, WIDTH, HEIGHT);
  const padding = 1 - settings.glyphScale;

  baseCells.forEach((cell) => {
    const tone = normalizedTone(cell.mean);
    const glyphIndex = pilgrimIndex(tone);
    if (glyphIndex < 0) return;
    const inset = cell.size * padding * 0.5;
    const drawSize = cell.size - inset * 2;
    baseContext.drawImage(
      glyphs[glyphIndex].rasters[rampIndex(tone)],
      cell.x + inset,
      cell.y + inset,
      drawSize,
      drawSize
    );
  });
  baseDirty = false;
}

function cellHash(cell) {
  let value = Math.imul(Math.floor(cell.x) + 17, 374761393)
    ^ Math.imul(Math.floor(cell.y) + 31, 668265263)
    ^ Math.imul(Math.floor(cell.size) + 7, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function cellReveal(cell) {
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
  return cellHash(cell) < probability * settings.hoverDensity;
}

function sequenceHash(x, y, salt) {
  let value = Math.imul(x + 37 + settings.dnaSeed, 374761393)
    ^ Math.imul(y + 71, 668265263)
    ^ Math.imul(salt + settings.dnaSeed, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function dnaIndex(cell) {
  const gridX = Math.floor(cell.x / Math.max(1, settings.hoverCell));
  const gridY = Math.floor(cell.y / Math.max(1, settings.hoverCell));
  const pairColumn = Math.floor(gridX / 2);
  const useAT = sequenceHash(pairColumn, gridY, 11) < 0.5;
  const reverse = sequenceHash(pairColumn, gridY, 47) < 0.5;

  let first;
  let complement;
  if (useAT) {
    first = reverse ? 1 : 0;
    complement = reverse ? 0 : 1;
  } else {
    first = reverse ? 3 : 2;
    complement = reverse ? 2 : 3;
  }
  return gridX % 2 === 0 ? first : complement;
}

function updateSequenceStats() {
  const counts = [0, 0, 0, 0];
  let total = 0;
  hoverCells.forEach((cell) => {
    if (pilgrimIndex(normalizedTone(cell.mean)) < 0) return;
    counts[dnaIndex(cell)] += 1;
    total += 1;
  });
  document.getElementById('dna-sequence-stats').textContent = total
    ? counts.map((count, index) => `${DNA[index]} ${Math.round(count / total * 100)}%`).join(' · ')
    : 'NO SIGNAL';
}

function render() {
  renderQueued = false;
  if (!ready) return;
  rebuildBase();
  refreshHoverCells();
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.restore();
  context.drawImage(baseCanvas, 0, 0, WIDTH, HEIGHT);

  const padding = 1 - settings.hoverGlyphScale;
  const activeCells = hoverCells
    .filter((cell) => cellReveal(cell))
    .map((cell) => {
      const tone = normalizedTone(cell.mean);
      const signalIndex = pilgrimIndex(tone);
      return {
        cell,
        signalIndex,
        baseIndex: signalIndex < 0 ? -1 : dnaIndex(cell)
      };
    });

  // First establish the binary hover mask. Empty signal cells stay black.
  activeCells.forEach(({ cell }) => {
    context.fillStyle = '#000000';
    context.fillRect(cell.x, cell.y, cell.size, cell.size);
  });

  activeCells.forEach(({ cell, signalIndex, baseIndex }) => {
    if (signalIndex < 0) return;
    const inset = cell.size * padding * 0.5;
    const drawSize = cell.size - inset * 2;

    // Valid signal cells become one of four complete background/ink states.
    // The Pilgrim glyph and DNA state never coexist in the same cell.
    context.fillStyle = DNA_STYLES[baseIndex].background;
    context.fillRect(cell.x, cell.y, cell.size, cell.size);
    context.drawImage(
      dnaRasters[baseIndex],
      cell.x + inset,
      cell.y + inset,
      drawSize,
      drawSize
    );
  });
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

function invalidateBase({ structure = false } = {}) {
  if (structure) baseCellsDirty = true;
  baseDirty = true;
  if (ready && hoverCells.length) updateSequenceStats();
  queueRender();
}

function invalidateHover() {
  hoverCellsDirty = true;
  queueRender();
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
  const rect = frame.getBoundingClientRect();
  const inside = event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom;
  if (!inside) {
    previousPointer = null;
    return;
  }

  const point = {
    x: (event.clientX - rect.left) / rect.width * WIDTH,
    y: (event.clientY - rect.top) / rect.height * HEIGHT
  };
  const previous = previousPointer || point;
  const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
  const steps = Math.max(1, Math.ceil(distance / Math.max(6, settings.hoverCell * 0.8)));

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

function updateLayout() {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const isMobile = viewportWidth < 760;
  const maxWidth = viewportWidth * (isMobile ? 0.86 : 0.55);
  const maxHeight = viewportHeight * (isMobile ? 0.48 : 0.78);
  const displayWidth = Math.min(maxWidth, maxHeight * (WIDTH / HEIGHT));
  const displayHeight = displayWidth * (HEIGHT / WIDTH);
  const centerX = viewportWidth * 0.5;
  const top = (viewportHeight - displayHeight) * (isMobile ? 0.36 : 0.5);
  const left = centerX - displayWidth * 0.5;

  Object.assign(frame.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${displayWidth}px`,
    height: `${displayHeight}px`
  });

  const displayScale = displayWidth / WIDTH;
  Object.assign(canvas.style, {
    left: `${left - OVERSCAN * displayScale}px`,
    top: `${top - OVERSCAN * displayScale}px`,
    width: `${displayWidth + OVERSCAN * displayScale * 2}px`,
    height: `${displayHeight + OVERSCAN * displayScale * 2}px`
  });
}

bindRange('shader-cell', (value) => {
  settings.cell = value;
  invalidateBase({ structure: true });
}, (value) => `${value.toFixed(0)} PX`);
bindRange('shader-detail', (value) => {
  settings.detailThreshold = value;
  invalidateBase({ structure: true });
}, (value) => value.toFixed(2));
bindRange('shader-gradation', (value) => {
  settings.gradation = value;
  invalidateBase();
}, (value) => `${value.toFixed(0)} LV`);
bindRange('shader-black', (value) => {
  settings.blackPoint = value;
  invalidateBase();
}, (value) => `${Math.round(value * 100)}%`);
bindRange('shader-white', (value) => {
  settings.whitePoint = value;
  invalidateBase();
}, (value) => `${Math.round(value * 100)}%`);
bindRange('shader-glyph-scale', (value) => {
  settings.glyphScale = value;
  invalidateBase();
}, (value) => `${Math.round(value * 100)}%`);
bindRange('hover-cell', (value) => {
  settings.hoverCell = value;
  invalidateHover();
}, (value) => `${value.toFixed(0)} PX`);
bindRange('hover-detail', (value) => {
  settings.hoverDetailThreshold = value;
  invalidateHover();
}, (value) => value.toFixed(2));
bindRange('hover-glyph-scale', (value) => {
  settings.hoverGlyphScale = value;
  queueRender();
}, (value) => `${Math.round(value * 100)}%`);
bindRange('hover-bleed', (value) => {
  settings.hoverBleed = value;
  invalidateHover();
}, (value) => `${value.toFixed(0)} PX`);
bindRange('shader-radius', (value) => { settings.radius = value; }, (value) => `${value.toFixed(0)} PX`);
bindRange('hover-density', (value) => {
  settings.hoverDensity = value;
  queueRender();
}, (value) => `${Math.round(value * 100)}%`);
bindRange('shader-life', (value) => { settings.life = value; }, (value) => `${value.toFixed(2)} S`);

document.querySelectorAll('#shader-mode button').forEach((button) => {
  button.addEventListener('click', () => {
    settings.mode = button.dataset.mode;
    document.querySelectorAll('#shader-mode button').forEach((item) => {
      item.classList.toggle('is-active', item === button);
    });
    invalidateBase({ structure: true });
  });
});

document.querySelectorAll('#hover-mode button').forEach((button) => {
  button.addEventListener('click', () => {
    settings.hoverMode = button.dataset.mode;
    document.querySelectorAll('#hover-mode button').forEach((item) => {
      item.classList.toggle('is-active', item === button);
    });
    invalidateHover();
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
    invalidateBase({ structure: true });
  });
});

const hoverMaxScaleOutput = document.getElementById('hover-max-output');
document.querySelectorAll('#hover-max-scale button').forEach((button) => {
  button.addEventListener('click', () => {
    settings.hoverMaxScale = Number(button.dataset.scale);
    hoverMaxScaleOutput.textContent = `${settings.hoverMaxScale}×`;
    document.querySelectorAll('#hover-max-scale button').forEach((item) => {
      item.classList.toggle('is-active', item === button);
    });
    invalidateHover();
  });
});

document.getElementById('shader-invert').addEventListener('change', (event) => {
  settings.invert = event.target.checked;
  invalidateBase();
  updateSequenceStats();
});

document.getElementById('dna-reroll').addEventListener('click', () => {
  settings.dnaSeed = Math.floor(Math.random() * 0x7fffffff);
  updateSequenceStats();
  queueRender();
});

const rampPreview = document.getElementById('shader-ramp-preview');
function setRamp(name) {
  settings.ramp = name;
  rampPreview.style.background = `linear-gradient(90deg, ${rampPresets[name].join(', ')})`;
  document.querySelectorAll('#shader-ramp button').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.ramp === name);
  });
  if (glyphs.length) bakeRasters();
  invalidateBase();
}
document.querySelectorAll('#shader-ramp button').forEach((button) => {
  button.addEventListener('click', () => setRamp(button.dataset.ramp));
});
setRamp('blue');

window.addEventListener('resize', updateLayout);
window.addEventListener('pointermove', handlePointerMove, { passive: true });
window.addEventListener('pointerdown', handlePointerMove, { passive: true });
updateLayout();

Promise.all([
  loadImage('/assets/dither-shader-xray.jpg'),
  Promise.all(Array.from({ length: GLYPH_COUNT }, (_, index) => (
    loadImage(`/glyphs/${String(index + 1).padStart(2, '0')}.svg`)
  )))
]).then(async ([sourceImage, glyphImages]) => {
  await document.fonts.ready;
  sampleContext.drawImage(sourceImage, 0, 0, WIDTH, HEIGHT);
  sourceData = sampleContext.getImageData(0, 0, WIDTH, HEIGHT);
  glyphs = glyphImages
    .map((image) => ({ image, coverage: measureCoverage(image), rasters: [] }))
    .sort((a, b) => a.coverage - b.coverage);
  bakeRasters();
  ready = true;
  document.getElementById('shader-glyph-count').textContent = glyphs.length;
  render();
}).catch((error) => {
  document.getElementById('shader-source-state').textContent = 'LOAD ERROR';
  console.error('DNA dither renderer failed to initialize.', error);
});
