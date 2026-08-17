import { THREE, createStage, bindRange, seededRandom } from '../shared.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.querySelector('.webgl');
const page = document.querySelector('.study-page');
const stage = createStage(canvas, {
  camera: [0, .25, 11.7],
  fov: 39,
  fog: 0,
  background: 0x050707,
  antialias: false,
  pixelRatio: Math.min(window.devicePixelRatio, 1.5)
});
const { scene, camera } = stage;
scene.fog = null;

const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = .07;
orbit.enablePan = false;
orbit.rotateSpeed = .55;
orbit.zoomSpeed = .7;
orbit.minDistance = 3;
orbit.maxDistance = 14;
orbit.minPolarAngle = .12;
orbit.maxPolarAngle = Math.PI - .12;
orbit.target.set(0, 0, 0);

const uniforms = {
  uSlice: { value: 1.8 },
  uWidth: { value: .56 },
  uPointSize: { value: 3.5 },
  uDensity: { value: 1.04 },
  uOpacity: { value: 1 },
  uSignal: { value: new THREE.Color('#509dce') }
};

const material = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthTest: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: `
    attribute float aTone;
    attribute float aSeed;
    uniform float uSlice;
    uniform float uWidth;
    uniform float uPointSize;
    varying float vFocus;
    varying float vTone;
    varying float vSeed;
    void main() {
      vFocus = 1.0 - smoothstep(0.0, uWidth, abs(position.z - uSlice));
      vTone = aTone;
      vSeed = aSeed;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float perspective = clamp(9.5 / max(1.0, -mv.z), .7, 2.6);
      gl_PointSize = mix(uPointSize, uPointSize * 2.35, pow(vFocus, 1.2)) * perspective;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform float uDensity;
    uniform float uOpacity;
    uniform vec3 uSignal;
    varying float vFocus;
    varying float vTone;
    varying float vSeed;
    void main() {
      if (vSeed > uDensity) discard;
      float distanceToCenter = length(gl_PointCoord - .5);
      if (distanceToCenter > .5) discard;
      float edge = 1.0 - smoothstep(.28, .5, distanceToCenter);
      vec3 inactive = mix(uSignal * .38, uSignal, smoothstep(.06, .9, vTone));
      vec3 color = mix(inactive, vec3(.99), pow(vFocus, 1.18));
      float alpha = mix(.36 + vTone * .48, 1.0, vFocus) * edge;
      gl_FragColor = vec4(color, alpha * uOpacity);
    }
  `
});

const loader = new GLTFLoader();
const loading = document.getElementById('mesh-loading');
const loadingLabel = loading.querySelector('span');
const loadingOutput = loading.querySelector('output');
const assetName = document.getElementById('asset-name');
const modelInput = document.getElementById('model-input');
const dropTarget = document.getElementById('model-drop');
let cloud = null;
let loadToken = 0;
let sliceTarget = 1.8;
let sliceCurrent = 1.8;
let gridSpacing = .035;
let sourceRoot = null;
let rebuildTimer = null;
let cutRunning = false;
let cutStart = 0;

function triangleAreaSum(geometry) {
  const position = geometry.attributes.position;
  const index = geometry.index;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let area = 0;
  const triangleCount = index ? index.count / 3 : position.count / 3;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ai = index ? index.getX(triangle * 3) : triangle * 3;
    const bi = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const ci = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    a.fromBufferAttribute(position, ai);
    b.fromBufferAttribute(position, bi);
    c.fromBufferAttribute(position, ci);
    area += b.sub(a).cross(c.sub(a)).length() * .5;
  }
  return area;
}

