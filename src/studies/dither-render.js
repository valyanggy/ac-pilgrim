import { THREE, bindRange } from '../shared.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.querySelector('.webgl');
const guiToggle = document.querySelector('.ring-scan-gui-toggle');
if (guiToggle) {
  guiToggle.addEventListener('click', () => {
    const page = guiToggle.closest('.study-page');
    const hidden = page.classList.toggle('is-gui-hidden');
    guiToggle.textContent = hidden ? 'Show GUI' : 'Hide GUI';
    guiToggle.setAttribute('aria-expanded', String(!hidden));
  });
}
const isScrollDriven = document.querySelector('.scroll-render-page') !== null;
const isOrganic = document.querySelector('.organic-render-page') !== null;
const isMaterialStudy = document.querySelector('.material-render-page') !== null;
const isRingScan = document.querySelector('.ring-scan-page') !== null;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
renderer.setClearColor(0x040606, isRingScan ? 0 : 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = isMaterialStudy ? 0.8 : isRingScan ? 0.92 : 1.2;

const scene = new THREE.Scene();
scene.background = isRingScan ? null : new THREE.Color(0x040606);
scene.fog = new THREE.FogExp2(0x040606, 0.028);

let environmentTarget = null;
if (isMaterialStudy || isRingScan) {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const roomEnvironment = new RoomEnvironment();
  environmentTarget = pmremGenerator.fromScene(roomEnvironment, 0.04);
  scene.environment = environmentTarget.texture;
  roomEnvironment.dispose();
  pmremGenerator.dispose();
}

const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
camera.position.set(0, isRingScan ? 0 : 0.1, isRingScan ? 6.6 : 7.4);

const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = 0.06;
if (isRingScan) orbit.enableDamping = false;
orbit.enabled = true;
orbit.enableRotate = true;
orbit.enablePan = true;
orbit.screenSpacePanning = true;
orbit.enableZoom = !isScrollDriven;
orbit.minDistance = 2.5;
orbit.maxDistance = 13;
orbit.target.set(0, 0, 0);

const hemisphere = new THREE.HemisphereLight(
  isRingScan ? 0xffffff : 0xdcefff,
  isRingScan ? 0x050505 : 0x030b12,
  isRingScan ? 1.05 : isMaterialStudy ? 0.45 : 1.45
);
scene.add(hemisphere);
const key = new THREE.DirectionalLight(isRingScan ? 0xffffff : 0xf7fff0, isRingScan ? 2.1 : isMaterialStudy ? 1.6 : 4.4);
key.position.set(4, 5, 7);
scene.add(key);
const rim = new THREE.DirectionalLight(isRingScan ? 0xffffff : 0x1c81bd, isRingScan ? 0.9 : isMaterialStudy ? 0.7 : 3.2);
rim.position.set(-5, 1, -3);
scene.add(rim);
const blueFill = new THREE.DirectionalLight(isRingScan ? 0x999999 : 0x1d9dff, isRingScan ? 0.32 : isMaterialStudy ? 0.35 : 1.15);
blueFill.position.set(3, -4, 2);
scene.add(blueFill);

let backgroundDitherPlane = null;
if (isOrganic) {
  const planeMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    toneMapped: false,
    side: THREE.DoubleSide
  });
  backgroundDitherPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 7.5),
    planeMaterial
  );
  backgroundDitherPlane.position.set(0, 0, -2.2);
  backgroundDitherPlane.frustumCulled = false;
  scene.add(backgroundDitherPlane);
}

const modelGroup = new THREE.Group();
modelGroup.rotation.set(isRingScan ? -0.04 : -0.12, isRingScan ? 0.08 : 0.55, 0);
scene.add(modelGroup);

const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  depthBuffer: true
});
renderTarget.samples = (isMaterialStudy || isRingScan) ? 4 : 0;
renderTarget.texture.colorSpace = THREE.SRGBColorSpace;

