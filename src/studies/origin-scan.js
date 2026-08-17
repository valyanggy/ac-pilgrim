import { THREE, createStage, bindRange, seededRandom } from '../shared.js';

const DATASETS = {
  airport: {
    label: 'AIR',
    depth: '/assets/scan-set-depth-airport.png',
    ct: '/assets/scan-set-ct-airport.png',
    origin: [0.675, 0.72],
    radius: 0.14
  },
  subway: {
    label: 'SUB',
    depth: '/assets/scan-mask-depth.png',
    ct: '/assets/scan-mask-ct.png',
    origin: [0.735, 0.54],
    radius: 0.25
  }
};

const canvas = document.querySelector('.webgl');
const stage = createStage(canvas, { camera: [0, 0, 8], fov: 42, fog: 0, background: 0x050707 });
const { scene } = stage;
scene.fog = null;

const state = {
  timeline: 0,
  speed: 0.19,
  thickness: 0.018,
  spread: 0.62,
  point: 1.65,
  reveal: 1,
  objectRadius: DATASETS.airport.radius,
  baseY: DATASETS.airport.origin[1] + DATASETS.airport.radius * .92,
  depthGate: 0.13,
  origin: new THREE.Vector2(...DATASETS.airport.origin),
  originDepth: 0.8,
  playing: true,
  scrubbing: false,
  imageAspect: 1,
  fit: new THREE.Vector2(1, 1)
};

const uniforms = {
  uTimeline: { value: 0 },
  uOrigin: { value: state.origin },
  uOriginDepth: { value: state.originDepth },
  uObjectRadius: { value: state.objectRadius },
  uBaseY: { value: state.baseY },
  uDepthGate: { value: state.depthGate },
  uThickness: { value: state.thickness },
  uSpread: { value: state.spread },
  uPoint: { value: state.point },
  uReveal: { value: state.reveal },
  uFit: { value: state.fit },
  uSignal: { value: new THREE.Color('#ffffff') }
};

const material = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: `
    attribute vec2 aUv;
    attribute float aDepth;
    attribute float aCt;
    attribute float aEdge;
    attribute float aSeed;
    uniform float uTimeline;
    uniform vec2 uOrigin;
    uniform float uOriginDepth;
    uniform float uObjectRadius;
    uniform float uBaseY;
    uniform float uDepthGate;
    uniform float uThickness;
    uniform float uSpread;
    uniform float uPoint;
    uniform float uReveal;
    uniform vec2 uFit;
    varying float vActive;
    varying float vScanned;
    varying float vGround;
    varying float vCt;
    varying float vEdge;
    varying float vSeed;
    varying float vObject;

    float ease(float value) {
      value = clamp(value, 0.0, 1.0);
      return value * value * (3.0 - 2.0 * value);
    }

    void main() {
      float descent = ease(uTimeline / .42);
      float groundPhase = ease((uTimeline - .42) / .48);
      vec2 objectDelta = aUv - uOrigin;
      float objectDistance = length(vec2(
        objectDelta.x / max(.001, uObjectRadius * .62),
        objectDelta.y / max(.001, uObjectRadius)
      ));
      float depthMatch = 1.0 - smoothstep(uDepthGate, uDepthGate + .11, abs(aDepth - uOriginDepth));
      vObject = (1.0 - smoothstep(.82, 1.04, objectDistance)) * depthMatch;

      float scanY = uOrigin.y - uObjectRadius + descent * uObjectRadius * 1.92;
      vActive = (1.0 - smoothstep(0.0, uThickness, abs(aUv.y - scanY))) * vObject * (1.0 - step(.42, uTimeline));
      vScanned = step(aUv.y, scanY) * vObject;

      vec2 base = vec2(uOrigin.x, uBaseY);
      vec2 groundDelta = aUv - base;
      float groundDistance = length(vec2(groundDelta.x, groundDelta.y * 3.35));
      float groundRadius = mix(.012, uSpread, groundPhase);
      float groundBand = uThickness * 2.4 + groundRadius * .025;
      float ring = 1.0 - smoothstep(0.0, groundBand, abs(groundDistance - groundRadius));
      float trail = (1.0 - smoothstep(groundRadius - groundBand * 5.0, groundRadius, groundDistance)) * step(groundDistance, groundRadius);
      float groundVisible = smoothstep(.42, .47, uTimeline) * (1.0 - smoothstep(.96, 1.0, uTimeline));
      float floorSignal = 1.0 - smoothstep(.16, .52, aCt);
      float objectOcclusion = 1.0 - vObject * .96;
      vGround = (ring + trail * .24) * groundVisible * objectOcclusion * mix(.18, 1.0, floorSignal);

      vec2 clip = vec2(aUv.x * 2.0 - 1.0, 1.0 - aUv.y * 2.0) * uFit * .94;
      gl_Position = vec4(clip, clamp((aDepth + aSeed * .015) * .7, 0.0, 1.0), 1.0);
      gl_PointSize = uPoint + aEdge * 1.25 + vObject * .18 + vScanned * .35 + max(vActive, clamp(vGround, 0.0, 1.0)) * 2.35;
      vCt = aCt;
      vEdge = aEdge;
      vSeed = aSeed;
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform vec3 uSignal;
    uniform float uReveal;
    varying float vActive;
    varying float vScanned;
    varying float vGround;
    varying float vCt;
    varying float vEdge;
    varying float vSeed;
    varying float vObject;
    void main() {
      float d = length(gl_PointCoord - .5);
      if (d > .5) discard;
      float dot = smoothstep(.5, .08, d);
      float source = pow(vCt, .82);
      float sceneDetail = clamp(pow(source, .58) * .88 + vEdge * .3, 0.0, 1.0);
      vec3 inactive = mix(vec3(.09, .145, .135), vec3(.38, .58, .54), sceneDetail);
      vec3 scanned = vec3(1.0);
      float highlight = max(vActive, clamp(vGround, 0.0, 1.0));
      float whiten = clamp(max(vScanned * .82, highlight), 0.0, 1.0);
      vec3 color = mix(inactive, scanned, whiten);
      float sceneAlpha = mix(.07, .68, uReveal) + source * mix(.06, .24, uReveal) + vEdge * .08;
      float alpha = sceneAlpha + vScanned * .12 + highlight * .38;
      gl_FragColor = vec4(color, alpha * dot);
    }
  `
});

