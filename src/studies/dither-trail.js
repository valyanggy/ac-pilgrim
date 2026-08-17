import { bindRange } from '../shared.js';

const canvas = document.querySelector('.dither-overlay');
const context = canvas.getContext('2d', { alpha: true });
const speedOutput = document.getElementById('trail-speed');
const pressureOutput = document.getElementById('trail-pressure');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const settings = {
  life: 1.25,
  spread: 1,
  density: 1
};

bindRange('trail-life', (value) => { settings.life = value; }, (value) => `${value.toFixed(2)} S`);
bindRange('trail-spread', (value) => { settings.spread = value; }, (value) => `${value.toFixed(2)}×`);
bindRange('trail-density', (value) => { settings.density = value; }, (value) => `${value.toFixed(2)}×`);

const glyphCount = 36;
const glyphs = [];
const particles = new Map();
const pointer = {
  x: window.innerWidth * 0.5,
  y: window.innerHeight * 0.5,
  previousX: window.innerWidth * 0.5,
  previousY: window.innerHeight * 0.5,
  time: performance.now(),
  speed: 0,
  pressure: 0.35,
  inputPressure: 0.35,
  pointerType: 'mouse',
  active: false
};

let width = 1;
let height = 1;
let pixelRatio = 1;
let animationFrame = 0;
let lastFrame = performance.now();
let baseCellSize = 12;
let gridTiles = [];
let tileLookup = new Map();
const bayer4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5
];

function addGridTile(column, row, scale) {
  const tile = {
    id: `${column}:${row}:${scale}`,
    column,
    row,
    scale,
    x: (column + scale * 0.5) * baseCellSize,
    y: (row + scale * 0.5) * baseCellSize,
    pixelSize: scale * baseCellSize
  };
  gridTiles.push(tile);
  for (let offsetY = 0; offsetY < scale; offsetY += 1) {
    for (let offsetX = 0; offsetX < scale; offsetX += 1) {
      tileLookup.set(`${column + offsetX}:${row + offsetY}`, tile);
    }
  }
}

function rebuildQuadtree() {
  gridTiles = [];
  tileLookup = new Map();
  const columns = Math.ceil(width / baseCellSize);
  const rows = Math.ceil(height / baseCellSize);

  for (let macroRow = 0; macroRow < rows; macroRow += 4) {
    for (let macroColumn = 0; macroColumn < columns; macroColumn += 4) {
      const macroNoise = hash(macroColumn, macroRow, 31);
      if (macroNoise > 0.8) {
        addGridTile(macroColumn, macroRow, 4);
        continue;
      }

      for (let childY = 0; childY < 4; childY += 2) {
        for (let childX = 0; childX < 4; childX += 2) {
          const column = macroColumn + childX;
          const row = macroRow + childY;
          const childNoise = hash(column, row, 47);
          if (childNoise > 0.46) {
            addGridTile(column, row, 2);
            continue;
          }

          addGridTile(column, row, 1);
          addGridTile(column + 1, row, 1);
          addGridTile(column, row + 1, 1);
          addGridTile(column + 1, row + 1, 1);
        }
      }
    }
  }
}

function makeTintedGlyph(image, color) {
  const size = 64;
  const buffer = document.createElement('canvas');
  buffer.width = size;
  buffer.height = size;
  const bufferContext = buffer.getContext('2d');
  bufferContext.drawImage(image, 0, 0, size, size);
  bufferContext.globalCompositeOperation = 'source-in';
  bufferContext.fillStyle = color;
  bufferContext.fillRect(0, 0, size, size);
  return buffer;
}

Promise.all(Array.from({ length: glyphCount }, (_, index) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = `/glyphs/${String(index + 1).padStart(2, '0')}.svg`;
}))).then((images) => {
  images.forEach((image) => {
    glyphs.push({
      signal: makeTintedGlyph(image, '#79e0cf'),
      light: makeTintedGlyph(image, '#f1f4ee')
    });
  });
});

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  baseCellSize = width < 760 ? 10 : 12;
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  particles.clear();
  rebuildQuadtree();
}

function hash(x, y, seed) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function addStamp(x, y, velocity, directionX, directionY, pressure) {
  if (!glyphs.length) return;

  const normalizedSpeed = Math.min(1, velocity / 1.45);
  if (normalizedSpeed < 0.035) return;

  const radiusX = (24 + normalizedSpeed * 112) * settings.spread;
  const pressureWidth = 0.28 + pressure * 1.72;
  const radiusY = (9 + normalizedSpeed * 34) * pressureWidth * settings.spread;
  const perpendicularX = -directionY;
  const perpendicularY = directionX;
  const range = Math.ceil(Math.max(radiusX, radiusY) / baseCellSize);
  const centerColumn = Math.floor(x / baseCellSize);
  const centerRow = Math.floor(y / baseCellSize);
  const visitedTiles = new Set();

  for (let column = centerColumn - range; column <= centerColumn + range; column += 1) {
    for (let row = centerRow - range; row <= centerRow + range; row += 1) {
      const tile = tileLookup.get(`${column}:${row}`);
      if (!tile || visitedTiles.has(tile.id)) continue;
      visitedTiles.add(tile.id);

      const deltaX = tile.x - x;
      const deltaY = tile.y - y;
      const along = deltaX * directionX + deltaY * directionY;
      const across = deltaX * perpendicularX + deltaY * perpendicularY;
      const ellipse = (along * along) / (radiusX * radiusX) + (across * across) / (radiusY * radiusY);
      if (ellipse > 1) continue;

      const noise = hash(tile.column, tile.row, 1);
      const bayer = bayer4[((tile.row & 3) * 4) + (tile.column & 3)] / 16;
      const pressureDensity = 0.58 + pressure * 0.62;
      const density = Math.max(0, (1 - ellipse) * (0.24 + normalizedSpeed * 0.86) * pressureDensity * settings.density);
      const scalePenalty = tile.scale === 4 ? 0.14 : tile.scale === 2 ? 0.05 : 0;
      if (noise * 0.38 + bayer * 0.62 + scalePenalty > density) continue;

      const key = tile.id;
      const particle = particles.get(key);
      const life = settings.life * (0.72 + noise * 0.48);
      if (particle) {
        particle.age = 0;
        particle.life = life;
        particle.intensity = Math.max(particle.intensity, normalizedSpeed);
        particle.pressure = Math.max(particle.pressure, pressure);
        continue;
      }

      particles.set(key, {
        key,
        column: tile.column,
        row: tile.row,
        scale: tile.scale,
        x: tile.x,
        y: tile.y,
        size: tile.pixelSize * 0.84,
        age: 0,
        life,
        intensity: normalizedSpeed,
        pressure,
        glyph: Math.floor(hash(tile.column, tile.row, 7 + tile.scale) * glyphCount),
        light: hash(tile.column, tile.row, 12) > 0.84
      });
    }
  }
}

