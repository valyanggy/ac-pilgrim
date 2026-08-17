import { THREE, createStage, bindRange, seededRandom } from '../shared.js';

const DATASETS = {
  subway: { label: 'A', depth: '/assets/scan-mask-depth.png', ct: '/assets/scan-mask-ct.png' },
  mil: { label: 'B', depth: '/assets/scan-set-depth-mil.png', ct: '/assets/scan-set-ct-mil.png' },
  airport: { label: 'C', depth: '/assets/scan-set-depth-airport.png', ct: '/assets/scan-set-ct-airport.png' }
};

const canvas = document.querySelector('.webgl');
const page = document.querySelector('.study-page');
const guiToggle = document.getElementById('gui-toggle');
guiToggle.addEventListener('click', () => {
  const hidden = page.classList.toggle('is-gui-hidden');
  guiToggle.textContent = hidden ? 'Show GUI' : 'Hide GUI';
  guiToggle.setAttribute('aria-expanded', String(!hidden));
});

const stage = createStage(canvas, { camera: [0, 0.08, 11.5], fov: 43, fog: 0.006, background: 0x050707 });
const { scene } = stage;

const uniforms = {
  uPointer: { value: new THREE.Vector2() },
  uSlice: { value: 4.7 },
  uWidth: { value: 1.05 },
  uDepth: { value: 6.3 },
  uPoint: { value: 1.7 },
  uCtOpacity: { value: 0.94 },
  uSignal: { value: new THREE.Color('#ff2b1f') }
};

const material = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: `
    attribute float aLum;
    attribute float aEdge;
    attribute float aCt;
    attribute float aSeed;
    uniform vec2 uPointer;
    uniform float uSlice;
    uniform float uWidth;
    uniform float uDepth;
    uniform float uPoint;
    varying float vFocus;
    varying float vLum;
    varying float vCt;
    varying float vEdge;
    void main() {
      float z = (aLum - 0.12) * uDepth + (aSeed - 0.5) * 0.08;
      float focus = 1.0 - smoothstep(0.0, uWidth, abs(z - uSlice));
      float parallax = (z - 2.2) * 0.018;
      vec2 projected = vec2(position.x / 6.0, position.y / 3.8);
      projected += vec2(uPointer.x, -uPointer.y) * parallax;
      gl_Position = vec4(projected, clamp((z + 1.0) / 9.0, 0.0, 1.0), 1.0);
      gl_PointSize = uPoint + aLum * 1.0 + aEdge * 2.3 + focus * 2.6;
      vFocus = focus;
      vLum = aLum;
      vCt = aCt;
      vEdge = aEdge;
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform float uCtOpacity;
    uniform vec3 uSignal;
    varying float vFocus;
    varying float vLum;
    varying float vCt;
    varying float vEdge;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      float circle = smoothstep(0.5, 0.08, d);
      float mask = smoothstep(0.36, 0.82, vLum);
      float reveal = vFocus * mask * uCtOpacity;
      float bone = pow(vCt, 0.72);
      vec3 inactive = mix(vec3(0.018, 0.0, 0.0), vec3(0.34, 0.035, 0.025), smoothstep(0.08, 0.76, vLum));
      vec3 ctTone = vec3(bone * 1.55, bone * 0.22, bone * 0.14) + uSignal * (vEdge * 0.42 + reveal * 0.18);
      vec3 color = mix(inactive, ctTone, reveal);
      float alpha = circle * (0.055 + vLum * 0.12 + vEdge * 0.12 + reveal * (0.5 + bone * 0.72));
      gl_FragColor = vec4(color, alpha);
    }
  `
});

let cloud = null;
let imageLoadToken = 0;
let sliceTarget = 4.7;
let sliceCurrent = 4.7;

function luminanceAt(data, width, height, x, y) {
  const px = Math.max(0, Math.min(width - 1, x));
  const py = Math.max(0, Math.min(height - 1, y));
  const index = (py * width + px) * 4;
  return (data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722) / 255;
}