const postScene = new THREE.Scene();
const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const uniforms = {
  tScene: { value: renderTarget.texture },
  tGlyphs: { value: new THREE.Texture() },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uProgress: { value: 0 },
  uCell: { value: 15 },
  uDensity: { value: 0.94 },
  uThreshold: { value: 0.11 },
  uContrast: { value: 1.85 },
  uOutlineWeight: { value: 1 },
  uOutlineFill: { value: new THREE.Color('#010101') },
  uOutlineStroke: { value: new THREE.Color('#1C81BD') },
  uBackgroundDither: { value: new THREE.Color('#15506e') },
  uBackgroundDensity: { value: 0.42 },
  uTime: { value: 0 },
  uOrganic: { value: isOrganic ? 1 : 0 },
  uRingScan: { value: isRingScan ? 1 : 0 },
  uSemBrightness: { value: 1.1 },
  uSemShadowDetail: { value: 0.9 },
  uSemEdgeStrength: { value: 1.4 },
  uColor1: { value: new THREE.Color('#616161') },
  uColor2: { value: new THREE.Color('#de1705') },
  uColor3: { value: new THREE.Color('#d9d9d9') },
  uColor4: { value: new THREE.Color('#ffffff') },
  uColor5: { value: new THREE.Color('#ffffff') },
  uSignal: { value: new THREE.Color('#1C81BD') }
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
    varying vec2 vUv;
    uniform sampler2D tScene;
    uniform sampler2D tGlyphs;
    uniform vec2 uResolution;
    uniform float uProgress;
    uniform float uCell;
    uniform float uDensity;
    uniform float uThreshold;
    uniform float uContrast;
    uniform float uOutlineWeight;
    uniform vec3 uOutlineFill;
    uniform vec3 uOutlineStroke;
    uniform vec3 uBackgroundDither;
    uniform float uBackgroundDensity;
    uniform float uTime;
    uniform float uOrganic;
    uniform float uRingScan;
    uniform float uSemBrightness;
    uniform float uSemShadowDetail;
    uniform float uSemEdgeStrength;
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform vec3 uColor3;
    uniform vec3 uColor4;
    uniform vec3 uColor5;
    uniform vec3 uSignal;

    float luma(vec3 color) {
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
      vec2 padded = mix(vec2(0.07), vec2(0.93), localUv);
      vec2 atlasUv = (vec2(column, 5.0 - row) + padded) / 6.0;
      return texture2D(tGlyphs, atlasUv).a;
    }

    vec3 ringPalette(float value) {
      if (value < 0.20) return uColor1;
      if (value < 0.40) return uColor2;
      if (value < 0.60) return uColor3;
      if (value < 0.80) return uColor4;
      return uColor5;
    }

    float semToneAt(vec2 uv) {
      vec2 semTexel = 1.0 / uResolution;
      float semCenter = luma(texture2D(tScene, uv).rgb);
      float semAround = (
        luma(texture2D(tScene, uv + vec2(semTexel.x, 0.0)).rgb) +
        luma(texture2D(tScene, uv - vec2(semTexel.x, 0.0)).rgb) +
        luma(texture2D(tScene, uv + vec2(0.0, semTexel.y)).rgb) +
        luma(texture2D(tScene, uv - vec2(0.0, semTexel.y)).rgb)
      ) * 0.25;
      float semEdge = abs(semCenter - semAround);
      float semGamma = mix(1.0, 0.34, uSemShadowDetail);
      float semLifted = pow(max(semCenter, 0.00001), semGamma);
      return clamp(
        semLifted * 0.82 * uSemBrightness
          + semEdge * uSemEdgeStrength,
        0.0,
        1.0
      );
    }

    float organicGrowthField(vec2 uv) {
      vec2 growthUv = uv;
      growthUv.x += sin(uv.y * 11.0 + sin(uv.x * 7.0)) * 0.052;
      growthUv.y += sin(uv.x * 8.0 - sin(uv.y * 6.0)) * 0.045;
      vec2 fromTop = growthUv - vec2(0.5, 1.045);
      fromTop.x *= 0.64;
      float cellular = hash21(floor(growthUv * 22.0) + vec2(17.0, 43.0)) * 0.038;
      return length(fromTop)
        + sin(growthUv.x * 8.0) * 0.042
        + sin(growthUv.x * 19.0 + growthUv.y * 5.0) * 0.018
        + sin(growthUv.y * 15.0) * 0.012
        + cellular;
    }

    void main() {
      vec4 sceneSample = texture2D(tScene, vUv);
      vec3 sceneColor = sceneSample.rgb;
      if (uRingScan > 0.5) {
        sceneColor = vec3(semToneAt(vUv));
      }
      float rawSceneSignal = luma(sceneColor);
      float sceneSignal = clamp((rawSceneSignal - uThreshold) * uContrast, 0.0, 1.0);
      vec2 pixel = gl_FragCoord.xy;
      vec2 cellId = floor(pixel / uCell);
      vec2 cellCenter = (cellId + 0.5) * uCell;
      vec2 sampleUv = cellCenter / uResolution;
      vec4 sampledScene = texture2D(tScene, sampleUv);
      vec3 sampledColor = sampledScene.rgb;
      if (uRingScan > 0.5) {
        sampledColor = vec3(semToneAt(sampleUv));
      }
      float rawSampledSignal = luma(sampledColor);
      float sampledSignal = clamp((rawSampledSignal - uThreshold) * uContrast, 0.0, 1.0);
      float sampledPlaneMask = smoothstep(
        0.45,
        0.85,
        sampledColor.r - max(sampledColor.g, sampledColor.b)
      );
      float scenePlaneMask = smoothstep(
        0.45,
        0.85,
        sceneColor.r - max(sceneColor.g, sceneColor.b)
      );
      float modelSampledSignal = sampledSignal * (1.0 - sampledPlaneMask);
      modelSampledSignal = mix(
        modelSampledSignal,
        max(modelSampledSignal, sampledScene.a * 0.32),
        uRingScan
      );
      vec2 localUv = fract(pixel / uCell);
      float occupancy = mix(0.25, 1.0, smoothstep(0.012, 0.42, modelSampledSignal)) * uDensity;
      float pick = hash21(cellId);
      float glyphIndex = floor(clamp(
        smoothstep(0.005, 0.72, modelSampledSignal) * 33.0
          + hash21(cellId + floor(uTime * 2.0)) * 3.0,
        0.0,
        35.0
      ));
      float glyph = atlasAlpha(glyphIndex, localUv);
      float cellPhase = hash21(cellId + vec2(31.0, 17.0)) * 6.2831853;
      float shimmer = 0.94 + 0.06 * sin(uTime * 1.8 + cellPhase);
      float backdropPick = hash21(cellId + vec2(83.0, 19.0));
      float backdropGlyphIndex = floor(hash21(cellId + vec2(11.0, 91.0)) * 22.0);
      float backdropGlyph = atlasAlpha(backdropGlyphIndex, localUv);
      vec3 dither = vec3(0.012, 0.018, 0.014);
      if (sampledPlaneMask > 0.5 && backdropPick < uBackgroundDensity) {
        float backdropStrength = 0.72 + hash21(cellId + vec2(47.0, 5.0)) * 0.42;
        dither += uBackgroundDither * backdropGlyph * backdropStrength;
      }
      if (modelSampledSignal > 0.004 && pick < occupancy) {
        vec3 objectDitherColor = mix(uSignal, ringPalette(modelSampledSignal), uRingScan);
        dither += objectDitherColor * glyph * (0.5 + modelSampledSignal * 1.55) * shimmer;
      }

      float resolved = 0.0;
      float growthThreshold = 0.0;
      float cellGrowthField = 1.0;
      float distanceToScan = 1.0;
      if (uOrganic > 0.5) {
        cellGrowthField = organicGrowthField(sampleUv);
        growthThreshold = mix(-0.05, 1.16, uProgress);
        resolved = step(
          cellGrowthField,
          growthThreshold - 0.010
        );
      } else {
        float topDown = 1.0 - vUv.y;
        resolved = 1.0 - smoothstep(uProgress - 0.002, uProgress + 0.002, topDown);
        distanceToScan = abs(topDown - uProgress);
      }

      float objectMask = smoothstep(0.008, 0.075, rawSceneSignal + rawSampledSignal);
      if (uOrganic > 0.5) {
        resolved *= objectMask * (1.0 - scenePlaneMask);
      }
      if (uRingScan > 0.5) resolved = 1.0 - resolved;
      vec3 color = mix(dither, sceneColor, resolved);

      if (uOrganic > 0.5) {
        float ringCellMask = step(
          abs(cellGrowthField - growthThreshold),
          0.010
        ) * step(0.004, modelSampledSignal);
        float cellEdge = min(
          min(localUv.x, 1.0 - localUv.x),
          min(localUv.y, 1.0 - localUv.y)
        );
        float outlineWidth = uOutlineWeight / uCell;
        float ringOutline = 1.0 - smoothstep(
          outlineWidth * 0.72,
          outlineWidth * 1.28,
          cellEdge
        );
        color = mix(color, uOutlineFill, ringCellMask);
        color = mix(color, uOutlineStroke, ringCellMask * ringOutline);
      } else {
        float scanLine = 1.0 - smoothstep(0.0, 0.0016, distanceToScan);
        if (uRingScan < 0.5) color += uSignal * scanLine * 0.35;
      }
      gl_FragColor = vec4(color, 1.0);
    }
  `
});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial));

const loading = document.getElementById('render-loading');
const loadingLabel = loading.querySelector('span');
const loadingOutput = loading.querySelector('output');
const progressInput = document.getElementById('render-progress');
const progressOutput = document.querySelector('[data-for="render-progress"]');
const scanPercent = document.getElementById('render-scan-percent');
const scanState = document.getElementById('render-scan-state');
const scanLabel = document.querySelector('.render-scan-label');
let model = null;
let progress = 0;
let speed = 0.13;
let spinSpeed = 0.1;
let autoResolve = !isScrollDriven;
let shouldLoop = true;
let holdAtEnd = 0;
let scanDirection = 1;
let interacting = false;
let scrollTarget = 0;

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

const materialSettings = {
  color: new THREE.Color('#a9b8c2'),
  roughness: 0.42,
  metalness: 0.08,
  environment: 0.8,
  wireframe: true,
  wireOpacity: 0.32
};
let whiteMatteOverride = isOrganic;

function createWhiteMatteMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0xf5f5f0,
    roughness: 0.92,
    metalness: 0,
    envMapIntensity: 0.25,
    side: THREE.DoubleSide
  });
}

function applyMaterialSettings(material) {
  if (!isMaterialStudy || !material?.isMeshStandardMaterial) return;
  material.color.copy(materialSettings.color);
  material.roughness = materialSettings.roughness;
  material.metalness = materialSettings.metalness;
  material.envMapIntensity = materialSettings.environment;
  material.wireframe = materialSettings.wireframe;
  material.transparent = materialSettings.wireframe;
  material.opacity = materialSettings.wireframe ? materialSettings.wireOpacity : 1;
  material.needsUpdate = true;
}

function updateModelMaterials() {
  model?.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(applyMaterialSettings);
  });
}

function updateOrganicMaterialOverride() {
  if (!isOrganic) return;
  model?.traverse((object) => {
    if (!object.isMesh) return;
    const sourceMaterial = object.userData.organicSourceMaterial;
    const matteMaterial = object.userData.organicMatteMaterial;
    if (!sourceMaterial || !matteMaterial) return;
    object.material = whiteMatteOverride ? matteMaterial : sourceMaterial;
  });
}

function prepareModel(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const scale = (isRingScan ? 3.2 : 3.15) / Math.max(size.x, size.y, size.z);
  root.position.copy(center).multiplyScalar(-scale);
  root.scale.setScalar(scale);
  root.traverse((object) => {
    if (!object.isMesh) return;
    if (!object.geometry.attributes.normal) object.geometry.computeVertexNormals();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const prepared = materials.map((material) => {
      if (!material) {
        const fallback = new THREE.MeshStandardMaterial({
          color: 0xdce8ef,
          roughness: 0.38,
          metalness: 0.22,
          side: THREE.DoubleSide
        });
        applyMaterialSettings(fallback);
        return fallback;
      }
      if (isRingScan) {
        return new THREE.MeshBasicMaterial({
          color: 0xffffff,
          map: material.map || null,
          alphaMap: material.alphaMap || null,
          alphaTest: material.alphaTest || 0,
          opacity: material.opacity ?? 1,
          transparent: material.transparent || (material.opacity ?? 1) < 1,
          side: THREE.DoubleSide,
          toneMapped: true
        });
      }
      const next = material.clone();
      next.side = THREE.DoubleSide;
      if ('roughness' in next) next.roughness = Math.max(0.28, next.roughness ?? 0.4);
      if ('metalness' in next) next.metalness = Math.min(0.72, next.metalness ?? 0.2);
      applyMaterialSettings(next);
      next.needsUpdate = true;
      return next;
    });
    const sourceMaterial = Array.isArray(object.material) ? prepared : prepared[0];
    if (isOrganic) {
      const matteMaterial = Array.isArray(sourceMaterial)
        ? sourceMaterial.map(() => createWhiteMatteMaterial())
        : createWhiteMatteMaterial();
      object.userData.organicSourceMaterial = sourceMaterial;
      object.userData.organicMatteMaterial = matteMaterial;
      object.material = whiteMatteOverride ? matteMaterial : sourceMaterial;
      return;
    }
    object.material = sourceMaterial;
  });
  modelGroup.add(root);
  model = root;
}

function disposeModel(root) {
  const textures = new Set();
  const materialsToDispose = new Set();
  root.traverse((object) => {
    object.geometry?.dispose?.();
    const materialGroups = [
      object.material,
      object.userData?.organicSourceMaterial,
      object.userData?.organicMatteMaterial
    ];
    materialGroups.forEach((group) => {
      const materials = Array.isArray(group) ? group : [group];
      materials.filter(Boolean).forEach((material) => materialsToDispose.add(material));
    });
  });
  materialsToDispose.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value?.isTexture) textures.add(value);
      });
    material.dispose?.();
  });
  textures.forEach((texture) => texture.dispose());
}

function replaceModel(root) {
  const previousModel = model;
  prepareModel(root);
  if (!previousModel) return;
  modelGroup.remove(previousModel);
  disposeModel(previousModel);
}

const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');
loader.setDRACOLoader(dracoLoader);
const modelUrl = isOrganic
  ? '/assets/dna-double-helix.glb'
  : isRingScan
    ? '/assets/lace-star-ring.glb'
    : '/assets/argus-model-optimized.glb';

function loadModelUrl(url, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      try {
        replaceModel(gltf.scene);
        resolve();
      } catch (error) {
        reject(error);
      }
    }, onProgress, reject);
  });
}

function parseModelFile(file) {
  return file.arrayBuffer().then((buffer) => new Promise((resolve, reject) => {
    loader.parse(buffer, '', (gltf) => {
      try {
        replaceModel(gltf.scene);
        resolve();
      } catch (error) {
        reject(error);
      }
    }, reject);
  }));
}

const modelPromise = loadModelUrl(modelUrl, (event) => {
  if (event.total) loadingOutput.textContent = `${Math.round(event.loaded / event.total * 100)}%`;
});

const modelUpload = document.getElementById('render-model-upload');
const modelUploadOutput = document.querySelector('[data-for="render-model-upload"]');
const modelReset = document.getElementById('render-model-reset');

modelUpload?.addEventListener('change', async () => {
  const [file] = modelUpload.files;
  if (!file) return;
  loading.classList.remove('is-ready', 'is-error');
  loadingLabel.textContent = `Loading ${file.name}`;
  loadingOutput.textContent = `${(file.size / 1024 / 1024).toFixed(1)} MB`;
  modelUpload.disabled = true;
  try {
    await parseModelFile(file);
    loading.classList.add('is-ready');
    loadingLabel.textContent = 'Uploaded model ready';
    loadingOutput.textContent = file.name;
    if (modelUploadOutput) modelUploadOutput.textContent = 'CUSTOM';
  } catch (error) {
    loading.classList.add('is-error');
    loadingLabel.textContent = 'Model upload failed';
    loadingOutput.textContent = 'GLB ERR';
    console.error(error);
  } finally {
    modelUpload.disabled = false;
  }
});

modelReset?.addEventListener('click', async () => {
  loading.classList.remove('is-ready', 'is-error');
  loadingLabel.textContent = 'Restoring default helix';
  loadingOutput.textContent = '0%';
  modelReset.disabled = true;
  if (modelUpload) modelUpload.disabled = true;
  try {
    await loadModelUrl('/assets/dna-double-helix.glb', (event) => {
      if (event.total) loadingOutput.textContent = `${Math.round(event.loaded / event.total * 100)}%`;
    });
    loading.classList.add('is-ready');
    loadingLabel.textContent = 'Default helix restored';
    loadingOutput.textContent = '3D + 36 GLYPHS';
    if (modelUpload) modelUpload.value = '';
    if (modelUploadOutput) modelUploadOutput.textContent = 'HELIX';
  } catch (error) {
    loading.classList.add('is-error');
    loadingLabel.textContent = 'Default model failed';
    loadingOutput.textContent = 'ERR';
    console.error(error);
  } finally {
    modelReset.disabled = false;
    if (modelUpload) modelUpload.disabled = false;
  }
});

Promise.all([modelPromise, buildGlyphAtlas()]).then(() => {
  loading.classList.add('is-ready');
  loadingLabel.textContent = isRingScan ? 'Ring scan field ready' : 'Dual render field ready';
  loadingOutput.textContent = isRingScan ? 'GLB + 5 COLORS' : '3D + 36 GLYPHS';
  if (modelUpload) modelUpload.disabled = false;
}).catch((error) => {
  loading.classList.add('is-error');
  loadingLabel.textContent = 'Render field failed';
  loadingOutput.textContent = 'ERR';
  if (modelUpload) modelUpload.disabled = false;
  console.error(error);
});

function setProgress(value) {
  progress = Math.max(0, Math.min(1, value));
  uniforms.uProgress.value = progress;
  if (scanLabel) {
    scanLabel.style.top = `${Math.max(8, Math.min(92, progress * 100))}%`;
    scanLabel.style.opacity = progress >= 0.995 && !isRingScan ? '0.35' : '1';
  }
  document.documentElement.style.setProperty('--render-scroll-progress', progress);
  const percent = Math.round(progress * 100);
  if (percent === setProgress.lastUiPercent) return;
  setProgress.lastUiPercent = percent;
  progressInput.value = String(progress);
  progressOutput.textContent = `${percent}%`;
  if (scanPercent) scanPercent.textContent = `${String(percent).padStart(3, '0')}%`;
  if (scanState) {
    scanState.textContent = isRingScan
      ? 'DITHER / MATERIAL BOUNDARY'
      : progress >= 1
        ? 'GEOMETRY RESOLVED'
        : isScrollDriven ? 'SCROLL TO RESOLVE' : 'RESOLVING GEOMETRY';
  }
}
setProgress.lastUiPercent = -1;

progressInput.addEventListener('input', () => {
  if (isScrollDriven) {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const value = Number(progressInput.value);
    scrollTarget = value;
    window.scrollTo({ top: maxScroll * value, behavior: 'auto' });
    setProgress(value);
    return;
  }
  autoResolve = false;
  document.getElementById('render-play').checked = false;
  holdAtEnd = 0;
  setProgress(Number(progressInput.value));
});
if (document.getElementById('render-speed')) {
  bindRange('render-speed', (value) => { speed = value; }, (value) => `${value.toFixed(2)}×`);
}
bindRange('render-cell', (value) => { uniforms.uCell.value = value; }, (value) => `${value.toFixed(0)} PX`);
bindRange('render-density', (value) => { uniforms.uDensity.value = value; }, (value) => `${Math.round(value * 100)}%`);
if (document.getElementById('render-threshold')) {
  bindRange('render-threshold', (value) => { uniforms.uThreshold.value = value; }, (value) => value.toFixed(2));
}
if (document.getElementById('render-contrast')) {
  bindRange('render-contrast', (value) => { uniforms.uContrast.value = value; }, (value) => `${value.toFixed(2)}×`);
}
if (document.getElementById('ring-sem-brightness')) {
  bindRange('ring-sem-brightness', (value) => {
    uniforms.uSemBrightness.value = value;
  }, (value) => `${value.toFixed(2)}×`);
}
if (document.getElementById('ring-sem-shadow-detail')) {
  bindRange('ring-sem-shadow-detail', (value) => {
    uniforms.uSemShadowDetail.value = value;
  }, (value) => `${Math.round(value * 100)}%`);
}
if (document.getElementById('ring-sem-edge')) {
  bindRange('ring-sem-edge', (value) => {
    uniforms.uSemEdgeStrength.value = value;
  }, (value) => `${value.toFixed(1)}×`);
}
if (document.getElementById('render-outline-weight')) {
  bindRange('render-outline-weight', (value) => { uniforms.uOutlineWeight.value = value; }, (value) => `${value.toFixed(1)} PX`);
}
function bindColor(id, uniform) {
  const input = document.getElementById(id);
  if (!input) return;
  const output = document.querySelector(`[data-for="${id}"]`);
  const update = () => {
    uniform.value.set(input.value);
    if (output) output.textContent = input.value.toUpperCase();
  };
  input.addEventListener('input', update);
  update();
}
bindColor('render-outline-fill', uniforms.uOutlineFill);
bindColor('render-outline-stroke', uniforms.uOutlineStroke);
bindColor('render-object-dither', uniforms.uSignal);
bindColor('render-background', uniforms.uBackgroundDither);
bindColor('ring-color-1', uniforms.uColor1);
bindColor('ring-color-2', uniforms.uColor2);
bindColor('ring-color-3', uniforms.uColor3);
bindColor('ring-color-4', uniforms.uColor4);
bindColor('ring-color-5', uniforms.uColor5);
if (document.getElementById('render-background-density')) {
  bindRange('render-background-density', (value) => {
    uniforms.uBackgroundDensity.value = value;
  }, (value) => `${Math.round(value * 100)}%`);
}
if (document.getElementById('render-material-color')) {
  bindColor('render-material-color', { value: materialSettings.color });
  document.getElementById('render-material-color').addEventListener('input', updateModelMaterials);
}
if (document.getElementById('render-roughness')) {
  bindRange('render-roughness', (value) => {
    materialSettings.roughness = value;
    updateModelMaterials();
  }, (value) => value.toFixed(2));
}
if (document.getElementById('render-metalness')) {
  bindRange('render-metalness', (value) => {
    materialSettings.metalness = value;
    updateModelMaterials();
  }, (value) => value.toFixed(2));
}
if (document.getElementById('render-environment')) {
  bindRange('render-environment', (value) => {
    materialSettings.environment = value;
    updateModelMaterials();
  }, (value) => `${value.toFixed(2)}×`);
}
if (document.getElementById('render-key-light')) {
  bindRange('render-key-light', (value) => { key.intensity = value; }, (value) => value.toFixed(1));
}
if (document.getElementById('render-rim-light')) {
  bindRange('render-rim-light', (value) => { rim.intensity = value; }, (value) => value.toFixed(1));
}
if (document.getElementById('render-exposure')) {
  bindRange('render-exposure', (value) => {
    renderer.toneMappingExposure = value;
  }, (value) => value.toFixed(2));
}
document.getElementById('render-wireframe')?.addEventListener('change', (event) => {
  materialSettings.wireframe = event.target.checked;
  updateModelMaterials();
});
if (document.getElementById('render-wire-opacity')) {
  bindRange('render-wire-opacity', (value) => {
    materialSettings.wireOpacity = value;
    updateModelMaterials();
  }, (value) => `${Math.round(value * 100)}%`);
}
document.getElementById('render-white-matte')?.addEventListener('change', (event) => {
  whiteMatteOverride = event.target.checked;
  updateOrganicMaterialOverride();
});
if (document.getElementById('render-spin')) {
  bindRange('render-spin', (value) => { spinSpeed = value; }, (value) => `${value.toFixed(2)}×`);
}
document.getElementById('render-play')?.addEventListener('change', (event) => {
  autoResolve = event.target.checked;
});
document.getElementById('render-loop')?.addEventListener('change', (event) => {
  shouldLoop = event.target.checked;
});
document.getElementById('render-restart').addEventListener('click', () => {
  if (isScrollDriven) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  holdAtEnd = 0;
  scanDirection = 1;
  setProgress(0);
  autoResolve = true;
  document.getElementById('render-play').checked = true;
});
orbit.addEventListener('start', () => { interacting = true; });
orbit.addEventListener('end', () => { interacting = false; });
function updateScrollTarget() {
  const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  scrollTarget = Math.max(0, Math.min(1, window.scrollY / maxScroll));
}

if (isScrollDriven) {
  window.addEventListener('scroll', updateScrollTarget, { passive: true });
  window.addEventListener('resize', updateScrollTarget, { passive: true });
  updateScrollTarget();
  setProgress(scrollTarget);
} else {
  setProgress(isRingScan ? 0.5 : 0);
}

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
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

const clock = new THREE.Clock();
const targetFrameInterval = 1000 / 45;
let lastRenderedAt = 0;
let animationFrame = 0;
function animate(frameTime = 0) {
  animationFrame = requestAnimationFrame(animate);
  const frameElapsed = frameTime - lastRenderedAt;
  if (frameElapsed < targetFrameInterval) return;
  lastRenderedAt = frameTime - Math.min(frameElapsed % targetFrameInterval, targetFrameInterval);
  resize();
  const delta = Math.min(clock.getDelta(), 0.05);
  uniforms.uTime.value += delta;
  if (model && !interacting && !isRingScan) modelGroup.rotation.y += delta * spinSpeed;
  if (isScrollDriven) {
    const smoothing = 1 - Math.exp(-delta * 14);
    setProgress(THREE.MathUtils.lerp(progress, scrollTarget, smoothing));
  } else if (autoResolve) {
    if (isRingScan) {
      const nextProgress = progress + delta * speed * scanDirection;
      if (nextProgress >= 1) {
        setProgress(1);
        if (shouldLoop) scanDirection = -1;
        else autoResolve = false;
      } else if (nextProgress <= 0) {
        setProgress(0);
        if (shouldLoop) scanDirection = 1;
        else autoResolve = false;
      } else {
        setProgress(nextProgress);
      }
    } else if (progress < 1) {
      setProgress(progress + delta * speed);
    } else if (shouldLoop) {
      holdAtEnd += delta;
      if (holdAtEnd > 1.35) {
        holdAtEnd = 0;
        setProgress(0);
      }
    }
  }
  orbit.update();
  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCamera);
}
animate();

window.addEventListener('pagehide', () => {
  cancelAnimationFrame(animationFrame);
  orbit.dispose();
  dracoLoader.dispose();
  environmentTarget?.dispose();
  renderTarget.dispose();
  uniforms.tGlyphs.value.dispose();
  postMaterial.dispose();
  postScene.traverse((object) => object.geometry?.dispose?.());
  scene.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach((material) => material.dispose?.());
  });
  renderer.dispose();
}, { once: true });