let cloud = null;
let depthPixels = null;
let ctPixels = null;
let depthWidth = 0;
let depthHeight = 0;
let loadToken = 0;

function luminanceAt(data, width, height, x, y) {
  const px = Math.max(0, Math.min(width - 1, x));
  const py = Math.max(0, Math.min(height - 1, y));
  const index = (py * width + px) * 4;
  return (data[index] * .2126 + data[index + 1] * .7152 + data[index + 2] * .0722) / 255;
}

function imageData(image, width = image.naturalWidth, height = image.naturalHeight) {
  const surface = document.createElement('canvas');
  surface.width = width;
  surface.height = height;
  const context = surface.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

function buildCloud(depthImage, ctImage) {
  const random = seededRandom(504022);
  depthWidth = depthImage.naturalWidth;
  depthHeight = depthImage.naturalHeight;
  depthPixels = imageData(depthImage);
  ctPixels = imageData(ctImage, depthWidth, depthHeight);
  const positions = [];
  const uvs = [];
  const depths = [];
  const cts = [];
  const edges = [];
  const seeds = [];
  const step = 2;

  for (let y = 0; y < depthHeight; y += step) {
    for (let x = 0; x < depthWidth; x += step) {
      const depth = luminanceAt(depthPixels, depthWidth, depthHeight, x, y);
      const ct = luminanceAt(ctPixels, depthWidth, depthHeight, x, y);
      const edge = Math.min(1,
        Math.abs(depth - luminanceAt(depthPixels, depthWidth, depthHeight, x + step * 2, y)) +
        Math.abs(depth - luminanceAt(depthPixels, depthWidth, depthHeight, x, y + step * 2))
      );
      positions.push(0, 0, 0);
      uvs.push(x / depthWidth, y / depthHeight);
      depths.push(depth);
      cts.push(ct);
      edges.push(edge);
      seeds.push(random());
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aUv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aDepth', new THREE.Float32BufferAttribute(depths, 1));
  geometry.setAttribute('aCt', new THREE.Float32BufferAttribute(cts, 1));
  geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edges, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = source;
  });
}

function sampleDepthAt(u, v) {
  if (!depthPixels) return state.originDepth;
  return luminanceAt(
    depthPixels,
    depthWidth,
    depthHeight,
    Math.round(u * depthWidth),
    Math.round(v * depthHeight)
  );
}

function sampleOriginDepth() {
  state.originDepth = sampleDepthAt(state.origin.x, state.origin.y);
  uniforms.uOriginDepth.value = state.originDepth;
}

function inferObjectBounds(u, v, seedDepth) {
  if (!depthPixels || !ctPixels) return null;
  const centerX = Math.round(u * depthWidth);
  const centerY = Math.round(v * depthHeight);
  const halfWidth = Math.round(depthWidth * .13);
  const halfHeight = Math.round(depthHeight * .48);
  const x0 = Math.max(0, centerX - halfWidth);
  const x1 = Math.min(depthWidth - 1, centerX + halfWidth);
  const y0 = Math.max(0, centerY - halfHeight);
  const y1 = Math.min(depthHeight - 1, centerY + halfHeight);
  const step = 4;
  const rowLimit = Math.max(4, Math.floor((x1 - x0) / step * .78));
  const validRows = [];

  for (let y = y0; y <= y1; y += step) {
    let matches = 0;
    for (let x = x0; x <= x1; x += step) {
      const depth = luminanceAt(depthPixels, depthWidth, depthHeight, x, y);
      const ct = luminanceAt(ctPixels, depthWidth, depthHeight, x, y);
      const horizontalDistance = Math.abs(x - centerX) / Math.max(1, halfWidth);
      const depthMatch = Math.abs(depth - seedDepth) <= state.depthGate;
      const subjectSignal = ct > .055 + horizontalDistance * .035;
      if (depthMatch && subjectSignal) matches += 1;
    }
    if (matches >= 2 && matches < rowLimit) validRows.push(y / depthHeight);
  }

  if (validRows.length < 4) return null;
  const clickedIndex = validRows.reduce((best, row, index) =>
    Math.abs(row - v) < Math.abs(validRows[best] - v) ? index : best, 0);
  let start = clickedIndex;
  let end = clickedIndex;
  const maxGap = step / depthHeight * 3.2;
  while (start > 0 && validRows[start] - validRows[start - 1] <= maxGap) start -= 1;
  while (end < validRows.length - 1 && validRows[end + 1] - validRows[end] <= maxGap) end += 1;

  const top = validRows[start];
  const bottom = validRows[end];
  if (bottom - top < .045) return null;
  return {
    centerY: (top + bottom) * .5,
    baseY: Math.min(.98, bottom + .008),
    radius: THREE.MathUtils.clamp((bottom - top) * .54, .07, .34)
  };
}

const datasetSelect = document.getElementById('asset-set');
const datasetOutput = document.querySelector('[data-for="asset-set"]');
const objectRadiusInput = document.getElementById('object-radius');
const groundLevelInput = document.getElementById('ground-level');

async function setDataset(key) {
  const dataset = DATASETS[key] ?? DATASETS.airport;
  const token = ++loadToken;
  datasetOutput.textContent = dataset.label;
  document.querySelector('.origin-instruction').classList.add('is-loading');
  const [depthImage, ctImage] = await Promise.all([loadImage(dataset.depth), loadImage(dataset.ct)]);
  if (token !== loadToken) return;
  if (cloud) {
    scene.remove(cloud);
    cloud.geometry.dispose();
  }
  cloud = buildCloud(depthImage, ctImage);
  scene.add(cloud);
  state.imageAspect = depthWidth / depthHeight;
  state.origin.set(...dataset.origin);
  state.objectRadius = dataset.radius;
  state.baseY = Math.min(.98, dataset.origin[1] + dataset.radius * .92);
  objectRadiusInput.value = String(dataset.radius);
  uniforms.uObjectRadius.value = dataset.radius;
  uniforms.uBaseY.value = state.baseY;
  document.querySelector('[data-for="object-radius"]').textContent = `${Math.round(dataset.radius * 100)}%`;
  groundLevelInput.value = String(state.baseY);
  document.querySelector('[data-for="ground-level"]').textContent = `${Math.round(state.baseY * 100)}%`;
  sampleOriginDepth();
  state.timeline = 0;
  state.playing = true;
  playToggle.textContent = 'Pause loop';
  playToggle.setAttribute('aria-pressed', 'false');
  document.querySelector('.origin-instruction').classList.remove('is-loading');
  updateMarker();
}

datasetSelect.addEventListener('change', () => setDataset(datasetSelect.value));

const timelineInput = document.getElementById('timeline');
const timelineOutput = document.querySelector('[data-for="timeline"]');
const phaseIndex = document.getElementById('phase-index');
const phaseName = document.getElementById('phase-name');
const playToggle = document.getElementById('play-toggle');
const guiToggle = document.getElementById('gui-toggle');
const marker = document.querySelector('.origin-marker');

timelineInput.addEventListener('pointerdown', () => { state.scrubbing = true; });
window.addEventListener('pointerup', () => { state.scrubbing = false; });
timelineInput.addEventListener('input', () => { state.timeline = Number(timelineInput.value); });

playToggle.addEventListener('click', () => {
  state.playing = !state.playing;
  playToggle.textContent = state.playing ? 'Pause loop' : 'Play loop';
  playToggle.setAttribute('aria-pressed', String(!state.playing));
});

guiToggle.addEventListener('click', () => {
  const hidden = document.querySelector('.study-page').classList.toggle('is-gui-hidden');
  guiToggle.textContent = hidden ? 'Show GUI' : 'Hide GUI';
  guiToggle.setAttribute('aria-expanded', String(!hidden));
});

bindRange('speed', (value) => { state.speed = value; }, (value) => `${value.toFixed(2)}x`);
bindRange('thickness', (value) => {
  state.thickness = value;
  uniforms.uThickness.value = value;
}, (value) => `${Math.round(value * 1000)} PX`);
bindRange('spread', (value) => {
  state.spread = value;
  uniforms.uSpread.value = value;
}, (value) => `${Math.round(value * 100)}%`);
bindRange('point', (value) => {
  state.point = value;
  uniforms.uPoint.value = value;
}, (value) => value.toFixed(2));
bindRange('reveal', (value) => {
  state.reveal = value;
  uniforms.uReveal.value = value;
}, (value) => `${Math.round(value * 100)}%`);
bindRange('object-radius', (value) => {
  state.objectRadius = value;
  uniforms.uObjectRadius.value = value;
  updateMarker();
}, (value) => `${Math.round(value * 100)}%`);
bindRange('ground-level', (value) => {
  state.baseY = value;
  uniforms.uBaseY.value = value;
}, (value) => `${Math.round(value * 100)}%`);
bindRange('depth-gate', (value) => {
  state.depthGate = value;
  uniforms.uDepthGate.value = value;
}, (value) => value.toFixed(2));

function updateFit() {
  const viewportAspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  if (viewportAspect > state.imageAspect) state.fit.set(state.imageAspect / viewportAspect, 1);
  else state.fit.set(1, viewportAspect / state.imageAspect);
}

function updateMarker() {
  if (!marker) return;
  const x = ((state.origin.x * 2 - 1) * state.fit.x * .94 * .5 + .5) * canvas.clientWidth;
  const y = ((state.origin.y * 2 - 1) * state.fit.y * .94 * .5 + .5) * canvas.clientHeight;
  const radius = state.objectRadius * state.fit.y * .94 * canvas.clientHeight;
  marker.style.transform = `translate(${x}px, ${y}px)`;
  marker.style.setProperty('--marker-radius', `${Math.max(22, radius)}px`);
}

canvas.addEventListener('pointerdown', (event) => {
  if (!depthPixels) return;
  const rect = canvas.getBoundingClientRect();
  const clipX = (event.clientX - rect.left) / rect.width * 2 - 1;
  const clipY = 1 - (event.clientY - rect.top) / rect.height * 2;
  const u = (clipX / (state.fit.x * .94) + 1) * .5;
  const v = (1 - clipY / (state.fit.y * .94)) * .5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return;
  const clickedDepth = sampleDepthAt(u, v);
  const bounds = inferObjectBounds(u, v, clickedDepth);
  state.originDepth = clickedDepth;
  uniforms.uOriginDepth.value = clickedDepth;
  if (bounds) {
    state.origin.set(u, bounds.centerY);
    state.objectRadius = bounds.radius;
    state.baseY = bounds.baseY;
    objectRadiusInput.value = String(bounds.radius);
    document.querySelector('[data-for="object-radius"]').textContent = `${Math.round(bounds.radius * 100)}%`;
    groundLevelInput.value = String(bounds.baseY);
    document.querySelector('[data-for="ground-level"]').textContent = `${Math.round(bounds.baseY * 100)}%`;
    uniforms.uObjectRadius.value = bounds.radius;
    uniforms.uBaseY.value = bounds.baseY;
  } else {
    state.origin.set(u, v);
    state.baseY = Math.min(.98, v + state.objectRadius * .92);
    groundLevelInput.value = String(state.baseY);
    document.querySelector('[data-for="ground-level"]').textContent = `${Math.round(state.baseY * 100)}%`;
    uniforms.uBaseY.value = state.baseY;
  }
  state.timeline = 0;
  state.playing = true;
  playToggle.textContent = 'Pause loop';
  playToggle.setAttribute('aria-pressed', 'false');
  marker.classList.remove('is-set');
  requestAnimationFrame(() => marker.classList.add('is-set'));
  updateMarker();
});

stage.start(() => {
  updateFit();
  updateMarker();
  if (state.playing && !state.scrubbing) state.timeline = (state.timeline + state.speed / 170) % 1;
  uniforms.uTimeline.value = state.timeline;
  timelineInput.value = String(state.timeline);
  timelineOutput.textContent = `${Math.round(state.timeline * 100)}%`;

  if (state.timeline < .42) {
    phaseIndex.textContent = '01';
    phaseName.textContent = 'Object descent';
  } else if (state.timeline < .96) {
    phaseIndex.textContent = '02';
    phaseName.textContent = 'Ground propagation';
  } else {
    phaseIndex.textContent = '03';
    phaseName.textContent = 'Reset field';
  }
});

document.querySelector('.study-page').addEventListener('wheel', (event) => {
  event.preventDefault();
  state.timeline = (state.timeline + event.deltaY * .00055 + 1) % 1;
}, { passive: false });

setDataset(datasetSelect.value).catch(() => {
  document.querySelector('.origin-instruction').textContent = 'Dataset load failed';
});
