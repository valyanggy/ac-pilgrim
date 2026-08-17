import { THREE, bindRange } from '../shared.js';

const canvas = document.querySelector('.image-dither-canvas');
const page = document.querySelector('.image-dither-page');
const fileInput = document.getElementById('image-dither-file');
const fileOutput = document.querySelector('[data-for="image-dither-file"]');
const dropButton = document.getElementById('image-dither-drop');
const guiToggle = document.getElementById('image-dither-gui-toggle');
const loading = document.getElementById('image-dither-loading');
const loadingLabel = loading.querySelector('span');
const loadingOutput = loading.querySelector('output');
const sourceName = document.getElementById('image-dither-source-name');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const uniforms = {
  tImage: { value: new THREE.Texture() },
  tGlyphs: { value: new THREE.Texture() },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uImageSize: { value: new THREE.Vector2(16, 9) },
  uCell: { value: 13 },
  uContrast: { value: 1.55 },
  uBlackCutoff: { value: 0.08 },
  uDensity: { value: 1 },
  uColor1: { value: new THREE.Color('#001624') },
  uColor2: { value: new THREE.Color('#003758') },
  uColor3: { value: new THREE.Color('#004874') },
  uColor4: { value: new THREE.Color('#0065a4') },
  uColor5: { value: new THREE.Color('#59c2ff') }
};

