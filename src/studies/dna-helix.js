import { THREE, bindRange } from '../shared.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const canvas = document.querySelector('.webgl');
const isAtcgExperiment = document.querySelector('.dna-helix-atcg-page') !== null;
const helixGuiToggle = document.getElementById('helix-gui-toggle');

if (helixGuiToggle) {
  helixGuiToggle.addEventListener('click', () => {
    const hidden = document.querySelector('.dna-helix-atcg-page').classList.toggle('is-gui-hidden');
    helixGuiToggle.textContent = hidden ? 'Show GUI' : 'Hide GUI';
    helixGuiToggle.setAttribute('aria-expanded', String(!hidden));
  });
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setClearColor(0x050606, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050606);
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
camera.position.set(0, 0.15, 8);

const orbit = new OrbitControls(camera, canvas);
// The assembly model may spin, but the camera must only move in direct response
// to pointer input. Disabling damping prevents any post-drag camera coasting.
orbit.autoRotate = false;
orbit.enableDamping = !isAtcgExperiment;
orbit.dampingFactor = 0.065;
orbit.enablePan = true;
orbit.screenSpacePanning = true;
orbit.enableZoom = true;
orbit.rotateSpeed = 0.52;
orbit.panSpeed = 0.7;
orbit.zoomSpeed = 0.8;
orbit.minDistance = 0.8;
orbit.maxDistance = 16;
orbit.target.set(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xeaffdf, 0x081208, 1.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
keyLight.position.set(4, 5, 6);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x8cff00, 2.1);
rimLight.position.set(-5, 1, -4);
scene.add(rimLight);

const modelGroup = new THREE.Group();
// The assembly study reads most clearly as a landscape braid. The original
// helix keeps its more upright presentation on the preceding study.
const HOME_ROTATION = new THREE.Euler(0.12, -0.18, isAtcgExperiment ? -Math.PI * 0.5 : -0.7);
const HOME_QUATERNION = new THREE.Quaternion().setFromEuler(HOME_ROTATION);
modelGroup.quaternion.copy(HOME_QUATERNION);
if (isAtcgExperiment) modelGroup.position.set(0, -0.05, 0);
scene.add(modelGroup);

const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  depthBuffer: true
});
renderTarget.texture.colorSpace = THREE.SRGBColorSpace;

const postScene = new THREE.Scene();
const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const HOVER_TRAIL_COUNT = 12;
const hoverUniformPoints = Array.from(
  { length: HOVER_TRAIL_COUNT },
  () => new THREE.Vector3(-10000, -10000, 0)
);
const uniforms = {
  tScene: { value: renderTarget.texture },
  tGlyphs: { value: new THREE.Texture() },
  tDnaGlyphs: { value: new THREE.Texture() },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uCell: { value: 17 },
  uDensity: { value: 1 },
  uThreshold: { value: 0.11 },
  uContrast: { value: 1.85 },
  uGlow: { value: 1.5 },
  uHoverPoints: { value: hoverUniformPoints },
  uHoverRadius: { value: 110 },
  uHoverDensity: { value: 1 },
  uHoverBreakup: { value: 0.85 },
  uHoverClip: { value: new THREE.Vector4(0, 0, 1, 1) },
  uClipHover: { value: 0 },
  uAssembly: { value: isAtcgExperiment ? 1 : 0 },
  uAssemblyEdge: { value: 0.48 },
  uAssemblyFeather: { value: 0.2 },
  uAssemblyScatter: { value: 150 },
  uAssemblyDrift: { value: 0.36 },
  uTime: { value: 0 },
  uSignalShadow: { value: new THREE.Color('#003758') },
  uSignalLow: { value: new THREE.Color('#004874') },
  uSignalMid: { value: new THREE.Color('#0065a4') },
  uSignalHigh: { value: new THREE.Color('#59c2ff') },
  uSignalHighlight: { value: new THREE.Color('#9ff710') }
};

