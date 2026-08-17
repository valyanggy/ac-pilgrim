import { THREE, createStage, bindRange, seededRandom } from '../shared.js';

const DEFAULT_DATASETS = [
  { key: 'device', label: 'A', name: 'Device', image: '/assets/image-depth-machine.png' },
  { key: 'subway', label: 'B', name: 'Subway', image: '/assets/image-depth-subway.png' },
  { key: 'soldier', label: 'C', name: 'Soldier', image: '/assets/image-depth-soldier.png' }
];

let datasets = DEFAULT_DATASETS.map((dataset) => ({ ...dataset }));

const canvas = document.querySelector('.webgl');
const stage = createStage(canvas, { camera: [0, 0.1, 14.8], fov: 44, fog: 0 });
const { scene, camera } = stage;
scene.fog = null;

const controlsState = {
  width: 0.72,
  depth: 6.5,
  scanTiming: 0,
  scanSpeed: 1,
  farPoints: 0.65,
  imageGap: 15,
  pointDensity: 0.85,
  pointColor: '#79e0cf'
};

function createPointMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSlice: { value: 5.55 },
      uWidth: { value: controlsState.width },
      uDepth: { value: controlsState.depth },
      uFocusMix: { value: 1 },
      uOpacity: { value: 1 },
      uFarVisibility: { value: controlsState.farPoints },
      uDensity: { value: controlsState.pointDensity },
      uSignal: { value: new THREE.Color(controlsState.pointColor) }
    },
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
      uniform float uFocusMix;
      uniform float uOpacity;
      uniform float uFarVisibility;
      uniform float uDensity;
      varying float vFocus;
      varying float vAlpha;
      varying float vLum;
      void main() {
        vec3 p = position;
        p.z = (aLum - 0.12) * uDepth + (aSeed - .5) * .1;
        vFocus = (1.0 - smoothstep(0.0, uWidth, abs(p.z - uSlice))) * uFocusMix;
        vLum = aLum;
        float farGain = mix(.22, 1.45, uFarVisibility);
        float densityMask = step(aSeed, uDensity);
        vAlpha = mix((.2 + aLum * .52 + min(aEdge * 1.6, .26)) * farGain, 1.0, vFocus) * uOpacity * densityMask;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = mix(1.1 + aLum * 1.05 + min(aEdge * 2.3, .75), 3.2, vFocus) * (9.5 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uSignal;
      uniform float uFarVisibility;
      varying float vFocus;
      varying float vAlpha;
      varying float vLum;
      void main() {
        float d = length(gl_PointCoord - .5);
        if (d > .5) discard;
        float farLight = mix(.3, 1.35, uFarVisibility);
        vec3 inactive = mix(uSignal * .5, uSignal * 1.08, smoothstep(.08, .68, vLum)) * farLight;
        vec3 color = mix(inactive, vec3(.99), pow(vFocus, 1.2));
        gl_FragColor = vec4(color, vAlpha * smoothstep(.5, .08, d));
      }
    `
  });
}

const clouds = [];
let travelTarget = 0.38;
let travelCurrent = 0.38;

const datasetOutput = document.querySelector('[data-for="asset-set"]');
const sequenceCurrent = document.getElementById('sequence-current');
const travelInput = document.getElementById('travel');
const travelOutput = document.querySelector('[data-for="travel"]');
const imageInput = document.getElementById('image-input');
const sequenceEditor = document.getElementById('sequence-editor');
const sequenceList = document.getElementById('sequence-list');
const sequenceEditorStatus = document.getElementById('sequence-editor-status');
const pointColorInput = document.getElementById('point-color');
const pointColorOutput = document.querySelector('[data-for="point-color"]');
const objectUrls = new Set();
let customMode = false;
let draggedKey = null;

travelInput.addEventListener('input', () => {
  travelTarget = Math.floor(travelTarget) + Number(travelInput.value);
});

bindRange('width', (value) => {
  controlsState.width = value;
  clouds.forEach(({ material }) => { material.uniforms.uWidth.value = value; });
}, (value) => value.toFixed(2));

bindRange('depth', (value) => {
  controlsState.depth = value;
  clouds.forEach(({ material }) => { material.uniforms.uDepth.value = value; });
}, (value) => `${value.toFixed(1)}x`);

bindRange('scan-timing', (value) => { controlsState.scanTiming = value; }, (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`);
bindRange('scan-speed', (value) => { controlsState.scanSpeed = value; }, (value) => `${value.toFixed(2)}x`);
bindRange('far-points', (value) => {
  controlsState.farPoints = value;
  clouds.forEach(({ material }) => { material.uniforms.uFarVisibility.value = value; });
}, (value) => `${Math.round(value * 100)}%`);

bindRange('image-gap', (value) => { controlsState.imageGap = value; }, (value) => `${value.toFixed(1)} Z`);
bindRange('point-density', (value) => {
  controlsState.pointDensity = value;
  clouds.forEach(({ material }) => { material.uniforms.uDensity.value = value; });
}, (value) => `${Math.round(value * 100)}%`);

pointColorInput.addEventListener('input', () => {
  controlsState.pointColor = pointColorInput.value;
  pointColorOutput.textContent = pointColorInput.value.toUpperCase();
  clouds.forEach(({ material }) => { material.uniforms.uSignal.value.set(pointColorInput.value); });
});

function luminanceAt(data, width, height, x, y) {
  const px = Math.max(0, Math.min(width - 1, x));
  const py = Math.max(0, Math.min(height - 1, y));
  const index = (py * width + px) * 4;
  return (data[index] * .2126 + data[index + 1] * .7152 + data[index + 2] * .0722) / 255;
}

function buildPointCloud(image, material, seed, step) {
  const random = seededRandom(seed);
  const sampleCanvas = document.createElement('canvas');
  const sampleScale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
  sampleCanvas.width = Math.round(image.naturalWidth * sampleScale);
  sampleCanvas.height = Math.round(image.naturalHeight * sampleScale);
  const sampleWidth = sampleCanvas.width;
  const sampleHeight = sampleCanvas.height;
  const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const { data } = context.getImageData(0, 0, sampleWidth, sampleHeight);
  const positions = [];
  const luminance = [];
  const edges = [];
  const seeds = [];
  const worldWidth = 9.8;
  const worldHeight = worldWidth * sampleHeight / sampleWidth;

  for (let y = 0; y < sampleHeight; y += step) {
    for (let x = 0; x < sampleWidth; x += step) {
      const lum = luminanceAt(data, sampleWidth, sampleHeight, x, y);
      const edge = Math.min(1, Math.abs(lum - luminanceAt(data, sampleWidth, sampleHeight, x + step, y)) + Math.abs(lum - luminanceAt(data, sampleWidth, sampleHeight, x, y + step)));
      const keepChance = Math.min(1, .14 + lum * .72 + edge * 3.8);
      if (random() > keepChance) continue;
      positions.push((x / sampleWidth - .5) * worldWidth, (.5 - y / sampleHeight) * worldHeight, 0);
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

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

let sequenceToken = 0;

function normalizeDatasets(items) {
  return items.map((dataset, index) => ({ ...dataset, label: String.fromCharCode(65 + index) }));
}

function renderSequenceEditor() {
  sequenceList.replaceChildren(...datasets.map((dataset) => {
    const item = document.createElement('div');
    item.className = 'sequence-item';
    item.draggable = true;
    item.dataset.key = dataset.key;

    const drag = document.createElement('span');
    drag.className = 'sequence-drag';
    drag.textContent = '::::';

    const thumb = document.createElement('img');
    thumb.className = 'sequence-thumb';
    thumb.src = dataset.image;
    thumb.alt = '';

    const name = document.createElement('span');
    name.className = 'sequence-item-name';
    name.textContent = `${dataset.label} · ${dataset.name ?? dataset.key}`;

    const remove = document.createElement('button');
    remove.className = 'sequence-delete';
    remove.type = 'button';
    remove.dataset.deleteKey = dataset.key;
    remove.setAttribute('aria-label', `Delete ${dataset.name ?? dataset.key}`);
    remove.textContent = '×';
    remove.disabled = datasets.length <= 2;

    item.append(drag, thumb, name, remove);
    return item;
  }));
  sequenceEditorStatus.textContent = `${datasets.length} images · drag to reorder · drop to add`;
}

async function loadSequence(nextDatasets) {
  const token = ++sequenceToken;
  sequenceEditorStatus.textContent = 'Building point clouds…';
  const images = await Promise.all(nextDatasets.map((dataset) => loadImage(dataset.image)));
  if (token !== sequenceToken) return;

  clouds.splice(0).forEach(({ cloud, material }) => {
    scene.remove(cloud);
    cloud.geometry.dispose();
    material.dispose();
  });

  datasets = normalizeDatasets(nextDatasets);
  const sampleStep = datasets.length > 4 ? 3 : 2;
  images.forEach((image, datasetIndex) => {
    const material = createPointMaterial();
    const cloud = buildPointCloud(image, material, 336925 + datasetIndex * 7919, sampleStep);
    clouds.push({ cloud, material, datasetIndex });
    scene.add(cloud);
  });
  travelTarget = 0.16;
  travelCurrent = 0.16;
  renderSequenceEditor();
}

loadSequence(datasets).catch(() => { sequenceEditorStatus.textContent = 'Image load failed'; });

function occurrenceFor(datasetIndex, travel) {
  return datasetIndex + Math.round((travel - datasetIndex) / datasets.length) * datasets.length;
}

function smoothRange(value, start, end) {
  return THREE.MathUtils.smoothstep(value, start, end);
}

const lookTarget = new THREE.Vector3();
stage.start((time, pointer) => {
  travelCurrent += (travelTarget - travelCurrent) * .068;
  const segment = Math.floor(travelCurrent);
  const localTravel = travelCurrent - segment;
  const easedLocal = THREE.MathUtils.smootherstep(localTravel, 0, 1);
  const currentDatasetIndex = ((segment % datasets.length) + datasets.length) % datasets.length;
  const nextDatasetIndex = (currentDatasetIndex + 1) % datasets.length;

  travelInput.value = String(localTravel);
  travelOutput.textContent = `${Math.round(localTravel * 100)}%`;
  const currentName = datasets[currentDatasetIndex].name ?? datasets[currentDatasetIndex].key;
  const nextName = datasets[nextDatasetIndex].name ?? datasets[nextDatasetIndex].key;
  sequenceCurrent.textContent = `${currentName} → ${nextName}`;
  datasetOutput.textContent = `${datasets[currentDatasetIndex].label}→${datasets[nextDatasetIndex].label}`;

  camera.position.x += (Math.sin(easedLocal * Math.PI) * .32 + pointer.x * .16 - camera.position.x) * .045;
  camera.position.y += (.08 - pointer.y * .1 - camera.position.y) * .045;
  camera.position.z += (14.8 - camera.position.z) * .06;
  lookTarget.set(pointer.x * .14, pointer.y * .06, .8 + easedLocal * 1.25);
  camera.lookAt(lookTarget);

  clouds.forEach(({ cloud, material, datasetIndex }) => {
    const occurrence = occurrenceFor(datasetIndex, travelCurrent);
    const relative = travelCurrent - occurrence;
    const local = THREE.MathUtils.clamp(relative, 0, 1);
    const focusIn = smoothRange(relative, -.34, -.02);
    const focusOut = 1 - smoothRange(relative, .82, 1.06);
    const focusMix = focusIn * focusOut;
    const layerEnter = smoothRange(relative, -1.05, -.05);
    const layerExit = 1 - smoothRange(relative, .72, 1.04);
    const layerOpacity = Math.max(.06, layerEnter * layerExit);

    cloud.position.z = relative * controlsState.imageGap;
    const cameraToCloud = camera.position.z - cloud.position.z;
    const scanSlice = THREE.MathUtils.clamp((cameraToCloud - 5.7) * controlsState.scanSpeed + 2.6 + controlsState.scanTiming, -.35, 5.55);
    cloud.rotation.y += (pointer.x * .045 + (local - .5) * .02 - cloud.rotation.y) * .035;
    cloud.rotation.x += (-pointer.y * .018 - cloud.rotation.x) * .035;
    material.uniforms.uSlice.value += (scanSlice - material.uniforms.uSlice.value) * .1;
    material.uniforms.uFocusMix.value += (focusMix - material.uniforms.uFocusMix.value) * .1;
    material.uniforms.uOpacity.value += (layerOpacity - material.uniforms.uOpacity.value) * .1;
  });
});

document.querySelector('.study-page').addEventListener('wheel', (event) => {
  event.preventDefault();
  travelTarget += event.deltaY * .00072;
}, { passive: false });

function loadFiles(fileList) {
  const base = customMode ? datasets : [];
  const files = Array.from(fileList).filter((file) => file.type.startsWith('image/')).slice(0, Math.max(0, 6 - base.length));
  if (!files.length) return;
  const additions = files.map((file, index) => {
    const image = URL.createObjectURL(file);
    objectUrls.add(image);
    return {
      key: `custom-${Date.now()}-${index}`,
      name: file.name,
      image
    };
  });
  if (!base.length && additions.length === 1) additions.push({ ...additions[0], key: `${additions[0].key}-copy` });
  const nextDatasets = normalizeDatasets([...base, ...additions]);
  customMode = true;

  loadSequence(nextDatasets).catch(() => { sequenceEditorStatus.textContent = 'Image load failed'; });
}

imageInput.addEventListener('change', () => loadFiles(imageInput.files));
sequenceList.addEventListener('dragstart', (event) => {
  const item = event.target.closest('.sequence-item');
  if (!item) return;
  draggedKey = item.dataset.key;
  item.classList.add('is-dragging');
});
sequenceList.addEventListener('dragend', () => {
  draggedKey = null;
  sequenceList.querySelectorAll('.sequence-item').forEach((item) => item.classList.remove('is-dragging', 'is-drop-target'));
});
sequenceList.addEventListener('dragover', (event) => {
  if (!draggedKey) return;
  event.preventDefault();
  sequenceList.querySelectorAll('.sequence-item').forEach((item) => item.classList.toggle('is-drop-target', item === event.target.closest('.sequence-item')));
});
sequenceList.addEventListener('drop', (event) => {
  if (!draggedKey) return;
  event.preventDefault();
  event.stopPropagation();
  const targetKey = event.target.closest('.sequence-item')?.dataset.key;
  if (!targetKey || targetKey === draggedKey) return;
  const reordered = [...datasets];
  const fromIndex = reordered.findIndex(({ key }) => key === draggedKey);
  const toIndex = reordered.findIndex(({ key }) => key === targetKey);
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  loadSequence(normalizeDatasets(reordered)).catch(() => { sequenceEditorStatus.textContent = 'Image load failed'; });
});
sequenceList.addEventListener('click', (event) => {
  const deleteKey = event.target.closest('[data-delete-key]')?.dataset.deleteKey;
  if (!deleteKey || datasets.length <= 2) return;
  loadSequence(normalizeDatasets(datasets.filter(({ key }) => key !== deleteKey))).catch(() => { sequenceEditorStatus.textContent = 'Image load failed'; });
});

document.querySelector('.study-page').addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  sequenceEditor.classList.add('is-dragging');
});
document.querySelector('.study-page').addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
});
document.querySelector('.study-page').addEventListener('dragleave', (event) => {
  if (!event.currentTarget.contains(event.relatedTarget)) sequenceEditor.classList.remove('is-dragging');
});
document.querySelector('.study-page').addEventListener('drop', (event) => {
  if (!event.dataTransfer?.files?.length) return;
  event.preventDefault();
  sequenceEditor.classList.remove('is-dragging');
  loadFiles(event.dataTransfer?.files ?? []);
});

window.addEventListener('pagehide', () => objectUrls.forEach((url) => URL.revokeObjectURL(url)), { once: true });
