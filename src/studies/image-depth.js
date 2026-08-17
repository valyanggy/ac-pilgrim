import { THREE, createStage, bindRange, seededRandom } from '../shared.js';

const DATASETS = {
  device: { label: 'A', image: '/assets/image-depth-machine.png' },
  subway: { label: 'B', image: '/assets/image-depth-subway.png' },
  soldier: { label: 'C', image: '/assets/image-depth-soldier.png' }
};

const canvas = document.querySelector('.webgl');
const stage = createStage(canvas, { camera: [0, 0.1, 11.8], fov: 43, fog: 0 });
const { scene, camera } = stage;

const uniforms = {
  uSlice: { value: 2.1 },
  uWidth: { value: 1 },
  uDepth: { value: 6.5 },
  uSignal: { value: new THREE.Color('#79e0cf') }
};

const material = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: `
    attribute float aLum;
    attribute float aEdge;
    attribute float aSeed;
    uniform float uSlice;
    uniform float uWidth;
    uniform float uDepth;
    varying float vFocus;
    varying float vAlpha;
    varying float vLum;
    void main() {
      vec3 p = position;
      p.z = (aLum - 0.12) * uDepth + (aSeed - .5) * .08;
      vFocus = 1.0 - smoothstep(0.0, uWidth, abs(p.z - uSlice));
      vLum = aLum;
      vAlpha = mix(.34 + aLum * .46 + min(aEdge * 1.4, .2), 1.0, vFocus);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = mix(1.3 + aLum * .95 + min(aEdge * 2.2, .7), 3.0, vFocus) * (9.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform vec3 uSignal;
    varying float vFocus;
    varying float vAlpha;
    varying float vLum;
    void main() {
      float d = length(gl_PointCoord - .5);
      if (d > .5) discard;
      vec3 inactive = mix(uSignal * .52, uSignal, smoothstep(.08, .65, vLum));
      vec3 color = mix(inactive, vec3(.99), pow(vFocus, 1.25));
      gl_FragColor = vec4(color, vAlpha * smoothstep(.5, .08, d));
    }
  `
});

let cloud = null;
let loadToken = 0;
let sliceTarget = 2.1;
let sliceCurrent = 2.1;

const datasetSelect = document.getElementById('asset-set');
const datasetOutput = document.querySelector('[data-for="asset-set"]');
const sliceOutput = document.querySelector('[data-for="slice"]');
const sliceInput = bindRange('slice', (v) => { sliceTarget = v; }, (v) => `${v.toFixed(2)} Z`);
bindRange('width', (v) => { uniforms.uWidth.value = v; }, (v) => v.toFixed(2));
bindRange('depth', (v) => { uniforms.uDepth.value = v; }, (v) => `${v.toFixed(1)}x`);

function luminanceAt(data, width, height, x, y) {
  const px = Math.max(0, Math.min(width - 1, x));
  const py = Math.max(0, Math.min(height - 1, y));
  const index = (py * width + px) * 4;
  return (data[index] * .2126 + data[index + 1] * .7152 + data[index + 2] * .0722) / 255;
}

function buildPointCloud(image) {
  const random = seededRandom(336925);
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = image.naturalWidth;
  sampleCanvas.height = image.naturalHeight;
  const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
  const positions = [];
  const luminance = [];
  const edges = [];
  const seeds = [];
  const step = 2;
  const worldWidth = 9.8;
  const worldHeight = worldWidth * image.naturalHeight / image.naturalWidth;

  for (let y = 0; y < image.naturalHeight; y += step) {
    for (let x = 0; x < image.naturalWidth; x += step) {
      const lum = luminanceAt(data, image.naturalWidth, image.naturalHeight, x, y);
      const edge = Math.min(1, Math.abs(lum - luminanceAt(data, image.naturalWidth, image.naturalHeight, x + step, y)) + Math.abs(lum - luminanceAt(data, image.naturalWidth, image.naturalHeight, x, y + step)));
      const keepChance = Math.min(1, .14 + lum * .72 + edge * 3.8);
      if (random() > keepChance) continue;
      positions.push((x / image.naturalWidth - .5) * worldWidth, (.5 - y / image.naturalHeight) * worldHeight, 0);
      luminance.push(lum);
      edges.push(edge);
      seeds.push(random());
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aLum', new THREE.Float32BufferAttribute(luminance, 1));
  geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edges, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  return new THREE.Points(geometry, material);
}

function setDataset(key) {
  const dataset = DATASETS[key] ?? DATASETS.device;
  datasetOutput.textContent = dataset.label;
  const token = ++loadToken;
  const image = new Image();
  image.onload = () => {
    if (token !== loadToken) return;
    if (cloud) {
      scene.remove(cloud);
      cloud.geometry.dispose();
    }
    cloud = buildPointCloud(image);
    scene.add(cloud);
  };
  image.src = dataset.image;
}

datasetSelect.addEventListener('change', () => setDataset(datasetSelect.value));
setDataset(datasetSelect.value);

stage.start((time, pointer) => {
  sliceCurrent += (sliceTarget - sliceCurrent) * .12;
  uniforms.uSlice.value = sliceCurrent;
  sliceInput.value = String(sliceCurrent);
  sliceOutput.textContent = `${sliceCurrent.toFixed(2)} Z`;
  if (!cloud) return;
  cloud.rotation.y += (pointer.x * .07 - cloud.rotation.y) * .035;
  cloud.rotation.x += (-pointer.y * .025 - cloud.rotation.x) * .035;
  camera.position.x += (pointer.x * .18 - camera.position.x) * .025;
  camera.lookAt(0, 0, 1.1);
});

document.querySelector('.study-page').addEventListener('wheel', (event) => {
  event.preventDefault();
  const min = Number(sliceInput.min);
  const max = Number(sliceInput.max);
  sliceTarget = THREE.MathUtils.clamp(sliceTarget - event.deltaY * .0035, min, max);
}, { passive: false });
