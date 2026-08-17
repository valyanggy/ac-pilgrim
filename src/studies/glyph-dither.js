import { THREE, createStage, bindRange, seededRandom } from '../shared.js';

const canvas = document.querySelector('.webgl');
const stage = createStage(canvas, { camera: [0, 0.1, 11.8], fov: 43, fog: 0 });
const { scene, camera } = stage;
const random = seededRandom(11903);

const glyphCount = 36;
const atlasCanvas = document.createElement('canvas');
const cellSize = 96;
atlasCanvas.width = cellSize * glyphCount;
atlasCanvas.height = cellSize;
const atlasContext = atlasCanvas.getContext('2d');
atlasContext.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);

const atlas = new THREE.CanvasTexture(atlasCanvas);
atlas.colorSpace = THREE.SRGBColorSpace;
atlas.minFilter = THREE.LinearFilter;
atlas.magFilter = THREE.LinearFilter;
atlas.generateMipmaps = false;

Promise.all(Array.from({ length: glyphCount }, (_, index) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = `/glyphs/${String(index + 1).padStart(2, '0')}.svg`;
}))).then((images) => {
  images.forEach((image, index) => atlasContext.drawImage(image, index * cellSize, 0, cellSize, cellSize));
  atlas.needsUpdate = true;
});

const uniforms = {
  uSlice: { value: 2.1 },
  uWidth: { value: 1 },
  uDepth: { value: 6.5 },
  uGlyphScale: { value: 1 },
  uGlyphCount: { value: glyphCount },
  uAtlas: { value: atlas },
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
    attribute float aGlyph;
    attribute float aSeed;
    uniform float uSlice;
    uniform float uWidth;
    uniform float uDepth;
    uniform float uGlyphScale;
    varying float vFocus;
    varying float vAlpha;
    varying float vGlyph;
    varying float vLum;
    void main() {
      vec3 p = position;
      p.z = (aLum - .12) * uDepth + (aSeed - .5) * .1;
      vFocus = 1.0 - smoothstep(0.0, uWidth, abs(p.z - uSlice));
      vAlpha = mix(.48 + aLum * .42 + min(aEdge, .15), 1.0, vFocus);
      vGlyph = aGlyph;
      vLum = aLum;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float baseSize = 11.0 + aLum * 6.0;
      float focusScale = 1.0 + pow(vFocus, 1.35) * 1.6;
      gl_PointSize = baseSize * focusScale * uGlyphScale;
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform sampler2D uAtlas;
    uniform float uGlyphCount;
    uniform vec3 uSignal;
    varying float vFocus;
    varying float vAlpha;
    varying float vGlyph;
    varying float vLum;
    void main() {
      vec2 atlasUv = vec2((vGlyph + gl_PointCoord.x) / uGlyphCount, 1.0 - gl_PointCoord.y);
      float mask = texture2D(uAtlas, atlasUv).a;
      if (mask < .08) discard;
      vec3 inactive = mix(uSignal * .58, uSignal, smoothstep(.08, .7, vLum));
      vec3 color = mix(inactive, vec3(.99), pow(vFocus, 1.2));
      gl_FragColor = vec4(color, mask * vAlpha);
    }
  `
});

let field = null;

function buildField(image) {
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = image.naturalWidth;
  sampleCanvas.height = image.naturalHeight;
  const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height);
  const positions = [];
  const luminance = [];
  const edges = [];
  const glyphIndices = [];
  const seeds = [];
  const step = 7;
  const worldWidth = 9.8;
  const worldHeight = worldWidth * image.naturalHeight / image.naturalWidth;

  const luminanceAt = (x, y) => {
    const px = Math.max(0, Math.min(image.naturalWidth - 1, x));
    const py = Math.max(0, Math.min(image.naturalHeight - 1, y));
    const index = (py * image.naturalWidth + px) * 4;
    return (data[index] * .2126 + data[index + 1] * .7152 + data[index + 2] * .0722) / 255;
  };

  for (let y = 0; y < image.naturalHeight; y += step) {
    for (let x = 0; x < image.naturalWidth; x += step) {
      const lum = luminanceAt(x, y);
      const edge = Math.min(1, Math.abs(lum - luminanceAt(x + step, y)) + Math.abs(lum - luminanceAt(x, y + step)));
      const keepChance = Math.min(1, .12 + lum * .62 + edge * 3.2);
      if (random() > keepChance) continue;
      positions.push((x / image.naturalWidth - .5) * worldWidth, (.5 - y / image.naturalHeight) * worldHeight, 0);
      luminance.push(lum);
      edges.push(edge);
      glyphIndices.push(Math.min(glyphCount - 1, Math.floor(lum * (glyphCount - 2) + random() * 2.0)));
      seeds.push(random());
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aLum', new THREE.Float32BufferAttribute(luminance, 1));
  geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edges, 1));
  geometry.setAttribute('aGlyph', new THREE.Float32BufferAttribute(glyphIndices, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  const nextField = new THREE.Points(geometry, material);
  if (field) {
    nextField.rotation.copy(field.rotation);
    scene.remove(field);
    field.geometry.dispose();
  }
  field = nextField;
  scene.add(field);
}

function loadImageSource(source, revokeAfterLoad = false) {
  const image = new Image();
  image.onload = () => {
    buildField(image);
    if (revokeAfterLoad) URL.revokeObjectURL(source);
  };
  image.src = source;
}

let sliceTarget = 2.1;
let sliceCurrent = 2.1;
const sliceOutput = document.querySelector('[data-for="slice"]');
const sliceInput = bindRange('slice', (value) => { sliceTarget = value; }, (value) => `${value.toFixed(2)} Z`);
bindRange('width', (value) => { uniforms.uWidth.value = value; }, (value) => value.toFixed(2));
bindRange('glyph', (value) => { uniforms.uGlyphScale.value = value; }, (value) => `${value.toFixed(2)}×`);

const page = document.querySelector('.study-page');
const dropTarget = document.getElementById('image-drop');
const imageInput = document.getElementById('image-input');

stage.start((time, pointer) => {
  sliceCurrent += (sliceTarget - sliceCurrent) * .12;
  uniforms.uSlice.value = sliceCurrent;
  sliceInput.value = String(sliceCurrent);
  sliceOutput.textContent = `${sliceCurrent.toFixed(2)} Z`;
  if (field) {
    field.rotation.y += (pointer.x * .07 - field.rotation.y) * .035;
    field.rotation.x += (-pointer.y * .025 - field.rotation.x) * .035;
  }
  camera.position.x += (pointer.x * .18 - camera.position.x) * .025;
  camera.lookAt(0, 0, 1.1);
});

page.addEventListener('wheel', (event) => {
  event.preventDefault();
  sliceTarget = THREE.MathUtils.clamp(sliceTarget - event.deltaY * .0035, Number(sliceInput.min), Number(sliceInput.max));
}, { passive: false });

function loadFile(file) {
  if (!file?.type.startsWith('image/')) return;
  loadImageSource(URL.createObjectURL(file), true);
}

imageInput.addEventListener('change', () => loadFile(imageInput.files?.[0]));
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

loadImageSource('/assets/depth-source-airport.png');