function buildPointCloud(root) {
  root.updateMatrixWorld(true);
  const sampleRandom = seededRandom(870821);
  const sources = [];
  let totalArea = 0;
  root.traverse((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    const localArea = triangleAreaSum(object.geometry);
    const scale = new THREE.Vector3();
    object.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    const worldArea = localArea * (Math.abs(scale.x * scale.y) + Math.abs(scale.y * scale.z) + Math.abs(scale.z * scale.x)) / 3;
    if (!Number.isFinite(worldArea) || worldArea <= 0) return;
    sources.push({
      mesh: object,
      sampler: new MeshSurfaceSampler(object).setRandomGenerator(sampleRandom).build(),
      area: worldArea
    });
    totalArea += worldArea;
  });
  if (!sources.length) throw new Error('No sampleable mesh geometry found');

  const targetPoints = 360000;
  const rawPositions = new Float32Array(targetPoints * 3);
  const rawNormals = new Float32Array(targetPoints * 3);
  const localPosition = new THREE.Vector3();
  const localNormal = new THREE.Vector3();
  const worldPosition = new THREE.Vector3();
  const worldNormal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  let pointIndex = 0;

  sources.forEach((source, sourceIndex) => {
    const remaining = targetPoints - pointIndex;
    const count = sourceIndex === sources.length - 1
      ? remaining
      : Math.max(128, Math.round(targetPoints * source.area / totalArea));
    normalMatrix.getNormalMatrix(source.mesh.matrixWorld);
    for (let index = 0; index < Math.min(count, remaining); index += 1) {
      source.sampler.sample(localPosition, localNormal);
      worldPosition.copy(localPosition).applyMatrix4(source.mesh.matrixWorld);
      worldNormal.copy(localNormal).applyMatrix3(normalMatrix).normalize();
      const offset = pointIndex * 3;
      rawPositions[offset] = worldPosition.x;
      rawPositions[offset + 1] = worldPosition.y;
      rawPositions[offset + 2] = worldPosition.z;
      rawNormals[offset] = worldNormal.x;
      rawNormals[offset + 1] = worldNormal.y;
      rawNormals[offset + 2] = worldNormal.z;
      pointIndex += 1;
    }
  });

  const rawGeometry = new THREE.BufferGeometry();
  rawGeometry.setAttribute('position', new THREE.BufferAttribute(rawPositions.subarray(0, pointIndex * 3), 3));
  rawGeometry.computeBoundingBox();
  const box = rawGeometry.boundingBox;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const fitScale = 5.2 / Math.max(size.x, size.y, size.z);
  const cells = new Map();

  for (let index = 0; index < pointIndex; index += 1) {
    const offset = index * 3;
    const x = (rawPositions[offset] - center.x) * fitScale;
    const y = (rawPositions[offset + 1] - center.y) * fitScale;
    const z = (rawPositions[offset + 2] - center.z) * fitScale;
    const gridX = Math.round(x / gridSpacing);
    const gridY = Math.round(y / gridSpacing);
    const gridZ = Math.round(z / gridSpacing);
    const key = `${gridX}:${gridY}:${gridZ}`;
    const nx = rawNormals[offset];
    const ny = rawNormals[offset + 1];
    const nz = rawNormals[offset + 2];
    const facing = Math.max(0, nx * .28 + ny * .68 + nz * .42);
    const height = THREE.MathUtils.clamp(y / 5.2 + .5, 0, 1);
    const tone = THREE.MathUtils.clamp(.18 + facing * .55 + height * .27, 0, 1);
    const existing = cells.get(key);
    if (existing) {
      existing.tone = Math.max(existing.tone, tone);
    } else {
      cells.set(key, { gridX, gridY, gridZ, tone });
    }
  }
  rawGeometry.dispose();

  const orderedCells = [...cells.values()].sort((a, b) =>
    a.gridY - b.gridY || a.gridX - b.gridX || a.gridZ - b.gridZ
  );
  const layerCount = 2;
  const positions = new Float32Array(orderedCells.length * layerCount * 3);
  const tones = new Float32Array(orderedCells.length * layerCount);
  const orderedSeeds = new Float32Array(orderedCells.length * layerCount);

  orderedCells.forEach((cell, index) => {
    const primaryIndex = index * layerCount;
    const primaryOffset = primaryIndex * 3;
    positions[primaryOffset] = cell.gridX * gridSpacing;
    positions[primaryOffset + 1] = cell.gridY * gridSpacing;
    positions[primaryOffset + 2] = cell.gridZ * gridSpacing;
    tones[primaryIndex] = cell.tone;
    const latticePhase = Math.abs(cell.gridX + cell.gridY * 3 + cell.gridZ * 5) % 17;
    orderedSeeds[primaryIndex] = latticePhase / 16;

    const secondaryIndex = primaryIndex + 1;
    const secondaryOffset = secondaryIndex * 3;
    const direction = Math.abs(cell.gridX * 3 + cell.gridY * 5 + cell.gridZ * 7) % 3;
    positions[secondaryOffset] = cell.gridX * gridSpacing + (direction === 0 ? gridSpacing * .42 : 0);
    positions[secondaryOffset + 1] = cell.gridY * gridSpacing + (direction === 1 ? gridSpacing * .42 : 0);
    positions[secondaryOffset + 2] = cell.gridZ * gridSpacing + (direction === 2 ? gridSpacing * .42 : 0);
    tones[secondaryIndex] = cell.tone * .92;
    orderedSeeds[secondaryIndex] = 1 + (latticePhase + 1) / 17;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aTone', new THREE.BufferAttribute(tones, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(orderedSeeds, 1));
  geometry.computeBoundingSphere();
  return new THREE.Points(geometry, material);
}

function installCloud(nextCloud) {
  if (cloud) {
    scene.remove(cloud);
    cloud.geometry.dispose();
  }
  cloud = nextCloud;
  scene.add(cloud);
  loading.classList.add('is-ready');
  loadingLabel.textContent = 'Ordered lattice ready';
  loadingOutput.textContent = `${cloud.geometry.attributes.position.count.toLocaleString()} pts`;
}

function rebuildCloud() {
  if (!sourceRoot) return;
  loading.classList.remove('is-ready', 'is-error');
  loadingLabel.textContent = 'Organizing lattice';
  loadingOutput.textContent = `${gridSpacing.toFixed(3)} M`;
  window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(() => {
    try {
      installCloud(buildPointCloud(sourceRoot));
    } catch (error) {
      loading.classList.add('is-error');
      loadingLabel.textContent = 'Lattice failed';
      loadingOutput.textContent = 'ERR';
      console.error(error);
    }
  }, 120);
}

function setModel(source, label, revokeAfterLoad = false) {
  const token = ++loadToken;
  loading.classList.remove('is-ready', 'is-error');
  loadingLabel.textContent = 'Loading model';
  loadingOutput.textContent = '0%';
  assetName.textContent = label;
  loader.load(source, (gltf) => {
    if (token !== loadToken) return;
    try {
      sourceRoot = gltf.scene;
      installCloud(buildPointCloud(sourceRoot));
      window.setTimeout(replayCut, 500);
    } catch (error) {
      loading.classList.add('is-error');
      loadingLabel.textContent = 'Model failed';
      loadingOutput.textContent = 'ERR';
      console.error(error);
    } finally {
      if (revokeAfterLoad) URL.revokeObjectURL(source);
    }
  }, (event) => {
    if (token !== loadToken || !event.total) return;
    loadingOutput.textContent = `${Math.round(event.loaded / event.total * 100)}%`;
  }, (error) => {
    if (token !== loadToken) return;
    loading.classList.add('is-error');
    loadingLabel.textContent = 'Model failed';
    loadingOutput.textContent = 'ERR';
    if (revokeAfterLoad) URL.revokeObjectURL(source);
    console.error(error);
  });
}

const sliceInput = bindRange('mesh-slice', (value) => { sliceTarget = value; }, (value) => `${value.toFixed(2)} Z`);
const sliceOutput = document.querySelector('[data-for="mesh-slice"]');
bindRange('mesh-width', (value) => { uniforms.uWidth.value = value; }, (value) => value.toFixed(2));
bindRange('mesh-point-size', (value) => { uniforms.uPointSize.value = value; }, (value) => `${value.toFixed(2)} PX`);
const colorInput = document.getElementById('mesh-color');
const colorOutput = document.getElementById('mesh-color-readout');
const updatePointColor = () => {
  uniforms.uSignal.value.set(colorInput.value);
  colorOutput.textContent = colorInput.value.toUpperCase();
};
colorInput.addEventListener('input', updatePointColor);
updatePointColor();
bindRange('mesh-density', (value) => { uniforms.uDensity.value = value; }, (value) => `${Math.round(value * 100)}%`);
bindRange('mesh-spacing', (value) => {
  gridSpacing = value;
  rebuildCloud();
}, (value) => `${value.toFixed(3)} M`);
const zoomInput = bindRange('mesh-zoom', (value) => {
  const direction = camera.position.clone().sub(orbit.target);
  if (direction.lengthSq() < .0001) direction.set(0, .05, 1);
  camera.position.copy(orbit.target).add(direction.setLength(value));
  orbit.update();
}, (value) => `${value.toFixed(1)} M`);
orbit.addEventListener('change', () => {
  zoomInput.value = String(camera.position.distanceTo(orbit.target));
  document.querySelector('[data-for="mesh-zoom"]').textContent = `${camera.position.distanceTo(orbit.target).toFixed(1)} M`;
});

const replayButton = document.getElementById('mesh-replay');
const cutStateOutput = document.getElementById('mesh-cut-state');
const scanDuration = 5200;
const fadeDuration = 1100;

function setCameraDistance(distance) {
  const direction = camera.position.clone().sub(orbit.target);
  if (direction.lengthSq() < .0001) direction.set(0, .02, 1);
  camera.position.copy(orbit.target).add(direction.setLength(distance));
}

function easeInOutCubic(value) {
  return value < .5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function smoothStep(value) {
  return value * value * (3 - 2 * value);
}

function cancelCut() {
  if (!cutRunning && uniforms.uOpacity.value === 1) return;
  cutRunning = false;
  orbit.enabled = true;
  uniforms.uOpacity.value = 1;
  cutStateOutput.textContent = 'MANUAL';
}

function replayCut() {
  if (!cloud) return;
  cutRunning = true;
  cutStart = performance.now() + 250;
  orbit.enabled = false;
  uniforms.uOpacity.value = 1;
  sliceTarget = 1.8;
  sliceCurrent = 1.8;
  uniforms.uSlice.value = 1.8;
  setCameraDistance(11.7);
  cutStateOutput.textContent = 'ARMED';
}

replayButton.addEventListener('click', replayCut);
document.querySelectorAll('.controls input').forEach((input) => input.addEventListener('input', cancelCut));
orbit.addEventListener('start', cancelCut);

function loadFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.glb')) return;
  setModel(URL.createObjectURL(file), file.name.replace(/\.glb$/i, ''), true);
}

modelInput.addEventListener('change', () => loadFile(modelInput.files?.[0]));
page.addEventListener('dragenter', (event) => {
  event.preventDefault();
  dropTarget.classList.add('is-dragging');
});
page.addEventListener('dragover', (event) => event.preventDefault());
page.addEventListener('dragleave', (event) => {
  if (!page.contains(event.relatedTarget)) dropTarget.classList.remove('is-dragging');
});
page.addEventListener('drop', (event) => {
  event.preventDefault();
  dropTarget.classList.remove('is-dragging');
  loadFile(event.dataTransfer?.files?.[0]);
});
page.addEventListener('wheel', (event) => {
  if (event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  cancelCut();
  sliceTarget = THREE.MathUtils.clamp(sliceTarget - event.deltaY * .0035, Number(sliceInput.min), Number(sliceInput.max));
}, { passive: false });

stage.start(() => {
  if (cutRunning) {
    const elapsed = performance.now() - cutStart;
    if (elapsed < 0) {
      cutStateOutput.textContent = 'ARMED';
    } else if (elapsed <= scanDuration) {
      const progress = THREE.MathUtils.clamp(elapsed / scanDuration, 0, 1);
      const eased = easeInOutCubic(progress);
      sliceCurrent = THREE.MathUtils.lerp(1.8, -1.95, eased);
      sliceTarget = sliceCurrent;
      setCameraDistance(THREE.MathUtils.lerp(11.7, 3, eased));
      uniforms.uOpacity.value = 1;
      cutStateOutput.textContent = `SCAN ${String(Math.round(progress * 100)).padStart(3, '0')}%`;
    } else {
      const fadeProgress = THREE.MathUtils.clamp((elapsed - scanDuration) / fadeDuration, 0, 1);
      sliceCurrent = -1.95;
      sliceTarget = -1.95;
      setCameraDistance(3);
      uniforms.uOpacity.value = 1 - smoothStep(fadeProgress);
      cutStateOutput.textContent = `FADE ${String(Math.round(fadeProgress * 100)).padStart(3, '0')}%`;
      if (fadeProgress >= 1) {
        cutRunning = false;
        orbit.enabled = true;
        cutStateOutput.textContent = 'COMPLETE';
      }
    }
  } else {
    sliceCurrent += (sliceTarget - sliceCurrent) * .12;
  }
  uniforms.uSlice.value = sliceCurrent;
  sliceInput.value = String(sliceCurrent);
  sliceOutput.textContent = `${sliceCurrent.toFixed(2)} Z`;
  orbit.update();
});

setModel('/assets/pilgrim-rugged-server.glb', 'RUGGED SERVER');
