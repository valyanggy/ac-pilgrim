import { THREE, bindRange } from '../shared.js';

const canvas = document.querySelector('.video-dither-canvas');
const video = document.getElementById('video-dither-source');
const loading = document.getElementById('video-dither-loading');
const loadingLabel = loading.querySelector('span');
const loadingOutput = loading.querySelector('output');
const stageOutput = document.getElementById('video-sequence-stage');
const playInput = document.getElementById('video-sequence-play');
const restartButton = document.getElementById('video-sequence-restart');
const page = document.querySelector('.video-dither-page');
const guiToggle = document.getElementById('video-gui-toggle');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const settings = {
  eraseDuration: 2.2,
  blankDuration: 1,
  revealDuration: 2.2,
  holdDuration: 3
};

const videoTexture = new THREE.VideoTexture(video);
videoTexture.colorSpace = THREE.SRGBColorSpace;
videoTexture.minFilter = THREE.LinearFilter;
videoTexture.magFilter = THREE.LinearFilter;
videoTexture.generateMipmaps = false;

const uniforms = {
  tVideo: { value: videoTexture },
  tContext: { value: new THREE.Texture() },
  tGlyphs: { value: new THREE.Texture() },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uVideoSize: { value: new THREE.Vector2(16, 9) },
  uContextSize: { value: new THREE.Vector2(1440, 900) },
  uCell: { value: 13 },
  uContrast: { value: 1.55 },
  uBlackCutoff: { value: 0.08 },
  uMode: { value: 0 },
  uTransition: { value: 0 },
  uStroke: { value: new THREE.Color('#1c81bd') }
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
    varying vec2 vUv;
    uniform sampler2D tVideo;
    uniform sampler2D tContext;
    uniform sampler2D tGlyphs;
    uniform vec2 uResolution;
    uniform vec2 uVideoSize;
    uniform vec2 uContextSize;
    uniform float uCell;
    uniform float uContrast;
    uniform float uBlackCutoff;
    uniform float uMode;
    uniform float uTransition;
    uniform vec3 uStroke;

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

    vec3 videoPalette(float value) {
      if (value < 0.20) return vec3(0.0, 0.0863, 0.1412);
      if (value < 0.40) return vec3(0.0, 0.2157, 0.3451);
      if (value < 0.60) return vec3(0.0, 0.2824, 0.4549);
      if (value < 0.80) return vec3(0.0, 0.3961, 0.6431);
      return vec3(0.3490, 0.7608, 1.0);
    }

    void main() {
      vec2 pixel = gl_FragCoord.xy;
      vec2 cellId = floor(pixel / uCell);
      vec2 cellCenter = (cellId + 0.5) * uCell;
      vec2 cellUv = cellCenter / uResolution;
      vec2 localUv = fract(pixel / uCell);
      vec2 videoUv = coverUv(cellUv, uVideoSize);
      vec2 contextUv = coverUv(vUv, uContextSize);
      vec2 contextCellUv = coverUv(cellUv, uContextSize);

      vec3 videoColor = texture2D(tVideo, videoUv).rgb;
      float sourceLuma = luma(videoColor);
      float signal = clamp((sourceLuma - uBlackCutoff) * uContrast, 0.0, 1.0);
      float glyphIndex = floor(clamp(signal * 35.0, 0.0, 35.0));
      float glyph = atlasAlpha(glyphIndex, localUv);
      float occupancy = mix(0.18, 1.0, smoothstep(0.02, 0.65, signal));
      float cellPick = hash21(cellId + vec2(7.0, 29.0));
      vec3 sourceColor = videoPalette(signal);
      vec3 videoDither = vec3(0.0);
      if (sourceLuma > uBlackCutoff && signal > 0.006 && cellPick < occupancy) {
        videoDither = sourceColor * glyph;
      }

      float topDown = 1.0 - cellUv.y;
      float organicOffset =
        (hash21(cellId + vec2(41.0, 13.0)) - 0.5) * 0.105
        + sin(cellUv.x * 10.0 + sin(cellUv.x * 4.0)) * 0.026
        + sin(cellUv.x * 23.0) * 0.012;
      float growthField = clamp(topDown + organicOffset, 0.0, 1.0);
      float eraseVisible = step(uTransition, growthField);
      float revealVisible = step(growthField, uTransition);
      float frontier = 1.0 - smoothstep(0.012, 0.044, abs(growthField - uTransition));
      float cellEdge = min(
        min(localUv.x, 1.0 - localUv.x),
        min(localUv.y, 1.0 - localUv.y)
      );
      float outline = 1.0 - smoothstep(
        1.0 / uCell,
        1.8 / uCell,
        cellEdge
      );

      vec3 contextColor = texture2D(tContext, contextUv).rgb;
      float contextSignal = luma(contextColor);
      float contextCellSignal = luma(texture2D(tContext, contextCellUv).rgb);
      float contextPixelMask = smoothstep(0.012, 0.045, contextSignal);
      float contextCellMask = smoothstep(0.008, 0.035, contextCellSignal);

      vec3 color = videoDither;
      if (uMode > 0.5 && uMode < 1.5) {
        color *= eraseVisible;
        color = mix(color, vec3(0.0), frontier);
        color = mix(color, uStroke, frontier * outline);
      } else if (uMode > 1.5 && uMode < 2.5) {
        color = vec3(0.0);
      } else if (uMode > 2.5 && uMode < 3.5) {
        float contextFrontier = frontier * contextCellMask;
        color = contextColor * revealVisible * contextPixelMask;
        color = mix(color, vec3(0.0), contextFrontier);
        color = mix(color, uStroke, contextFrontier * outline);
      } else if (uMode > 3.5) {
        color = contextColor * contextPixelMask;
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

function waitForVideoMetadata() {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    video.addEventListener('loadedmetadata', resolve, { once: true });
    video.addEventListener('error', () => reject(video.error || new Error('Video metadata failed')), { once: true });
    video.load();
  });
}

async function loadContextTexture() {
  const texture = await new THREE.TextureLoader().loadAsync('/assets/experiment-19-context.png');
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  uniforms.tContext.value.dispose();
  uniforms.tContext.value = texture;
}

let endedAt = null;
let running = true;
let lastStage = '';

function setStage(name) {
  if (name === lastStage) return;
  lastStage = name;
  stageOutput.textContent = name;
}

function restartSequence() {
  endedAt = null;
  video.currentTime = 0;
  uniforms.uMode.value = 0;
  uniforms.uTransition.value = 0;
  setStage('VIDEO');
  if (running) video.play().catch(() => {});
}

video.addEventListener('ended', () => {
  if (endedAt !== null) return;
  endedAt = Date.now();
  uniforms.uMode.value = 2;
  uniforms.uTransition.value = 0;
  setStage('VOID');
});

playInput.addEventListener('change', () => {
  running = playInput.checked;
  if (running) {
    if (video.ended && endedAt === null) restartSequence();
    else video.play().catch(() => {});
  } else {
    video.pause();
  }
});

restartButton.addEventListener('click', restartSequence);
canvas.addEventListener('click', restartSequence);

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

bindRange('video-cell', (value) => { uniforms.uCell.value = value; }, (value) => `${value.toFixed(0)} PX`);
bindRange('video-contrast', (value) => { uniforms.uContrast.value = value; }, (value) => `${value.toFixed(2)}×`);
bindRange('video-black-cutoff', (value) => { uniforms.uBlackCutoff.value = value; }, (value) => value.toFixed(2));
bindRange('video-erase-duration', (value) => { settings.eraseDuration = value; }, (value) => `${value.toFixed(1)} S`);
bindRange('video-blank-duration', (value) => { settings.blankDuration = value; }, (value) => `${value.toFixed(1)} S`);
bindRange('video-reveal-duration', (value) => { settings.revealDuration = value; }, (value) => `${value.toFixed(1)} S`);
bindRange('video-hold-duration', (value) => { settings.holdDuration = value; }, (value) => `${value.toFixed(2)} S`);

const strokeInput = document.getElementById('video-stroke-color');
const strokeOutput = document.querySelector('[data-for="video-stroke-color"]');
function updateStroke() {
  uniforms.uStroke.value.set(strokeInput.value);
  strokeOutput.textContent = strokeInput.value.toUpperCase();
}
strokeInput.addEventListener('input', updateStroke);
updateStroke();

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const expectedWidth = Math.round(width * renderer.getPixelRatio());
  const expectedHeight = Math.round(height * renderer.getPixelRatio());
  if (canvas.width === expectedWidth && canvas.height === expectedHeight) return;
  renderer.setSize(width, height, false);
  uniforms.uResolution.value.set(
    Math.max(1, renderer.domElement.width),
    Math.max(1, renderer.domElement.height)
  );
}