function handlePointerMove(event) {
  const now = performance.now();
  const elapsed = Math.max(8, now - pointer.time);
  const deltaX = event.clientX - pointer.x;
  const deltaY = event.clientY - pointer.y;
  const distance = Math.hypot(deltaX, deltaY);
  const velocity = distance / elapsed;
  const directionX = distance > 0 ? deltaX / distance : 1;
  const directionY = distance > 0 ? deltaY / distance : 0;
  const steps = Math.max(1, Math.ceil(distance / 16));
  const normalizedSpeed = Math.min(1, velocity / 1.45);
  const hasRealPressure = event.pointerType === 'pen' || (event.pointerType === 'touch' && event.pressure > 0);
  const inputPressure = hasRealPressure
    ? Math.max(0.03, event.pressure)
    : 0.2 + normalizedSpeed * 0.8;
  pointer.inputPressure = inputPressure;
  pointer.pressure += (inputPressure - pointer.pressure) * (hasRealPressure ? 0.62 : 0.38);
  pointer.pointerType = event.pointerType;

  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    addStamp(
      pointer.x + deltaX * progress,
      pointer.y + deltaY * progress,
      velocity,
      directionX,
      directionY,
      pointer.pressure
    );
  }

  pointer.previousX = pointer.x;
  pointer.previousY = pointer.y;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.time = now;
  pointer.speed = Math.max(pointer.speed, velocity * 100);
  pointer.active = true;
}

function handlePointerRelease(event) {
  if (event.pointerType === 'pen' || event.pointerType === 'touch') {
    pointer.inputPressure = 0;
  }
}

function draw(now) {
  const delta = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  context.clearRect(0, 0, width, height);

  for (const particle of particles.values()) {
    particle.age += delta;
    if (particle.age >= particle.life) {
      particles.delete(particle.key);
      continue;
    }

    const progress = particle.age / particle.life;
    const fadeProgress = Math.max(0, (progress - 0.46) / 0.54);
    const flickerFrame = Math.floor(now / 58);
    const flicker = hash(particle.column, particle.row, flickerFrame);
    const rowPulse = hash(particle.row, flickerFrame, 83);
    const dropout = fadeProgress * (0.3 + rowPulse * 0.46);
    if (fadeProgress > 0 && flicker < dropout) continue;

    let alpha = Math.pow(1 - progress, 1.45) * Math.min(1, particle.age * 16);
    if (fadeProgress > 0) {
      const pulse = flicker > 0.84
        ? 1.48
        : 0.48 + flicker * 0.72;
      const alphaSteps = fadeProgress > 0.66 ? 3 : 5;
      alpha = Math.ceil(alpha * pulse * alphaSteps) / alphaSteps;
    }
    alpha = Math.min(1, alpha);

    const spriteSet = glyphs[particle.glyph];
    if (!spriteSet) continue;
    const digitalFlash = fadeProgress > 0.12 && flicker > 0.88;
    const sprite = particle.light || digitalFlash ? spriteSet.light : spriteSet.signal;
    const size = particle.size * (0.9 + particle.intensity * 0.1);

    context.globalAlpha = alpha * (particle.light ? 0.92 : 0.76);
    context.drawImage(sprite, particle.x - size * 0.5, particle.y - size * 0.5, size, size);
  }
  context.globalAlpha = 1;

  pointer.speed *= Math.pow(0.012, delta);
  if (pointer.pointerType !== 'pen') {
    pointer.inputPressure = 0.2 + Math.min(1, pointer.speed / 145) * 0.8;
  }
  pointer.pressure += (pointer.inputPressure - pointer.pressure) * Math.min(1, delta * 10);
  speedOutput.textContent = String(Math.min(999, Math.round(pointer.speed))).padStart(3, '0');
  pressureOutput.textContent = String(Math.round(pointer.pressure * 100)).padStart(2, '0');
  animationFrame = requestAnimationFrame(draw);
}

window.addEventListener('resize', resize);
window.addEventListener('pointermove', handlePointerMove, { passive: true });
window.addEventListener('pointerdown', handlePointerMove, { passive: true });
window.addEventListener('pointerup', handlePointerRelease, { passive: true });
window.addEventListener('pointercancel', handlePointerRelease, { passive: true });
window.addEventListener('pagehide', () => cancelAnimationFrame(animationFrame), { once: true });

resize();
if (!reduceMotion) animationFrame = requestAnimationFrame(draw);
else {
  speedOutput.textContent = '—';
  pressureOutput.textContent = '—';
}