const postMaterial = new THREE.ShaderMaterial({
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
    uniform sampler2D tScene;
    uniform sampler2D tGlyphs;
    uniform sampler2D tDnaGlyphs;
    uniform vec2 uResolution;
    uniform float uCell;
    uniform float uDensity;
    uniform float uThreshold;
    uniform float uContrast;
    uniform float uGlow;
    uniform vec3 uHoverPoints[12];
    uniform float uHoverRadius;
    uniform float uHoverDensity;
    uniform float uHoverBreakup;
    uniform vec4 uHoverClip;
    uniform float uClipHover;
    uniform float uAssembly;
    uniform float uAssemblyEdge;
    uniform float uAssemblyFeather;
    uniform float uAssemblyScatter;
    uniform float uAssemblyDrift;
    uniform float uTime;
    uniform vec3 uSignalShadow;
    uniform vec3 uSignalLow;
    uniform vec3 uSignalMid;
    uniform vec3 uSignalHigh;
    uniform vec3 uSignalHighlight;

    float sceneLuma(vec3 color) {
      return dot(color, vec3(0.2126, 0.7152, 0.0722));
    }

    float hash21(vec2 value) {
      value = fract(value * vec2(123.34, 456.21));
      value += dot(value, value + 45.32);
      return fract(value.x * value.y);
    }

    float atlasAlpha(float glyphIndex, vec2 localUv) {
      float column = mod(glyphIndex, 6.0);
      float row = floor(glyphIndex / 6.0);
      vec2 padded = mix(vec2(0.06), vec2(0.94), localUv);
      vec2 atlasUv = (vec2(column, 5.0 - row) + padded) / 6.0;
      return texture2D(tGlyphs, atlasUv).a;
    }

    float dnaAlpha(float dnaIndex, vec2 localUv) {
      vec2 padded = mix(vec2(0.08), vec2(0.92), localUv);
      vec2 atlasUv = (vec2(dnaIndex, 0.0) + padded) / vec2(4.0, 1.0);
      return texture2D(tDnaGlyphs, atlasUv).a;
    }

    void main() {
      vec2 pixel = gl_FragCoord.xy;
      vec2 cellId = floor(pixel / uCell);
      vec2 cellCenter = (cellId + 0.5) * uCell;
      float seedA = hash21(cellId + vec2(31.0, 79.0));
      float seedB = hash21(cellId + vec2(97.0, 23.0));
      float boundaryRipple = sin(cellId.y * 0.31 + uTime * 0.72) * 0.018;
      float assembled = 1.0 - smoothstep(
        uAssemblyEdge - uAssemblyFeather,
        uAssemblyEdge + uAssemblyFeather,
        cellCenter.x / uResolution.x + boundaryRipple
      );
      float breakup = (1.0 - assembled) * uAssembly;
      float particlePhase = uTime * (0.42 + seedB * 0.38) + seedA * 6.2831853;
      vec2 scatterDirection = normalize(vec2(seedA - 0.58, seedB - 0.5) + vec2(0.001));
      vec2 particleDrift = vec2(
        -uTime * uAssemblyDrift * 13.0,
        sin(particlePhase) * uAssemblyDrift * 18.0
      );
      vec2 scatteredSample = cellCenter
        - scatterDirection * uAssemblyScatter * breakup
        - particleDrift * breakup;
      vec2 sampleUv = clamp(scatteredSample / uResolution, vec2(0.0), vec2(1.0));
      vec2 texel = 1.0 / uResolution;

      float center = sceneLuma(texture2D(tScene, sampleUv).rgb);
      float around = (
        sceneLuma(texture2D(tScene, sampleUv + vec2(texel.x * uCell, 0.0)).rgb) +
        sceneLuma(texture2D(tScene, sampleUv - vec2(texel.x * uCell, 0.0)).rgb) +
        sceneLuma(texture2D(tScene, sampleUv + vec2(0.0, texel.y * uCell)).rgb) +
        sceneLuma(texture2D(tScene, sampleUv - vec2(0.0, texel.y * uCell)).rgb)
      ) * 0.25;
      float edge = abs(center - around);
      float signal = clamp((center - uThreshold) * uContrast + edge * 1.65, 0.0, 1.0);
      float fragmentPulse = 0.76 + 0.24 * sin(particlePhase * 1.7);
      float occupancy = uDensity * mix(0.38, 1.0, signal)
        * mix(1.0, mix(0.38, 0.82, fragmentPulse), breakup);
      if (signal <= 0.001 || hash21(cellId) > occupancy) {
        gl_FragColor = vec4(0.018, 0.021, 0.019, 1.0);
        return;
      }

      float sequenceNoise = hash21(cellId + floor(uTime * 0.18));
      float glyphIndex = floor(clamp(signal * 31.0 + sequenceNoise * 4.0, 0.0, 35.0));
      vec2 localUv = fract(pixel / uCell);
      float hoverPick = hash21(cellId + vec2(47.0, 83.0));
      float coarseNoise = hash21(floor(cellId / 3.0) + vec2(7.0, 29.0));
      float fineNoise = hash21(cellId + vec2(131.0, 17.0));
      float boundaryNoise = mix(coarseNoise, fineNoise, 0.38);
      float distortedRadius = uHoverRadius
        * (1.0 + (boundaryNoise - 0.5) * 0.72 * uHoverBreakup);
      float edgeBand = max(0.75, uHoverRadius * 0.68 * uHoverBreakup);
      float hoverProbability = 0.0;
      for (int hoverIndex = 0; hoverIndex < 12; hoverIndex++) {
        vec3 hoverPoint = uHoverPoints[hoverIndex];
        float pointProbability = 1.0 - smoothstep(
          distortedRadius - edgeBand,
          distortedRadius + edgeBand * 0.18,
          distance(cellCenter, hoverPoint.xy)
        );
        hoverProbability = max(hoverProbability, pointProbability * hoverPoint.z);
      }
      float insideHoverClip = step(uHoverClip.x, cellCenter.x)
        * step(uHoverClip.y, cellCenter.y)
        * step(cellCenter.x, uHoverClip.z)
        * step(cellCenter.y, uHoverClip.w);
      float clipPermission = mix(1.0, insideHoverClip, uClipHover);
      bool useDna = hoverPick < hoverProbability * uHoverDensity * clipPermission;

      if (useDna) {
        float dnaIndex = floor(hash21(cellId + vec2(19.0, 113.0)) * 4.0);
        float letter = dnaAlpha(dnaIndex, localUv);
        vec3 background = vec3(0.0);
        vec3 ink = vec3(1.0);
        if (dnaIndex < 0.5) {
          background = vec3(0.0, 0.545, 0.753);
        } else if (dnaIndex < 1.5) {
          background = vec3(0.945, 0.169, 0.086);
        } else if (dnaIndex < 2.5) {
          background = vec3(1.0);
          ink = vec3(0.0);
        }
        gl_FragColor = vec4(mix(background, ink, letter), 1.0);
        return;
      }

      float glyph = atlasAlpha(glyphIndex, localUv);
      vec2 atlasPixel = vec2(1.0 / 576.0);
      float halo = max(
        max(atlasAlpha(glyphIndex, localUv + vec2(atlasPixel.x * 4.0, 0.0)),
            atlasAlpha(glyphIndex, localUv - vec2(atlasPixel.x * 4.0, 0.0))),
        max(atlasAlpha(glyphIndex, localUv + vec2(0.0, atlasPixel.y * 4.0)),
            atlasAlpha(glyphIndex, localUv - vec2(0.0, atlasPixel.y * 4.0)))
      );
      float intensity = glyph + max(0.0, halo - glyph) * uGlow * 0.42;
      float palettePosition = clamp(signal * 0.82 + glyph * 0.18, 0.0, 1.0);
      vec3 signalColor = mix(
        uSignalShadow,
        uSignalLow,
        smoothstep(0.0, 0.25, palettePosition)
      );
      signalColor = mix(
        signalColor,
        uSignalMid,
        smoothstep(0.25, 0.5, palettePosition)
      );
      signalColor = mix(
        signalColor,
        uSignalHigh,
        smoothstep(0.5, 0.75, palettePosition)
      );
      signalColor = mix(
        signalColor,
        uSignalHighlight,
        smoothstep(0.75, 1.0, palettePosition)
      );
      vec3 color = signalColor * (0.52 + signal * 0.98) * intensity;
      color += uSignalHighlight * glyph * uGlow * 0.14;
      gl_FragColor = vec4(color, 1.0);
    }
  `
});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial));

const loading = document.getElementById('helix-loading');
const loadingLabel = loading.querySelector('span');
const loadingOutput = loading.querySelector('output');
let helix = null;
let autoSpin = document.getElementById('helix-auto-spin')?.checked ?? false;
let spinSpeed = 0.08;
let interacting = false;
let cameraTween = null;

const hotspotDefinitions = [
  {
    position: new THREE.Vector3(-0.52, 0.72, 0.08),
    cameraOffset: new THREE.Vector3(-1.05, 0.18, 1.35)
  },
  {
    position: new THREE.Vector3(0.5, 0.02, 0.12),
    cameraOffset: new THREE.Vector3(1.05, 0.22, 1.35)
  },
  {
    position: new THREE.Vector3(-0.42, -0.72, 0.06),
    cameraOffset: new THREE.Vector3(-0.95, -0.18, 1.3)
  }
];
const productDefinitions = [
  {
    title: 'ARGUS',
    description: 'A deployable biosurveillance platform for detecting, identifying, and tracking emerging biological threats.'
  },
  {
    title: 'KINGSFOIL',
    description: 'A rugged field intelligence node for continuous genomic sensing, classification, and secure edge analysis.'
  },
  {
    title: 'BIOCORE',
    description: 'A hardened biological compute module for rapid sample processing and distributed threat response.'
  }
];
const hotspotAnchors = hotspotDefinitions.map((definition) => {
  const anchor = new THREE.Object3D();
  anchor.position.copy(definition.position);
  modelGroup.add(anchor);
  return anchor;
});
const hotspotElements = [...document.querySelectorAll('.helix-hotspot')];
const projectedPoint = new THREE.Vector3();
const worldPoint = new THREE.Vector3();
const HOME_TARGET = new THREE.Vector3(0, 0, 0);
const HOME_CAMERA = new THREE.Vector3(0, 0.15, isAtcgExperiment ? 5.2 : 3);

const productViewer = document.getElementById('helix-product-viewer');
const productViewport = productViewer?.querySelector('.helix-product-viewport');
const productCanvas = document.getElementById('helix-product-canvas');
const productTitle = document.getElementById('helix-product-title');
const productDescription = document.getElementById('helix-product-description');
const productLoading = document.getElementById('helix-product-loading');
let productRenderer = null;
let productScene = null;
let productCamera = null;
let productModelGroup = null;
let productModel = null;

function fitProductModel(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const scale = 2.5 / Math.max(size.x, size.y, size.z);
  root.position.copy(center).multiplyScalar(-scale);
  root.scale.setScalar(scale);
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    const productMaterials = sourceMaterials.map((source) => {
      const material = source.clone();
      if (material.color) material.color.multiply(new THREE.Color(0x747a74));
      if ('metalness' in material) material.metalness = Math.max(material.metalness || 0, 0.24);
      if ('roughness' in material) material.roughness = Math.max(material.roughness || 0, 0.68);
      if (material.emissive) material.emissive.set(0x000000);
      material.needsUpdate = true;
      return material;
    });
    child.material = Array.isArray(child.material) ? productMaterials : productMaterials[0];
  });
  root.updateMatrixWorld(true);
}

function setupProductViewer() {
  if (!productViewer || !productCanvas || !productLoading) return;
  productRenderer = new THREE.WebGLRenderer({
    canvas: productCanvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance'
  });
  productRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  productRenderer.setClearColor(0x000000, 0);
  productRenderer.outputColorSpace = THREE.SRGBColorSpace;
  productRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  productRenderer.toneMappingExposure = 1.1;

  productScene = new THREE.Scene();
  productCamera = new THREE.PerspectiveCamera(34, 1, 0.01, 30);
  productCamera.position.set(0, 0.05, 5.05);
  productModelGroup = new THREE.Group();
  productModelGroup.rotation.set(0.12, -0.45, -0.18);
  productScene.add(productModelGroup);
  productScene.add(new THREE.HemisphereLight(0xdde5d8, 0x050805, 1.8));
  const productKey = new THREE.DirectionalLight(0xffffff, 3);
  productKey.position.set(3, 4, 5);
  productScene.add(productKey);
  const productRim = new THREE.DirectionalLight(0xb7ff00, 1.8);
  productRim.position.set(-4, 1, -3);
  productScene.add(productRim);

  const productLoader = new GLTFLoader();
  productLoader.load('/assets/pilgrim-rugged-server-2026.glb', (gltf) => {
    try {
      fitProductModel(gltf.scene);
      productModel = gltf.scene;
      productModelGroup.add(productModel);
      productLoading.classList.add('is-ready');
      productLoading.querySelector('span').textContent = 'Field asset ready';
      productLoading.querySelector('output').textContent = 'GLB';
    } catch (error) {
      productLoading.classList.add('is-error');
      productLoading.querySelector('span').textContent = 'Asset failed';
      productLoading.querySelector('output').textContent = 'ERR';
      console.error(error);
    }
  }, (event) => {
    if (!event.total) return;
    productLoading.querySelector('output').textContent = `${Math.round(event.loaded / event.total * 100)}%`;
  }, (error) => {
    productLoading.classList.add('is-error');
    productLoading.querySelector('span').textContent = 'Asset failed';
    productLoading.querySelector('output').textContent = 'ERR';
    console.error(error);
  });
}

function openProductViewer(index) {
  if (!productViewer) return;
  const definition = productDefinitions[index] || productDefinitions[0];
  productTitle.textContent = definition.title;
  productDescription.textContent = definition.description;
  productViewer.hidden = false;
  uniforms.uClipHover.value = 1;
  if (isAtcgExperiment) {
    currentHoverPoint = null;
    previousHoverPoint = null;
    hoverTrail.length = 0;
  }
  if (productModelGroup) productModelGroup.rotation.y = -0.45;
}

function closeProductViewer() {
  if (productViewer) productViewer.hidden = true;
  uniforms.uClipHover.value = 0;
  if (isAtcgExperiment) {
    currentHoverPoint = null;
    previousHoverPoint = null;
    hoverTrail.length = 0;
  }
}

function updateProductHoverClip() {
  if (!productViewport || !productViewer || productViewer.hidden) return;
  const canvasRect = canvas.getBoundingClientRect();
  const viewportRect = productViewport.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height) return;
  const scaleX = uniforms.uResolution.value.x / canvasRect.width;
  const scaleY = uniforms.uResolution.value.y / canvasRect.height;
  uniforms.uHoverClip.value.set(
    (viewportRect.left - canvasRect.left) * scaleX,
    (canvasRect.bottom - viewportRect.bottom) * scaleY,
    (viewportRect.right - canvasRect.left) * scaleX,
    (canvasRect.bottom - viewportRect.top) * scaleY
  );
}

function resizeProductViewer() {
  if (!productRenderer || !productCamera || !productViewer || productViewer.hidden) return;
  const width = productCanvas.clientWidth;
  const height = productCanvas.clientHeight;
  const expectedWidth = Math.round(width * productRenderer.getPixelRatio());
  const expectedHeight = Math.round(height * productRenderer.getPixelRatio());
  updateProductHoverClip();
  if (productCanvas.width === expectedWidth && productCanvas.height === expectedHeight) return;
  productRenderer.setSize(width, height, false);
  productCamera.aspect = width / height;
  productCamera.updateProjectionMatrix();
}

setupProductViewer();

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
  const tileContext = tile.getContext('2d', { willReadFrequently: true });
  tileContext.drawImage(image, 0, 0, 96, 96);
  const pixels = tileContext.getImageData(0, 0, 96, 96).data;
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
  const atlasContext = atlas.getContext('2d');
  images.forEach((image, index) => {
    const tile = document.createElement('canvas');
    tile.width = 96;
    tile.height = 96;
    const tileContext = tile.getContext('2d');
    tileContext.drawImage(image, 4, 4, 88, 88);
    tileContext.globalCompositeOperation = 'source-in';
    tileContext.fillStyle = '#ffffff';
    tileContext.fillRect(0, 0, 96, 96);
    atlasContext.drawImage(tile, (index % 6) * 96, Math.floor(index / 6) * 96);
  });

  const texture = new THREE.CanvasTexture(atlas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  uniforms.tGlyphs.value.dispose();
  uniforms.tGlyphs.value = texture;
}

function buildDnaAtlas() {
  const atlas = document.createElement('canvas');
  atlas.width = 384;
  atlas.height = 96;
  const atlasContext = atlas.getContext('2d');
  atlasContext.clearRect(0, 0, atlas.width, atlas.height);
  atlasContext.fillStyle = '#ffffff';
  atlasContext.font = '700 68px "DM Mono", monospace';
  atlasContext.textAlign = 'center';
  atlasContext.textBaseline = 'middle';
  ['A', 'T', 'C', 'G'].forEach((letter, index) => {
    atlasContext.fillText(letter, index * 96 + 48, 51);
  });
  const texture = new THREE.CanvasTexture(atlas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  uniforms.tDnaGlyphs.value.dispose();
  uniforms.tDnaGlyphs.value = texture;
}

function fitModel(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const scale = 4.8 / Math.max(size.x, size.y, size.z);
  root.position.copy(center).multiplyScalar(-scale);
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
}

function prepareModel(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.computeVertexNormals();
    object.material = new THREE.MeshStandardMaterial({
      color: 0xf4f5ef,
      emissive: 0x050805,
      roughness: 0.62,
      metalness: 0.08,
      side: THREE.DoubleSide
    });
  });
  fitModel(root);
  modelGroup.add(root);
  helix = root;
}

function startCameraMove(target, position, activeIndex = -1, targetRotation = null) {
  cameraTween = {
    startedAt: performance.now(),
    duration: 1150,
    fromPosition: camera.position.clone(),
    toPosition: position.clone(),
    fromTarget: orbit.target.clone(),
    toTarget: target.clone(),
    fromRotation: modelGroup.quaternion.clone(),
    toRotation: targetRotation?.clone() || modelGroup.quaternion.clone()
  };
  interacting = false;
  orbit.enabled = false;
  hotspotElements.forEach((element, index) => {
    element.classList.toggle('is-active', index === activeIndex);
  });
}

function focusHotspot(index) {
  const anchor = hotspotAnchors[index];
  const definition = hotspotDefinitions[index];
  anchor.getWorldPosition(worldPoint);
  const offset = definition.cameraOffset.clone().applyQuaternion(modelGroup.quaternion);
  startCameraMove(worldPoint, worldPoint.clone().add(offset), index);
}

function updateCameraTween(now) {
  if (!cameraTween) return;
  const progress = Math.min(1, (now - cameraTween.startedAt) / cameraTween.duration);
  const eased = progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) * 0.5;
  camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
  orbit.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
  modelGroup.quaternion.slerpQuaternions(cameraTween.fromRotation, cameraTween.toRotation, eased);
  if (progress >= 1) {
    cameraTween = null;
    orbit.enabled = true;
    orbit.update();
  }
}

function updateHotspots() {
  const rect = canvas.getBoundingClientRect();
  hotspotElements.forEach((element, index) => {
    hotspotAnchors[index].getWorldPosition(projectedPoint);
    projectedPoint.project(camera);
    const x = rect.left + (projectedPoint.x * 0.5 + 0.5) * rect.width;
    const y = rect.top + (-projectedPoint.y * 0.5 + 0.5) * rect.height;
    const overControls = x > rect.right - 340 && y > rect.bottom - 380;
    const overReadout = x < rect.left + 310 && y > rect.bottom - 250;
    const visible = helix
      && projectedPoint.z > -1
      && projectedPoint.z < 1
      && Math.abs(projectedPoint.x) < 1.08
      && Math.abs(projectedPoint.y) < 1.08
      && !overControls
      && !overReadout;
    element.hidden = !visible;
    if (!visible) return;
    element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  });
}

const loader = new GLTFLoader();
const modelPromise = new Promise((resolve, reject) => {
  loader.load('/assets/dna-double-helix.glb', (gltf) => {
    try {
      prepareModel(gltf.scene);
      resolve();
    } catch (error) {
      reject(error);
    }
  }, (event) => {
    if (!event.total) return;
    loadingOutput.textContent = `${Math.round(event.loaded / event.total * 100)}%`;
  }, reject);
});

Promise.all([
  modelPromise,
  buildGlyphAtlas(),
  isAtcgExperiment ? Promise.resolve(buildDnaAtlas()) : Promise.resolve()
]).then(() => {
  loading.classList.add('is-ready');
  loadingLabel.textContent = isAtcgExperiment ? 'Dual glyph field ready' : 'DNA glyph field ready';
  loadingOutput.textContent = isAtcgExperiment ? '36 + ATCG' : '36 GLYPHS';
}).catch((error) => {
  loading.classList.add('is-error');
  loadingLabel.textContent = 'DNA field failed';
  loadingOutput.textContent = 'ERR';
  console.error(error);
});

bindRange('helix-cell', (value) => { uniforms.uCell.value = value; }, (value) => `${value.toFixed(0)} PX`);
bindRange('helix-density', (value) => { uniforms.uDensity.value = value; }, (value) => `${Math.round(value * 100)}%`);
bindRange('helix-threshold', (value) => { uniforms.uThreshold.value = value; }, (value) => value.toFixed(2));
bindRange('helix-contrast', (value) => { uniforms.uContrast.value = value; }, (value) => `${value.toFixed(2)}×`);
bindRange('helix-glow', (value) => { uniforms.uGlow.value = value; }, (value) => value.toFixed(2));
let hoverRadius = 110;
let hoverDecay = 0.55;
let assemblyScatter = 150;
let currentHoverPoint = null;
let previousHoverPoint = null;
const hoverTrail = [];
if (isAtcgExperiment) {
  const bindSignalColor = (id, uniform) => {
    const input = document.getElementById(id);
    const output = document.querySelector(`[data-for="${id}"]`);
    const update = () => {
      uniform.value.set(input.value);
      output.textContent = input.value.toUpperCase();
    };
    input.addEventListener('input', update);
    update();
  };
  bindSignalColor('helix-color-shadow', uniforms.uSignalShadow);
  bindSignalColor('helix-color-low', uniforms.uSignalLow);
  bindSignalColor('helix-color-mid', uniforms.uSignalMid);
  bindSignalColor('helix-color-high', uniforms.uSignalHigh);
  bindSignalColor('helix-color-highlight', uniforms.uSignalHighlight);
  bindRange('helix-hover-radius', (value) => {
    hoverRadius = value;
    uniforms.uHoverRadius.value = value * renderer.getPixelRatio();
  }, (value) => `${value.toFixed(0)} PX`);
  bindRange('helix-hover-density', (value) => {
    uniforms.uHoverDensity.value = value;
  }, (value) => `${Math.round(value * 100)}%`);
  bindRange('helix-hover-breakup', (value) => {
    uniforms.uHoverBreakup.value = value;
  }, (value) => `${Math.round(value * 100)}%`);
  bindRange('helix-hover-decay', (value) => {
    hoverDecay = value;
  }, (value) => `${value.toFixed(2)} S`);
  bindRange('helix-assembly-edge', (value) => {
    uniforms.uAssemblyEdge.value = value;
  }, (value) => `${Math.round(value * 100)}%`);
  bindRange('helix-assembly-feather', (value) => {
    uniforms.uAssemblyFeather.value = value;
  }, (value) => `${Math.round(value * 100)}%`);
  bindRange('helix-assembly-scatter', (value) => {
    assemblyScatter = value;
    uniforms.uAssemblyScatter.value = value * renderer.getPixelRatio();
  }, (value) => `${value.toFixed(0)} PX`);
  bindRange('helix-assembly-drift', (value) => {
    uniforms.uAssemblyDrift.value = value;
  }, (value) => `${value.toFixed(2)}×`);
}
bindRange('helix-spin-speed', (value) => { spinSpeed = value; }, (value) => `${value.toFixed(2)}×`);
const zoomInput = bindRange('helix-zoom', (value) => {
  const direction = camera.position.clone().sub(orbit.target);
  if (direction.lengthSq() < 0.0001) direction.set(0, 0, 1);
  camera.position.copy(orbit.target).add(direction.setLength(value));
  orbit.update();
}, (value) => `${value.toFixed(1)} M`);

document.getElementById('helix-auto-spin').addEventListener('change', (event) => {
  autoSpin = event.target.checked;
});
hotspotElements.forEach((element, index) => {
  element.addEventListener('click', () => {
    focusHotspot(index);
    openProductViewer(index);
  });
});
document.getElementById('helix-camera-reset').addEventListener('click', () => {
  closeProductViewer();
  startCameraMove(HOME_TARGET, HOME_CAMERA, -1, HOME_QUATERNION);
});
document.getElementById('helix-product-close')?.addEventListener('click', () => {
  closeProductViewer();
  startCameraMove(HOME_TARGET, HOME_CAMERA, -1, HOME_QUATERNION);
});

let canvasPress = null;
canvas.addEventListener('pointerdown', (event) => {
  canvasPress = { x: event.clientX, y: event.clientY };
}, { passive: true });
canvas.addEventListener('pointerup', (event) => {
  if (!canvasPress || !document.querySelector('.helix-hotspot.is-active')) {
    canvasPress = null;
    return;
  }
  const movement = Math.hypot(event.clientX - canvasPress.x, event.clientY - canvasPress.y);
  canvasPress = null;
  if (movement <= 6) {
    closeProductViewer();
    startCameraMove(HOME_TARGET, HOME_CAMERA, -1, HOME_QUATERNION);
  }
}, { passive: true });
if (isAtcgExperiment) {
  window.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const viewerIsOpen = productViewer && !productViewer.hidden;
    const viewportRect = viewerIsOpen && productViewport
      ? productViewport.getBoundingClientRect()
      : null;
    const insideProductViewport = viewportRect
      && event.clientX >= viewportRect.left
      && event.clientX <= viewportRect.right
      && event.clientY >= viewportRect.top
      && event.clientY <= viewportRect.bottom;
    const validHoverSurface = viewerIsOpen && insideProductViewport;
    if (!validHoverSurface) {
      if (currentHoverPoint) {
        hoverTrail.unshift({ ...currentHoverPoint, strength: 1 });
        hoverTrail.length = Math.min(hoverTrail.length, HOVER_TRAIL_COUNT - 1);
      }
      currentHoverPoint = null;
      previousHoverPoint = null;
      return;
    }
    const scaleX = uniforms.uResolution.value.x / rect.width;
    const scaleY = uniforms.uResolution.value.y / rect.height;
    const nextPoint = {
      x: (event.clientX - rect.left) * scaleX,
      y: (rect.bottom - event.clientY) * scaleY
    };
    if (!previousHoverPoint) {
      previousHoverPoint = nextPoint;
    } else {
      const distance = Math.hypot(nextPoint.x - previousHoverPoint.x, nextPoint.y - previousHoverPoint.y);
      if (distance >= uniforms.uCell.value * 0.8) {
        hoverTrail.unshift({ ...previousHoverPoint, strength: 1 });
        hoverTrail.length = Math.min(hoverTrail.length, HOVER_TRAIL_COUNT - 1);
        previousHoverPoint = nextPoint;
      }
    }
    currentHoverPoint = nextPoint;
  }, { passive: true });
  window.addEventListener('pointerleave', () => {
    if (currentHoverPoint) hoverTrail.unshift({ ...currentHoverPoint, strength: 1 });
    hoverTrail.length = Math.min(hoverTrail.length, HOVER_TRAIL_COUNT);
    currentHoverPoint = null;
    previousHoverPoint = null;
  });
}
orbit.addEventListener('start', () => { interacting = true; });
orbit.addEventListener('end', () => { interacting = false; });
orbit.addEventListener('change', () => {
  const distance = camera.position.distanceTo(orbit.target);
  zoomInput.value = String(distance);
  document.querySelector('[data-for="helix-zoom"]').textContent = `${distance.toFixed(1)} M`;
});

const drawingBufferSize = new THREE.Vector2();
function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const expectedWidth = Math.round(width * renderer.getPixelRatio());
  const expectedHeight = Math.round(height * renderer.getPixelRatio());
  if (canvas.width === expectedWidth && canvas.height === expectedHeight) return;
  renderer.setSize(width, height, false);
  renderer.getDrawingBufferSize(drawingBufferSize);
  renderTarget.setSize(drawingBufferSize.x, drawingBufferSize.y);
  uniforms.uResolution.value.copy(drawingBufferSize);
  if (isAtcgExperiment) {
    uniforms.uHoverRadius.value = hoverRadius * renderer.getPixelRatio();
    uniforms.uAssemblyScatter.value = assemblyScatter * renderer.getPixelRatio();
  }
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  resize();
  const delta = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();
  uniforms.uTime.value += delta;
  if (isAtcgExperiment) {
    if (hoverDecay <= 0.001) {
      hoverTrail.length = 0;
    } else {
      for (let index = hoverTrail.length - 1; index >= 0; index -= 1) {
        hoverTrail[index].strength -= delta / hoverDecay;
        if (hoverTrail[index].strength <= 0) hoverTrail.splice(index, 1);
      }
    }
    let uniformIndex = 0;
    if (currentHoverPoint) {
      hoverUniformPoints[uniformIndex].set(currentHoverPoint.x, currentHoverPoint.y, 1);
      uniformIndex += 1;
    }
    hoverTrail.slice(0, HOVER_TRAIL_COUNT - uniformIndex).forEach((point) => {
      hoverUniformPoints[uniformIndex].set(point.x, point.y, point.strength);
      uniformIndex += 1;
    });
    for (; uniformIndex < HOVER_TRAIL_COUNT; uniformIndex += 1) {
      hoverUniformPoints[uniformIndex].set(-10000, -10000, 0);
    }
  }
  const productViewerOpen = productViewer && !productViewer.hidden;
  if (helix && autoSpin && !interacting && !productViewerOpen) {
    if (isAtcgExperiment) {
      // The source helix is authored along local Y, then laid horizontally by
      // HOME_ROTATION. Spinning local Y therefore rolls it in place along its
      // visible longitudinal axis, like a spring, without orbiting its center.
      modelGroup.rotateY(delta * spinSpeed);
    } else {
      modelGroup.rotation.y += delta * spinSpeed;
    }
  }
  if (productModel && productViewer && !productViewer.hidden) {
    productModelGroup.rotation.y += delta * 0.32;
  }
  updateCameraTween(now);
  orbit.update();
  updateHotspots();

  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCamera);
  if (productRenderer && productViewer && !productViewer.hidden) {
    resizeProductViewer();
    productRenderer.render(productScene, productCamera);
  }
}
animate();