let animationFrame = 0;
function render(time) {
  animationFrame = requestAnimationFrame(render);
  resize();

  if (running && endedAt === null && Number.isFinite(video.duration)) {
    const eraseStart = Math.max(0, video.duration - settings.eraseDuration);
    if (video.currentTime >= eraseStart) {
      uniforms.uMode.value = 1;
      uniforms.uTransition.value = Math.min(
        1,
        (video.currentTime - eraseStart) / Math.max(0.01, settings.eraseDuration)
      );
      setStage('ERASE');
    } else {
      uniforms.uMode.value = 0;
      uniforms.uTransition.value = 0;
      setStage('VIDEO');
    }
  }

  if (running && endedAt !== null) {
    const elapsed = (Date.now() - endedAt) / 1000;
    const revealStart = settings.blankDuration;
    const revealEnd = revealStart + settings.revealDuration;
    const holdEnd = revealEnd + settings.holdDuration;
    if (elapsed < revealStart) {
      uniforms.uMode.value = 2;
      uniforms.uTransition.value = 0;
      setStage('VOID');
    } else if (elapsed < revealEnd) {
      uniforms.uMode.value = 3;
      uniforms.uTransition.value = (elapsed - revealStart) / settings.revealDuration;
      setStage('REVEAL');
    } else if (elapsed < holdEnd) {
      uniforms.uMode.value = 4;
      uniforms.uTransition.value = 1;
      setStage('CONTEXT');
    } else {
      restartSequence();
    }
  }

  renderer.render(scene, camera);
}

Promise.all([
  waitForVideoMetadata(),
  buildGlyphAtlas(),
  loadContextTexture()
]).then(() => {
  uniforms.uVideoSize.value.set(video.videoWidth || 16, video.videoHeight || 9);
  loading.classList.add('is-ready');
  loadingLabel.textContent = 'Video glyph relay ready';
  loadingOutput.textContent = `${video.duration.toFixed(1)} S`;
  restartSequence();
}).catch((error) => {
  loading.classList.add('is-error');
  loadingLabel.textContent = 'Video relay failed';
  loadingOutput.textContent = 'MEDIA ERR';
  console.error(error);
});

animationFrame = requestAnimationFrame(render);
window.addEventListener('pagehide', () => {
  cancelAnimationFrame(animationFrame);
  video.pause();
  videoTexture.dispose();
  uniforms.tContext.value.dispose();
  uniforms.tGlyphs.value.dispose();
  quad.geometry.dispose();
  material.dispose();
  renderer.dispose();
}, { once: true });
