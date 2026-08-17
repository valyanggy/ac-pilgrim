import '../styles.css';

const button = document.querySelector('.propagation-button');
const canvas = document.querySelector('.propagation-canvas');
const context = canvas.getContext('2d', { alpha: true });

const settings = {
  life: 0.72,
  cell: 24,
  radius: 170,
  density: 0.82,
  color: '#1c81bd'
};

const glyphCount = 36;
const canvasBleed = 260;
const sourceGlyphs = [];
let tintedGlyphs = [];
const cells = new Map();
const pointer = {
  x: 0,
  y: 0,
  previousX: 0,
  previousY: 0,
  velocity: 0,
  directionX: 1,
  directionY: 0,
  active: false
};

let width = 1;
let height = 1;
let buttonWidth = 1;
let buttonHeight = 1;
let pixelRatio = 1;
let lastTime = performance.now();
let lastStamp = 0;
let animationFrame = 0;
let gridTiles = [];
let tileLookup = new Map();
let hoverProgress = 0;

function hash(x, y, seed = 0) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function smoothstep(edge0, edge1, value) {
  const progress = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return progress * progress * (3 - 2 * progress);
}

function buttonBandInfluence(tile) {
  const centerX = tile.centerX;
  const centerY = tile.centerY;
  const left = canvasBleed;
  const top = canvasBleed;
  const right = left + buttonWidth;
  const bottom = top + buttonHeight;
  const outsideX = Math.max(left - centerX, 0, centerX - right);
  const outsideY = Math.max(top - centerY, 0, centerY - bottom);
  const outsideDistance = Math.hypot(outsideX, outsideY);
  const noiseOffset = (hash(tile.column, tile.row, 91 + tile.scale) - 0.5) * 34;

  if (outsideDistance > 0) {
    return 1 - smoothstep(70, 190, outsideDistance + noiseOffset);
  }

  const insideDepth = Math.min(
    centerX - left,
    right - centerX,
    centerY - top,
    bottom - centerY
  );
  return 1 - smoothstep(12, 64, insideDepth + noiseOffset * 0.42);
}