const material = new THREE.ShaderMaterial({
  uniforms,
  depthTest: false,
  depthWrite: false,
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tImage;
    uniform sampler2D tGlyphs;
    uniform vec2 uResolution;
    uniform vec2 uImageSize;
    uniform float uCell;
    uniform float uContrast;
    uniform float uBlackCutoff;
    uniform float uDensity;
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform vec3 uColor3;
    uniform vec3 uColor4;
    uniform vec3 uColor5;

    float luma(vec3 color) {
      return dot(color, vec3(0.2126, 0.7152, 0.0722));
    }

    float hash21(vec2 value) {
      value = fract(value * vec2(123.34, 456.21));
      value += dot(value, value + 45.32);
      return fract(value.x * value.y);
    }

    vec2 coverUv(vec2 uv, vec2 mediaSize) {
      float screenAspect = uResolution.x / max(1.0, uResolution.y);
      float mediaAspect = mediaSize.x / max(1.0, mediaSize.y);
      vec2 scale = vec2(1.0);
      if (mediaAspect > screenAspect) {
        scale.x = screenAspect / mediaAspect;
      } else {
        scale.y = mediaAspect / screenAspect;
      }
      return (uv - 0.5) * scale + 0.5;
    }

    float atlasAlpha(float glyphIndex, vec2 localUv) {
      float column = mod(glyphIndex, 6.0);
      float row = floor(glyphIndex / 6.0);
      vec2 padded = mix(vec2(0.07), vec2(0.93), localUv);
      vec2 atlasUv = (vec2(column, 5.0 - row) + padded) / 6.0;
      return texture2D(tGlyphs, atlasUv).a;
    }

    vec3 palette(float value) {
      if (value < 0.20) return uColor1;
      if (value < 0.40) return uColor2;
      if (value < 0.60) return uColor3;
      if (value < 0.80) return uColor4;
      return uColor5;
    }

    void main() {
      vec2 pixel = gl_FragCoord.xy;
      vec2 cellId = floor(pixel / uCell);
      vec2 cellCenter = (cellId + 0.5) * uCell;
      vec2 localUv = fract(pixel / uCell);
      vec2 imageUv = coverUv(cellCenter / uResolution, uImageSize);
      vec3 imageColor = texture2D(tImage, imageUv).rgb;
      float sourceLuma = luma(imageColor);
      float signal = clamp((sourceLuma - uBlackCutoff) * uContrast, 0.0, 1.0);
      float glyphIndex = floor(clamp(signal * 35.0, 0.0, 35.0));
      float glyph = atlasAlpha(glyphIndex, localUv);
      float occupancy = uDensity * mix(0.18, 1.0, smoothstep(0.02, 0.65, signal));
      float cellPick = hash21(cellId + vec2(7.0, 29.0));
      vec3 color = vec3(0.0);
      if (sourceLuma > uBlackCutoff && signal > 0.006 && cellPick < occupancy) {
        color = palette(signal) * glyph;
      }
      gl_FragColor = vec4(color, 1.0);
    }
  `
});

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
scene.add(quad);

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
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

async function buildGlyphAtlas() {
  const images = await Promise.all(Array.from({ length: 36 }, (_, index) => (
    loadImage(`/glyphs/${String(index + 1).padStart(2, '0')}.svg`)
  )));
  images.sort((a, b) => glyphCoverage(a) - glyphCoverage(b));
  const atlas = document.createElement('canvas');
  atlas.width = 576;
  atlas.height = 576;
  const context = atlas.getContext('2d');
  images.forEach((image, index) => {
    context.drawImage(image, (index % 6) * 96 + 4, Math.floor(index / 6) * 96 + 4, 88, 88);
  });
  const texture = new THREE.CanvasTexture(atlas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  uniforms.tGlyphs.value.dispose();
  uniforms.tGlyphs.value = texture;
}

let objectUrl = null;
async function installImage(url, label, revokeAfterLoad = false) {
  loading.classList.remove('is-ready', 'is-error');
  loadingLabel.textContent = 'Translating image to glyphs';
  loadingOutput.textContent = 'LOAD';
  try {
    const texture = await new THREE.TextureLoader().loadAsync(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const image = texture.image;
    uniforms.tImage.value.dispose();
    uniforms.tImage.value = texture;
    uniforms.uImageSize.value.set(image.naturalWidth || image.width || 16, image.naturalHeight || image.height || 9);
    sourceName.textContent = label.toUpperCase();
    fileOutput.textContent = 'LOADED';
    loading.classList.add('is-ready');
    loadingLabel.textContent = 'Image glyph field ready';
    loadingOutput.textContent = `${uniforms.uImageSize.value.x} × ${uniforms.uImageSize.value.y}`;
    dropButton.classList.add('is-loaded');
  } catch (error) {
    loading.classList.add('is-error');
    loadingLabel.textContent = 'Image input failed';
    loadingOutput.textContent = 'IMAGE ERR';
    console.error(error);
  } finally {
    if (revokeAfterLoad) URL.revokeObjectURL(url);
  }
}

function acceptFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  installImage(objectUrl, file.name).finally(() => {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  });
}

fileInput.addEventListener('change', () => acceptFile(fileInput.files?.[0]));
dropButton.addEventListener('click', () => fileInput.click());
canvas.addEventListener('click', () => fileInput.click());
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  acceptFile(event.dataTransfer?.files?.[0]);
});

function setGuiHidden(hidden) {
  page.classList.toggle('is-recording-clean', hidden);
  guiToggle.setAttribute('aria-pressed', String(hidden));
  guiToggle.textContent = hidden ? 'Show GUI · H' : 'Hide GUI · H';
}

guiToggle.addEventListener('click', () => {
  setGuiHidden(!page.classList.contains('is-recording-clean'));
});

window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'h' || event.metaKey || event.ctrlKey || event.altKey) return;
  setGuiHidden(!page.classList.contains('is-recording-clean'));
});

bindRange('image-dither-cell', (value) => { uniforms.uCell.value = value; }, (value) => `${value.toFixed(0)} PX`);
bindRange('image-dither-contrast', (value) => { uniforms.uContrast.value = value; }, (value) => `${value.toFixed(2)}×`);
bindRange('image-dither-black-cutoff', (value) => { uniforms.uBlackCutoff.value = value; }, (value) => value.toFixed(2));
bindRange('image-dither-density', (value) => { uniforms.uDensity.value = value; }, (value) => `${Math.round(value * 100)}%`);

[
  ['image-dither-color-1', uniforms.uColor1],
  ['image-dither-color-2', uniforms.uColor2],
  ['image-dither-color-3', uniforms.uColor3],
  ['image-dither-color-4', uniforms.uColor4],
  ['image-dither-color-5', uniforms.uColor5]
].forEach(([id, uniform]) => {
  const input = document.getElementById(id);
  const output = document.querySelector(`[data-for="${id}"]`);
  const update = () => {
    uniform.value.set(input.value);
    output.textContent = input.value.toUpperCase();
  };
  input.addEventListener('input', update);
  update();
});

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const expectedWidth = Math.round(width * renderer.getPixelRatio());
  const expectedHeight = Math.round(height * renderer.getPixelRatio());
  if (canvas.width === expectedWidth && canvas.height === expectedHeight) return;
  renderer.setSize(width, height, false);
  uniforms.uResolution.value.set(Math.max(1, canvas.width), Math.max(1, canvas.height));
}

let animationFrame = 0;
function render() {
  animationFrame = requestAnimationFrame(render);
  resize();
  renderer.render(scene, camera);
}

Promise.all([
  buildGlyphAtlas(),
  installImage('/assets/dither-shader-xray.jpg', 'X-ray source')
]).catch((error) => console.error(error));

animationFrame = requestAnimationFrame(render);
window.addEventListener('pagehide', () => {
  cancelAnimationFrame(animationFrame);
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  uniforms.tImage.value.dispose();
  uniforms.tGlyphs.value.dispose();
  quad.geometry.dispose();
  material.dispose();
  renderer.dispose();
}, { once: true });
