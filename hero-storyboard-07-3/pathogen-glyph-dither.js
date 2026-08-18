const GLYPH_COUNT = 36;
const defaults = {
  cell: 7,
  density: 1,
  threshold: .44,
  contrast: 4,
  noiseAmount: .04,
  noiseRate: 7,
  glyphRange: 4,
  colors: ['#ffffff', '#474747', '#ffffff', '#ff0000', '#ededed'],
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function glyphCoverage(image) {
  const tile = document.createElement('canvas');
  tile.width = 96;
  tile.height = 96;
  const context = tile.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, 96, 96);
  const pixels = context.getImageData(0, 0, 96, 96).data;
  let alpha = 0;
  for (let index = 3; index < pixels.length; index += 4) alpha += pixels[index];
  return alpha / 255 / (96 * 96);
}

function hash(x, y, salt = 0) {
  const value = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

export function initPathogenGlyphDither({ canvas, source }) {
  if (!canvas || !source) return { render() {} };
  const context = canvas.getContext('2d');
  const sourceCanvas = document.createElement('canvas');
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  let glyphs = [];
  let tintedGlyphs = [];
  let paletteSignature = '';
  let rendering = false;
  let noiseTick = 0;
  let noiseFrame = 0;
  let noiseActive = false;
  let lastNoiseAt = 0;
  const settings = { ...defaults };

  const glyphPromise = Promise.all(Array.from({ length: GLYPH_COUNT }, (_, index) => (
    loadImage(`/glyphs/${String(index + 1).padStart(2, '0')}.svg`)
  ))).then(images => images.sort((a, b) => glyphCoverage(a) - glyphCoverage(b)));

  function preparePalette() {
    const signature = settings.colors.join(',');
    if (signature === paletteSignature && tintedGlyphs.length) return;
    paletteSignature = signature;
    tintedGlyphs = settings.colors.map(color => glyphs.map(glyph => {
      const tile = document.createElement('canvas');
      tile.width = 96;
      tile.height = 96;
      const tileContext = tile.getContext('2d');
      tileContext.drawImage(glyph, 0, 0, 96, 96);
      tileContext.globalCompositeOperation = 'source-in';
      tileContext.fillStyle = color;
      tileContext.fillRect(0, 0, 96, 96);
      return tile;
    }));
  }

  async function render() {
    if (rendering || !source.complete || !source.naturalWidth) return;
    rendering = true;
    try {
      if (!glyphs.length) glyphs = await glyphPromise;
      preparePalette();
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.max(1, Math.round(bounds.width * pixelRatio));
      const height = Math.max(1, Math.round(bounds.height * pixelRatio));
      canvas.width = width;
      canvas.height = height;
      sourceCanvas.width = width;
      sourceCanvas.height = height;
      sourceContext.clearRect(0, 0, width, height);

      const scale = Math.min(width / source.naturalWidth, height / source.naturalHeight);
      const drawWidth = source.naturalWidth * scale;
      const drawHeight = source.naturalHeight * scale;
      const drawX = (width - drawWidth) / 2;
      const drawY = (height - drawHeight) / 2;
      sourceContext.drawImage(source, drawX, drawY, drawWidth, drawHeight);
      const pixels = sourceContext.getImageData(0, 0, width, height).data;
      const imageCorners = [
        [Math.ceil(drawX + 1), Math.ceil(drawY + 1)],
        [Math.floor(drawX + drawWidth - 2), Math.ceil(drawY + 1)],
        [Math.ceil(drawX + 1), Math.floor(drawY + drawHeight - 2)],
        [Math.floor(drawX + drawWidth - 2), Math.floor(drawY + drawHeight - 2)],
      ];
      const cornerAlpha = imageCorners.reduce((total, [x, y]) => total + pixels[(y * width + x) * 4 + 3] / 255, 0) / 4;
      const useAlphaMask = cornerAlpha < .08;
      const cell = Math.max(7, Math.round(settings.cell * pixelRatio));
      context.clearRect(0, 0, width, height);

      for (let y = 0, row = 0; y < height; y += cell, row += 1) {
        for (let x = 0, column = 0; x < width; x += cell, column += 1) {
          let luminance = 0;
          let alpha = 0;
          const sampleStep = Math.max(1, Math.floor(cell / 6));
          for (let py = y; py < Math.min(height, y + cell); py += sampleStep) {
            for (let px = x; px < Math.min(width, x + cell); px += sampleStep) {
              const offset = (py * width + px) * 4;
              luminance = Math.max(luminance, (pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722) / 255);
              alpha = Math.max(alpha, pixels[offset + 3] / 255);
            }
          }
          const modelSignal = useAlphaMask ? Math.max(luminance, alpha * .32) : luminance;
          const signal = Math.max(0, Math.min(1, (modelSignal - settings.threshold) * settings.contrast));
          const occupancy = (.25 + .75 * Math.max(0, Math.min(1, signal / .42))) * settings.density;
          if (signal <= .004 || hash(column, row) >= occupancy) continue;
          const baseGlyphIndex = Math.floor(signal * 33 + hash(column, row, 1) * 3);
          const glyphIndex = Math.max(0, Math.min(
            GLYPH_COUNT - 1,
            baseGlyphIndex + Math.floor(hash(column, row, noiseTick + 9) * settings.glyphRange),
          ));
          const paletteIndex = Math.max(0, Math.min(4, Math.floor(signal * 5)));
          const shimmer = 1 - settings.noiseAmount + hash(column, row, noiseTick + 17) * settings.noiseAmount;
          context.globalAlpha = (.5 + signal * .5) * shimmer;
          context.drawImage(tintedGlyphs[paletteIndex][glyphIndex], x, y, cell, cell);
        }
      }

      context.globalAlpha = 1;
    } finally {
      rendering = false;
    }
  }

  source.addEventListener('load', render);
  const observer = new ResizeObserver(render);
  observer.observe(canvas);
  render();

  function animateNoise(now) {
    if (!noiseActive) return;
    noiseFrame = requestAnimationFrame(animateNoise);
    if (now - lastNoiseAt < 1000 / settings.noiseRate) return;
    lastNoiseAt = now;
    noiseTick = (noiseTick + 1) % 997;
    render();
  }

  return {
    render,
    setOptions(options) {
      if (options.colors) settings.colors = [...options.colors];
      Object.assign(settings, options);
      render();
    },
    setActive(active) {
      if (active === noiseActive) return;
      noiseActive = active;
      if (active) {
        lastNoiseAt = 0;
        noiseFrame = requestAnimationFrame(animateNoise);
      } else {
        cancelAnimationFrame(noiseFrame);
      }
    },
    destroy() {
      noiseActive = false;
      cancelAnimationFrame(noiseFrame);
      observer.disconnect();
    },
  };
}