function addGridTile(column, row, scale) {
  const size = settings.cell * scale;
  const tile = {
    id: `${column}:${row}:${scale}`,
    column,
    row,
    scale,
    x: column * settings.cell,
    y: row * settings.cell,
    centerX: (column + scale * 0.5) * settings.cell,
    centerY: (row + scale * 0.5) * settings.cell,
    size
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
  const columns = Math.ceil(width / settings.cell);
  const rows = Math.ceil(height / settings.cell);

  for (let macroRow = 0; macroRow < rows; macroRow += 4) {
    for (let macroColumn = 0; macroColumn < columns; macroColumn += 4) {
      if (hash(macroColumn, macroRow, 31) > 0.82) {
        addGridTile(macroColumn, macroRow, 4);
        continue;
      }

      for (let childY = 0; childY < 4; childY += 2) {
        for (let childX = 0; childX < 4; childX += 2) {
          const column = macroColumn + childX;
          const row = macroRow + childY;
          if (hash(column, row, 47) > 0.48) {
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

function tintGlyph(image, color) {
  const size = 96;
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

function rebuildTintedGlyphs() {
  tintedGlyphs = sourceGlyphs.map((image) => tintGlyph(image, settings.color));
}

Promise.all(Array.from({ length: glyphCount }, (_, index) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = `/glyphs/${String(index + 1).padStart(2, '0')}.svg`;
}))).then((images) => {
  sourceGlyphs.push(...images);
  rebuildTintedGlyphs();
});

function resizeCanvas() {
  const bounds = button.getBoundingClientRect();
  buttonWidth = Math.max(1, Math.round(bounds.width));
  buttonHeight = Math.max(1, Math.round(bounds.height));
  width = buttonWidth + canvasBleed * 2;
  height = buttonHeight + canvasBleed * 2;
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.left = `${-canvasBleed}px`;
  canvas.style.top = `${-canvasBleed}px`;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  cells.clear();
  rebuildQuadtree();
}

function updatePointer(event) {
  const bounds = button.getBoundingClientRect();
  const x = Math.min(width, Math.max(0, event.clientX - bounds.left + canvasBleed));
  const y = Math.min(height, Math.max(0, event.clientY - bounds.top + canvasBleed));
  const deltaX = x - pointer.x;
  const deltaY = y - pointer.y;
  const distance = Math.hypot(deltaX, deltaY);

  pointer.previousX = pointer.x;
  pointer.previousY = pointer.y;
  pointer.x = x;
  pointer.y = y;
  pointer.velocity = Math.min(1, distance / Math.max(1, settings.cell * 0.8));
  if (distance > 0.5) {
    pointer.directionX = deltaX / distance;
    pointer.directionY = deltaY / distance;
  }
}

function addLocalCells(x, y, velocity = 0) {
  if (!tintedGlyphs.length) return;

  const cell = settings.cell;
  const radiusAlong = settings.radius * (1 + velocity * 0.42);
  const radiusAcross = settings.radius * 0.86;
  const perpendicularX = -pointer.directionY;
  const perpendicularY = pointer.directionX;
  const columnStart = Math.max(0, Math.floor((x - radiusAlong) / cell));
  const columnEnd = Math.min(Math.ceil(width / cell), Math.ceil((x + radiusAlong) / cell));
  const rowStart = Math.max(0, Math.floor((y - radiusAlong) / cell));
  const rowEnd = Math.min(Math.ceil(height / cell), Math.ceil((y + radiusAlong) / cell));
  const visitedTiles = new Set();

  for (let row = rowStart; row < rowEnd; row += 1) {
    for (let column = columnStart; column < columnEnd; column += 1) {
      const tile = tileLookup.get(`${column}:${row}`);
      if (!tile || visitedTiles.has(tile.id)) continue;
      visitedTiles.add(tile.id);

      const deltaX = tile.centerX - x;
      const deltaY = tile.centerY - y;
      const along = deltaX * pointer.directionX + deltaY * pointer.directionY;
      const across = deltaX * perpendicularX + deltaY * perpendicularY;
      const ellipse = (along * along) / (radiusAlong * radiusAlong)
        + (across * across) / (radiusAcross * radiusAcross);
      if (ellipse > 1) continue;

      const falloff = Math.pow(1 - ellipse, 0.72);
      const noise = hash(tile.column, tile.row, 7 + tile.scale);
      const connectedCore = 0.5 + settings.density * 0.38;
      const brokenBoundary = (noise - 0.5) * (0.18 + (1 - settings.density) * 0.42);
      if (ellipse > connectedCore + brokenBoundary) continue;

      const key = tile.id;
      const existing = cells.get(key);
      if (existing) {
        existing.idle = 0;
        existing.strength = Math.max(existing.strength, falloff);
        continue;
      }

      cells.set(key, {
        tile,
        age: 0,
        idle: 0,
        life: settings.life * (0.76 + hash(tile.column, tile.row, 13) * 0.46),
        strength: falloff,
        glyph: Math.floor(hash(tile.column, tile.row, 29 + tile.scale) * glyphCount)
      });
    }
  }
}

button.addEventListener('pointerenter', (event) => {
  updatePointer(event);
  pointer.previousX = pointer.x;
  pointer.previousY = pointer.y;
  pointer.active = true;
  button.classList.add('is-propagating');
  addLocalCells(pointer.x, pointer.y);
});

button.addEventListener('pointermove', (event) => {
  pointer.active = true;
  button.classList.add('is-propagating');
  const oldX = pointer.x;
  const oldY = pointer.y;
  updatePointer(event);
  const deltaX = pointer.x - oldX;
  const deltaY = pointer.y - oldY;
  const distance = Math.hypot(deltaX, deltaY);
  const sampleStep = Math.max(6, settings.cell * 0.34);
  const steps = Math.max(1, Math.ceil(distance / sampleStep));

  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    addLocalCells(
      oldX + deltaX * progress,
      oldY + deltaY * progress,
      pointer.velocity
    );
  }
});

button.addEventListener('pointerleave', (event) => {
  const bounds = button.getBoundingClientRect();
  const isStillInside = event.clientX >= bounds.left
    && event.clientX <= bounds.right
    && event.clientY >= bounds.top
    && event.clientY <= bounds.bottom;
  if (isStillInside) return;
  pointer.active = false;
  button.classList.remove('is-propagating');
});

window.addEventListener('pointermove', (event) => {
  if (!pointer.active) return;
  const bounds = button.getBoundingClientRect();
  const isInside = event.clientX >= bounds.left
    && event.clientX <= bounds.right
    && event.clientY >= bounds.top
    && event.clientY <= bounds.bottom;
  if (isInside) return;
  pointer.active = false;
  button.classList.remove('is-propagating');
});

button.addEventListener('focus', () => {
  pointer.x = width * 0.5;
  pointer.y = height * 0.5;
  pointer.previousX = pointer.x;
  pointer.previousY = pointer.y;
  pointer.active = true;
  button.classList.add('is-propagating');
  addLocalCells(pointer.x, pointer.y);
});

button.addEventListener('blur', () => {
  pointer.active = false;
  button.classList.remove('is-propagating');
});

function draw(time) {
  const delta = Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;
  context.clearRect(0, 0, width, height);

  const progressRate = pointer.active ? 1 / 1.8 : -1 / 0.7;
  hoverProgress = Math.max(0, Math.min(1, hoverProgress + progressRate * delta));
  const easedProgress = 1 - Math.pow(1 - hoverProgress, 2.2);
  const productProgress = Math.max(0, Math.min(1, (easedProgress - 0.475) / 0.525));
  button.style.setProperty('--hover-progress', easedProgress.toFixed(4));
  button.style.setProperty('--product-progress', `${(productProgress * 100).toFixed(2)}%`);

  if (pointer.active && time - lastStamp > 72) {
    addLocalCells(pointer.x, pointer.y, pointer.velocity * 0.35);
    lastStamp = time;
  }
  pointer.velocity *= Math.pow(0.025, delta);

  for (const [key, cellState] of cells) {
    cellState.age += delta;
    cellState.idle += delta;
    const hold = 0.14;
    if (cellState.idle >= cellState.life + hold) {
      cells.delete(key);
      continue;
    }

    const progress = Math.max(0, cellState.idle - hold) / cellState.life;
    const fade = Math.pow(1 - progress, 1.55);
    const appear = Math.min(1, cellState.age * 18);
    let alpha = Math.min(1, fade * appear * (0.42 + cellState.strength * 0.7));
    const deathProgress = Math.max(0, (progress - 0.62) / 0.38);
    if (deathProgress > 0) {
      const blinkFrame = Math.floor(time / 68);
      const blink = hash(cellState.tile.column, cellState.tile.row, blinkFrame + cellState.tile.scale * 17);
      if (blink < 0.22 + deathProgress * 0.58) continue;
      alpha *= blink > 0.82 ? 1.25 : 0.48;
      alpha = Math.ceil(alpha * 4) / 4;
    }

    const { x, y, size } = cellState.tile;
    const sprite = tintedGlyphs[cellState.glyph];
    const bandInfluence = buttonBandInfluence(cellState.tile);
    if (bandInfluence <= 0.015) continue;
    alpha *= bandInfluence;

    if (sprite) {
      const glyphSize = size * 0.78;
      context.globalAlpha = alpha;
      context.drawImage(
        sprite,
        x + (size - glyphSize) * 0.5,
        y + (size - glyphSize) * 0.5,
        glyphSize,
        glyphSize
      );
    }
  }

  context.globalAlpha = 1;
  animationFrame = requestAnimationFrame(draw);
}

function bindRange(id, key, format, onUpdate) {
  const input = document.getElementById(id);
  const output = document.querySelector(`[data-for="${id}"]`);
  const update = () => {
    settings[key] = Number(input.value);
    output.textContent = format(settings[key]);
    onUpdate?.();
  };
  input.addEventListener('input', update);
  update();
}

bindRange('hover-life', 'life', (value) => `${value.toFixed(2)} S`);
bindRange('hover-cell', 'cell', (value) => `${value} PX`, () => {
  cells.clear();
  rebuildQuadtree();
});
bindRange('hover-radius', 'radius', (value) => `${value} PX`);
bindRange('hover-density', 'density', (value) => `${Math.round(value * 100)}%`);

const colorInput = document.getElementById('hover-color');
const colorOutput = document.querySelector('[data-for="hover-color"]');
colorInput.addEventListener('input', () => {
  settings.color = colorInput.value;
  colorOutput.textContent = colorInput.value.toUpperCase();
  rebuildTintedGlyphs();
});
colorInput.dispatchEvent(new Event('input'));

new ResizeObserver(resizeCanvas).observe(button);
resizeCanvas();
animationFrame = requestAnimationFrame(draw);
window.addEventListener('pagehide', () => cancelAnimationFrame(animationFrame), { once: true });
