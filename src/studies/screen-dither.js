import { THREE, createStage, bindRange } from '../shared.js';

const canvas = document.querySelector('.webgl');
const stage = createStage(canvas, { camera: [0, 0, 1], fov: 45, fog: 0 });
const { scene, renderer } = stage;
scene.fog = null;

const uniforms = {
  uTexture: { value: null },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uPointer: { value: new THREE.Vector2() },
  uImageAspect: { value: 16 / 9 },
  uSlice: { value: 2.1 },
  uWidth: { value: 1 },
  uDepth: { value: 6.5 },
  uCell: { value: 4.5 },
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
    uniform sampler2D uTexture;
    uniform vec2 uResolution;
    uniform vec2 uPointer;
    uniform float uImageAspect;
    uniform float uSlice;
    uniform float uWidth;
    uniform float uDepth;
    uniform float uCell;
    uniform vec3 uSignal;

    float bayer2(vec2 p) {
      p = floor(p);
      return fract(p.x * .5 + p.y * p.y * .75);
    }
    float bayer4(vec2 p) { return bayer2(p * .5) * .25 + bayer2(p); }
    float bayer8(vec2 p) { return bayer4(p * .5) * .25 + bayer2(p); }

    vec2 coverUv(vec2 uv) {
      float screenAspect = uResolution.x / uResolution.y;
      vec2 centered = uv - .5;
      if (screenAspect > uImageAspect) centered.y *= uImageAspect / screenAspect;
      else centered.x *= screenAspect / uImageAspect;
      return centered + .5;
    }

    void main() {
      vec2 uv = coverUv(vUv);
      float firstDepth = texture2D(uTexture, clamp(uv, 0.0, 1.0)).r;
      uv += uPointer * (firstDepth - .45) * .022;
      float depthValue = texture2D(uTexture, clamp(uv, 0.0, 1.0)).r;
      float z = (depthValue - .12) * uDepth;
      float focus = 1.0 - smoothstep(0.0, uWidth, abs(z - uSlice));

      vec2 cellId = floor(gl_FragCoord.xy / uCell);
      vec2 cellUv = fract(gl_FragCoord.xy / uCell);
      float threshold = bayer8(cellId);
      float density = clamp(.055 + depthValue * .82 + focus * .13, 0.0, 1.0);
      float ordered = step(threshold, density);

      float inset = mix(.31, .08, pow(focus, 1.2));
      float mark = step(inset, cellUv.x) * step(cellUv.x, 1.0 - inset)
                 * step(inset, cellUv.y) * step(cellUv.y, 1.0 - inset);
      vec3 color = mix(uSignal, vec3(.99), pow(focus, 1.25));
      float edgeFade = smoothstep(0.0, .015, uv.x) * smoothstep(0.0, .015, uv.y)
                     * smoothstep(0.0, .015, 1.0 - uv.x) * smoothstep(0.0, .015, 1.0 - uv.y);
      gl_FragColor = vec4(color * ordered * mark * edgeFade, 1.0);
    }
  `
});

scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

let currentTexture = null;
function loadImageSource(source, revokeAfterLoad = false) {
  new THREE.TextureLoader().load(source, (texture) => {
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    if (currentTexture) currentTexture.dispose();
    currentTexture = texture;
    uniforms.uTexture.value = texture;
    uniforms.uImageAspect.value = texture.image.width / texture.image.height;
    if (revokeAfterLoad) URL.revokeObjectURL(source);
  });
}

let sliceTarget = 2.1;
let sliceCurrent = 2.1;
const sliceOutput = document.querySelector('[data-for="slice"]');
const sliceInput = bindRange('slice', (value) => { sliceTarget = value; }, (value) => `${value.toFixed(2)} Z`);
bindRange('width', (value) => { uniforms.uWidth.value = value; }, (value) => value.toFixed(2));
bindRange('cell', (value) => { uniforms.uCell.value = value; }, (value) => `${value.toFixed(1)} px`);

const page = document.querySelector('.study-page');
const dropTarget = document.getElementById('image-drop');
const imageInput = document.getElementById('image-input');

stage.start((time, pointer) => {
  sliceCurrent += (sliceTarget - sliceCurrent) * .12;
  uniforms.uSlice.value = sliceCurrent;
  sliceInput.value = String(sliceCurrent);
  sliceOutput.textContent = `${sliceCurrent.toFixed(2)} Z`;
  uniforms.uPointer.value.lerp(pointer, .035);
  renderer.getDrawingBufferSize(uniforms.uResolution.value);
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
page.addEventListener('dragenter', (event) => { event.preventDefault(); dropTarget.classList.add('is-dragging'); });
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
