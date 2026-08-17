import { THREE, createStage, bindRange } from '../shared.js';

const DATASETS = {
  subway: { label: 'A', depth: '/assets/scan-mask-depth.png', ct: '/assets/scan-mask-ct.png' },
  mil: { label: 'B', depth: '/assets/scan-set-depth-mil.png', ct: '/assets/scan-set-ct-mil.png' },
  airport: { label: 'C', depth: '/assets/scan-set-depth-airport.png', ct: '/assets/scan-set-ct-airport.png' },
  airport2: {
    label: 'D',
    depth: '/assets/hero-home-pilgrim.png',
    ct: '/assets/hero-home-pilgrim.png',
    depthGain: 2.55,
    pointLayer: 1
  }
};

const canvas = document.querySelector('.webgl');
const stage = createStage(canvas, { camera: [0, 0, 1], fov: 45, fog: 0, background: 0x050707 });
const { scene, renderer } = stage;
scene.fog = null;

const uniforms = {
  uDepthTexture: { value: null },
  uCtTexture: { value: null },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uPointer: { value: new THREE.Vector2() },
  uImageAspect: { value: 1536 / 944 },
  uSlice: { value: 0.78 },
  uThickness: { value: 0.12 },
  uFeather: { value: 0.045 },
  uDepthShift: { value: 0.035 },
  uCtOpacity: { value: 0.96 },
  uDepthGain: { value: 1 },
  uPointLayer: { value: 0 },
  uSignal: { value: new THREE.Color('#79e0cf') }
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
    uniform sampler2D uDepthTexture;
    uniform sampler2D uCtTexture;
    uniform vec2 uResolution;
    uniform vec2 uPointer;
    uniform float uImageAspect;
    uniform float uSlice;
    uniform float uThickness;
    uniform float uFeather;
    uniform float uDepthShift;
    uniform float uCtOpacity;
    uniform float uDepthGain;
    uniform float uPointLayer;
    uniform vec3 uSignal;

    vec2 coverUv(vec2 uv) {
      float screenAspect = uResolution.x / uResolution.y;
      vec2 centered = uv - 0.5;
      if (screenAspect > uImageAspect) centered.y *= uImageAspect / screenAspect;
      else centered.x *= screenAspect / uImageAspect;
      return centered + 0.5;
    }

    float luma(vec3 color) {
      return dot(color, vec3(0.2126, 0.7152, 0.0722));
    }

    void main() {
      vec2 uv = coverUv(vUv);
      vec4 depthSample = texture2D(uDepthTexture, clamp(uv, 0.0, 1.0));
      float depth = luma(depthSample.rgb) * uDepthGain;
      vec2 shiftedUv = uv + uPointer * (depth - 0.5) * uDepthShift;
      vec3 base = texture2D(uDepthTexture, clamp(shiftedUv, 0.0, 1.0)).rgb;
      vec3 ct = texture2D(uCtTexture, clamp(shiftedUv, 0.0, 1.0)).rgb;
      float shiftedDepth = luma(texture2D(uDepthTexture, clamp(shiftedUv, 0.0, 1.0)).rgb) * uDepthGain;

      float distanceFromSlice = abs(shiftedDepth - uSlice);
      float hardBand = 1.0 - smoothstep(uThickness, uThickness + uFeather, distanceFromSlice);
      float whiteWeight = smoothstep(uSlice - uThickness - uFeather, uSlice + uThickness, shiftedDepth);
      float reveal = hardBand * whiteWeight * uCtOpacity;

      float edge = abs(dFdx(shiftedDepth)) + abs(dFdy(shiftedDepth));
      float revealEdge = length(vec2(dFdx(reveal), dFdy(reveal))) * 92.0;
      float outline = smoothstep(0.018, 0.09, revealEdge) * smoothstep(0.08, 0.42, reveal);

      float ctLum = luma(ct);
      float markerGate = smoothstep(0.34, 0.72, ctLum) * smoothstep(0.24, 0.62, reveal);
      vec2 handleCell = mod(gl_FragCoord.xy + vec2(9.0, 13.0), vec2(42.0));
      float handleDistance = max(abs(handleCell.x - 21.0), abs(handleCell.y - 21.0));
      float handleOuter = 1.0 - step(4.2, handleDistance);
      float handleInner = 1.0 - step(2.4, handleDistance);
      float handle = handleOuter * outline * markerGate * (1.0 - uPointLayer);

      vec3 depthPlate = mix(vec3(0.035), base, 0.92);
      depthPlate = mix(depthPlate, vec3(0.92), smoothstep(0.965, 1.0, shiftedDepth) * 0.12);
      vec3 ctScan = ct * (0.88 + reveal * 0.42) + uSignal * edge * 22.0 + uSignal * outline * 0.32;
      vec2 pointCell = fract((gl_FragCoord.xy + vec2(2.0, 3.0)) / 7.0) - 0.5;
      float pointDot = 1.0 - smoothstep(0.18, 0.46, length(pointCell));
      float pointGate = smoothstep(0.05, 0.82, shiftedDepth);
      vec3 pointTone = uSignal * mix(0.48, 1.35, smoothstep(0.24, 0.92, shiftedDepth));
      vec3 pointScan = pointTone * pointDot * (0.38 + pointGate * 0.92) + uSignal * outline * 0.22;
      vec3 scan = mix(ctScan, pointScan, uPointLayer);
      vec3 color = mix(depthPlate, scan, reveal);
      color = mix(color, uSignal, handle * 0.72);
      color = mix(color, vec3(1.0), handleInner * outline * 0.82);

      float outside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      gl_FragColor = vec4(color * outside, 1.0);
    }
  `
});

scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

const loader = new THREE.TextureLoader();
let textureLoadToken = 0;
function loadTexture(source, assign) {
  loader.load(source, (texture) => {
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    assign(texture);
  });
}

const datasetSelect = document.getElementById('asset-set');
const datasetOutput = document.querySelector('[data-for="asset-set"]');
function setDataset(key) {
  const dataset = DATASETS[key] ?? DATASETS.subway;
  const token = ++textureLoadToken;
  datasetOutput.textContent = dataset.label;
  uniforms.uDepthGain.value = dataset.depthGain ?? 1;
  uniforms.uPointLayer.value = dataset.pointLayer ?? 0;
  loadTexture(dataset.depth, (texture) => {
    if (token !== textureLoadToken) return;
    uniforms.uDepthTexture.value?.dispose?.();
    uniforms.uDepthTexture.value = texture;
    uniforms.uImageAspect.value = texture.image.width / texture.image.height;
  });
  loadTexture(dataset.ct, (texture) => {
    if (token !== textureLoadToken) return;
    uniforms.uCtTexture.value?.dispose?.();
    uniforms.uCtTexture.value = texture;
  });
}

datasetSelect.addEventListener('change', () => setDataset(datasetSelect.value));
setDataset(datasetSelect.value);

const initialSlice = Number(document.getElementById('slice').value);
let sliceTarget = initialSlice;
let sliceCurrent = initialSlice;
const sliceOutput = document.querySelector('[data-for="slice"]');
const sliceInput = bindRange('slice', (value) => { sliceTarget = value; }, (value) => value.toFixed(3));
bindRange('thickness', (value) => { uniforms.uThickness.value = value; }, (value) => value.toFixed(3));
bindRange('feather', (value) => { uniforms.uFeather.value = value; }, (value) => value.toFixed(3));
bindRange('depth', (value) => { uniforms.uDepthShift.value = value; }, (value) => value.toFixed(3));
bindRange('ct', (value) => { uniforms.uCtOpacity.value = value; }, (value) => `${Math.round(value * 100)}%`);

const scanColorInput = document.getElementById('scan-color');
const scanColorOutput = document.querySelector('[data-for="scan-color"]');
if (scanColorInput && scanColorOutput) {
  uniforms.uSignal.value.set(scanColorInput.value);
  scanColorInput.addEventListener('input', () => {
    uniforms.uSignal.value.set(scanColorInput.value);
    scanColorOutput.textContent = scanColorInput.value.toUpperCase();
  });
}

stage.start((time, pointer) => {
  sliceCurrent += (sliceTarget - sliceCurrent) * 0.12;
  uniforms.uSlice.value = sliceCurrent;
  sliceInput.value = String(sliceCurrent);
  sliceOutput.textContent = sliceCurrent.toFixed(3);
  uniforms.uPointer.value.lerp(pointer, 0.035);
  renderer.getDrawingBufferSize(uniforms.uResolution.value);
});

document.querySelector('.study-page').addEventListener('wheel', (event) => {
  event.preventDefault();
  sliceTarget = THREE.MathUtils.clamp(sliceTarget - event.deltaY * 0.0007, Number(sliceInput.min), Number(sliceInput.max));
}, { passive: false });