function buildVolume(depthImage, ctImage) {
  const random = seededRandom(910144);
  const depthCanvas = document.createElement('canvas');
  depthCanvas.width = depthImage.naturalWidth;
  depthCanvas.height = depthImage.naturalHeight;
  const depthContext = depthCanvas.getContext('2d', { willReadFrequently: true });
  depthContext.drawImage(depthImage, 0, 0);
  const { data: depthData } = depthContext.getImageData(0, 0, depthCanvas.width, depthCanvas.height);

  const ctCanvas = document.createElement('canvas');
  ctCanvas.width = depthImage.naturalWidth;
  ctCanvas.height = depthImage.naturalHeight;
  const ctContext = ctCanvas.getContext('2d', { willReadFrequently: true });
  ctContext.drawImage(ctImage, 0, 0, ctCanvas.width, ctCanvas.height);
  const { data: ctData } = ctContext.getImageData(0, 0, ctCanvas.width, ctCanvas.height);

  const positions = [];
  const lums = [];
  const edges = [];
  const cts = [];
  const seeds = [];
  const step = 2;
  const worldWidth = 10.7;
  const worldHeight = worldWidth * depthImage.naturalHeight / depthImage.naturalWidth;

  for (let y = 0; y < depthImage.naturalHeight; y += step) {
    for (let x = 0; x < depthImage.naturalWidth; x += step) {
      const lum = luminanceAt(depthData, depthImage.naturalWidth, depthImage.naturalHeight, x, y);
      const edge = Math.min(1, Math.abs(lum - luminanceAt(depthData, depthImage.naturalWidth, depthImage.naturalHeight, x + step * 2, y)) + Math.abs(lum - luminanceAt(depthData, depthImage.naturalWidth, depthImage.naturalHeight, x, y + step * 2)));
      const ctLum = luminanceAt(ctData, depthImage.naturalWidth, depthImage.naturalHeight, x, y);
      const keepChance = Math.min(1, 0.055 + lum * 0.36 + edge * 4.4 + (ctLum > 0.28 ? 0.46 : 0));
      if (random() > keepChance) continue;
      positions.push((x / depthImage.naturalWidth - 0.5) * worldWidth, (0.5 - y / depthImage.naturalHeight) * worldHeight, 0);
      lums.push(lum);
      edges.push(edge);
      cts.push(ctLum);
      seeds.push(random());
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aLum', new THREE.Float32BufferAttribute(lums, 1));
  geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edges, 1));
  geometry.setAttribute('aCt', new THREE.Float32BufferAttribute(cts, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  const nextCloud = new THREE.Points(geometry, material);
  nextCloud.frustumCulled = false;
  return nextCloud;
}

function loadImage(source) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.src = source;
  });
}

const datasetSelect = document.getElementById('asset-set');
const datasetOutput = document.querySelector('[data-for="asset-set"]');
async function setDataset(key) {
  const dataset = DATASETS[key] ?? DATASETS.subway;
  const token = ++imageLoadToken;
  datasetOutput.textContent = dataset.label;
  const [depthImage, ctImage] = await Promise.all([loadImage(dataset.depth), loadImage(dataset.ct)]);
  if (token !== imageLoadToken) return;
  if (cloud) {
    scene.remove(cloud);
    cloud.geometry.dispose();
  }
  cloud = buildVolume(depthImage, ctImage);
  scene.add(cloud);
}

datasetSelect.addEventListener('change', () => setDataset(datasetSelect.value));
setDataset(datasetSelect.value);

const sliceOutput = document.querySelector('[data-for="slice"]');
const sliceInput = bindRange('slice', (value) => { sliceTarget = value; }, (value) => `${value.toFixed(2)} Z`);
bindRange('width', (value) => { uniforms.uWidth.value = value; }, (value) => value.toFixed(2));
bindRange('depth', (value) => { uniforms.uDepth.value = value; }, (value) => `${value.toFixed(1)}x`);
bindRange('point', (value) => { uniforms.uPoint.value = value; }, (value) => value.toFixed(2));
bindRange('ct', (value) => { uniforms.uCtOpacity.value = value; }, (value) => `${Math.round(value * 100)}%`);

stage.start((time, pointer) => {
  sliceCurrent += (sliceTarget - sliceCurrent) * 0.12;
  uniforms.uSlice.value = sliceCurrent;
  sliceInput.value = String(sliceCurrent);
  sliceOutput.textContent = `${sliceCurrent.toFixed(2)} Z`;
  uniforms.uPointer.value.lerp(pointer, 0.04);
});

document.querySelector('.study-page').addEventListener('wheel', (event) => {
  event.preventDefault();
  sliceTarget = THREE.MathUtils.clamp(sliceTarget - event.deltaY * 0.0035, Number(sliceInput.min), Number(sliceInput.max));
}, { passive: false });
