import { THREE, createStage, bindRange } from '../shared.js';
import { SplatMesh } from '@sparkjsdev/spark';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const canvas = document.querySelector('.webgl');
const page = document.querySelector('.study-page');
const stage = createStage(canvas, {
  camera: [0, 0, 8],
  fov: 42,
  fog: 0,
  background: 0x030505,
  antialias: false,
  pixelRatio: Math.min(window.devicePixelRatio, 1.25),
  maxFps: 60
});
const { renderer, scene, camera } = stage;
scene.fog = null;
camera.near = .1;
camera.far = 500;
camera.updateProjectionMatrix();

const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.dampingFactor = .065;
orbit.enablePan = false;
orbit.rotateSpeed = .55;
orbit.zoomSpeed = .65;
orbit.minPolarAngle = .08;
orbit.maxPolarAngle = Math.PI * .49;

const state = {
  timeline: 0,
  scanHeight: 11,
  objectRadius: 5,
  groundY: -.45,
  thickness: .32,
  pointSize: 1.35,
  density: .28,
  spread: 30,
  zoom: 58,
  scrubbing: false,
  collider: null,
  origin: new THREE.Vector3(-7.9, -.45, -5.6)
};

const pointUniforms = {
  uTimeline: { value: 0 },
  uOrigin: { value: state.origin },
  uScanHeight: { value: state.scanHeight },
  uObjectRadius: { value: state.objectRadius },
  uGroundY: { value: state.groundY },
  uThickness: { value: state.thickness },
  uSpread: { value: state.spread },
  uPointSize: { value: state.pointSize },
  uDensity: { value: state.density },
  uPointColor: { value: new THREE.Color('#62c9a8') }
};

const pointMaterial = new THREE.ShaderMaterial({
  uniforms: pointUniforms,
  transparent: true,
  depthTest: true,
  depthWrite: false,
  vertexShader: `
    attribute vec3 aColor;
    attribute float aOpacity;
    attribute float aSeed;
    uniform float uTimeline;
    uniform vec3 uOrigin;
    uniform float uScanHeight;
    uniform float uObjectRadius;
    uniform float uGroundY;
    uniform float uThickness;
    uniform float uSpread;
    uniform float uPointSize;
    uniform float uDensity;
    uniform vec3 uPointColor;
    varying vec3 vColor;
    varying float vOpacity;
    varying float vWhiten;
    varying float vSeed;

    float ease(float value) {
      value = clamp(value, 0.0, 1.0);
      return value * value * (3.0 - 2.0 * value);
    }

    void main() {
      vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
      float descent = ease(uTimeline / .42);
      float groundPhase = ease((uTimeline - .42) / .52);
      float scanY = mix(uGroundY + uScanHeight, uGroundY, descent);
      float objectDistance = length(world.xz - uOrigin.xz);
      float objectMask = 1.0 - smoothstep(uObjectRadius * .52, uObjectRadius, objectDistance);
      float scanBand = 1.0 - smoothstep(0.0, uThickness * 4.5, abs(world.y - scanY));
      // Keep the descending scan on the floor while the plane scan fades in.
      // A hard step here caused the white field to disappear for one frame at .42.
      float verticalVisible = 1.0 - smoothstep(.42, .50, uTimeline);
      float verticalScan = scanBand * objectMask * verticalVisible;

      float groundRadius = mix(0.0, uSpread, groundPhase);
      float groundDistance = length(world.xz - uOrigin.xz);
      float groundBand = max(uThickness * 1.5, groundRadius * .018);
      float groundRing = 1.0 - smoothstep(0.0, groundBand * 5.0, abs(groundDistance - groundRadius));
      float groundPlane = 1.0 - smoothstep(0.0, uThickness * 4.0, abs(world.y - uGroundY));
      float groundVisible = smoothstep(.39, .48, uTimeline) * (1.0 - smoothstep(.96, 1.0, uTimeline));
      vWhiten = max(verticalScan * .92, groundRing * groundPlane * groundVisible * .78);

      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      gl_PointSize = uPointSize * clamp(18.0 / max(1.0, -mvPosition.z), .75, 2.5) * (1.0 + vWhiten * .32);
      vColor = uPointColor;
      vOpacity = aOpacity;
      vSeed = aSeed;
    }
  `,
  fragmentShader: `
    precision highp float;
    varying vec3 vColor;
    varying float vOpacity;
    varying float vWhiten;
    varying float vSeed;
    uniform float uDensity;
    void main() {
      if (vSeed > uDensity) discard;
      float distanceToCenter = length(gl_PointCoord - .5);
      if (distanceToCenter > .5) discard;
      float edge = 1.0 - smoothstep(.34, .5, distanceToCenter);
      vec3 color = mix(vColor, vec3(1.0), clamp(vWhiten, 0.0, 1.0));
      float alpha = mix(clamp(vOpacity, .28, .92), 1.0, vWhiten) * edge;
      gl_FragColor = vec4(color, alpha);
    }
  `
});

const asciiShader = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCellSize: { value: 9 },
    uContrast: { value: 1.35 },
    uMix: { value: 1 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uCellSize;
    uniform float uContrast;
    uniform float uMix;
    varying vec2 vUv;

    float rect(vec2 p, vec2 halfSize) {
      vec2 edge = smoothstep(halfSize, halfSize - vec2(.12), abs(p));
      return edge.x * edge.y;
    }

    float ring(vec2 p, float radius, float width) {
      return 1.0 - smoothstep(width, width + .12, abs(length(p) - radius));
    }

    float glyph(vec2 p, float tone) {
      p.x *= .72;
      float dot = 1.0 - smoothstep(.14, .24, length(p - vec2(0.0, -.58)));
      float colon = max(
        1.0 - smoothstep(.12, .22, length(p - vec2(0.0, -.35))),
        1.0 - smoothstep(.12, .22, length(p - vec2(0.0, .35)))
      );
      float dash = rect(p, vec2(.48, .10));
      float plus = max(dash, rect(p, vec2(.10, .58)));
      float cross = max(
        1.0 - smoothstep(.08, .18, abs(p.y - p.x)),
        1.0 - smoothstep(.08, .18, abs(p.y + p.x))
      ) * (1.0 - smoothstep(.58, .82, length(p)));
      float hash = max(
        max(rect(p - vec2(-.25, 0.0), vec2(.08, .72)), rect(p - vec2(.25, 0.0), vec2(.08, .72))),
        max(rect(p - vec2(0.0, -.27), vec2(.58, .07)), rect(p - vec2(0.0, .27), vec2(.58, .07)))
      );
      float at = max(ring(p, .56, .11), max(rect(p - vec2(.16, -.04), vec2(.09, .36)), ring(p + vec2(.05, 0.0), .25, .09)));
      if (tone < .08) return 0.0;
      if (tone < .20) return dot;
      if (tone < .32) return colon;
      if (tone < .44) return dash;
      if (tone < .57) return plus;
      if (tone < .70) return cross;
      if (tone < .84) return hash;
      return at;
    }

    void main() {
      vec2 cell = vec2(uCellSize, uCellSize * 1.45);
      vec2 cellIndex = floor(gl_FragCoord.xy / cell);
      vec2 samplePixel = (cellIndex + .5) * cell;
      vec2 sampleUv = samplePixel / uResolution;
      vec3 source = texture2D(tDiffuse, vUv).rgb;
      vec3 sampled = texture2D(tDiffuse, sampleUv).rgb;
      float luminance = dot(sampled, vec3(.2126, .7152, .0722));
      float tone = clamp((luminance - .08) * uContrast, 0.0, 1.0);
      vec2 local = fract(gl_FragCoord.xy / cell) * 2.0 - 1.0;
      float mask = glyph(local, tone);
      vec3 asciiColor = sampled * mask * (1.05 + tone * .45);
      gl_FragColor = vec4(mix(source, asciiColor, uMix), 1.0);
    }
  `
};

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const asciiPass = new ShaderPass(asciiShader);
composer.addPass(asciiPass);
const renderSize = new THREE.Vector2();
let composerWidth = 0;
let composerHeight = 0;

const modelSources = {
  sharp: '/assets/sharp-output.ply',
  original: '/assets/image-1784576848495-8611d826.ply'
};
const requestedModel = new URLSearchParams(window.location.search).get('model');
const activeModel = requestedModel === 'original' ? 'original' : 'sharp';
document.querySelectorAll('[data-model]').forEach((button) => {
  const isActive = button.dataset.model === activeModel;
  button.classList.toggle('is-active', isActive);
  button.setAttribute('aria-selected', String(isActive));
  button.tabIndex = isActive ? 0 : -1;
  button.addEventListener('click', () => {
    if (button.dataset.model === activeModel) return;
    const params = new URLSearchParams(window.location.search);
    params.set('model', button.dataset.model);
    window.location.search = params.toString();
  });
});

const loading = document.getElementById('gaussian-loading');
const loadingOutput = loading.querySelector('output');
const splat = new SplatMesh({
  url: modelSources[activeModel],
  editable: false,
  raycastable: false,
  onProgress: (event) => {
    if (!event.lengthComputable) return;
    loadingOutput.textContent = `${Math.round(event.loaded / event.total * 100)}%`;
  }
});
splat.rotation.x = Math.PI;
scene.add(splat);

const target = new THREE.Vector3();

splat.initialized.then(() => {
  const positions = new Float32Array(splat.numSplats * 3);
  const colors = new Float32Array(splat.numSplats * 3);
  const opacities = new Float32Array(splat.numSplats);
  const seeds = new Float32Array(splat.numSplats);
  const sampledWorldYs = [];
  let pointIndex = 0;
  splat.forEachSplat((index, center, scales, quaternion, opacity, color) => {
    const offset = pointIndex * 3;
    positions[offset] = center.x;
    positions[offset + 1] = center.y;
    positions[offset + 2] = center.z;
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
    opacities[pointIndex] = opacity;
    seeds[pointIndex] = ((pointIndex * 2654435761) >>> 0) / 4294967295;
    if (pointIndex % 24 === 0) sampledWorldYs.push(-center.y);
    pointIndex += 1;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.computeBoundingBox();
  const pointCloud = new THREE.Points(geometry, pointMaterial);
  pointCloud.rotation.x = Math.PI;
  pointCloud.frustumCulled = false;
  scene.add(pointCloud);
  pointCloud.updateMatrixWorld(true);
  const box = geometry.boundingBox.clone().applyMatrix4(pointCloud.matrixWorld);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const sceneScale = Math.max(size.x, size.y, size.z);
  sampledWorldYs.sort((a, b) => a - b);
  const percentile = (amount) => sampledWorldYs[Math.floor((sampledWorldYs.length - 1) * amount)];
  const lowerY = percentile(.035);
  const upperY = percentile(.985);
  target.copy(center);
  target.y = (lowerY + upperY) * .5;
  state.groundY = lowerY;
  state.scanHeight = upperY - lowerY;
  state.objectRadius = Math.max(size.x, size.z) * .11;
  state.spread = Math.max(size.x, size.z) * .38;
  state.origin.set(center.x, state.groundY, center.z);
  state.zoom = Math.max(state.scanHeight * 1.7, sceneScale * .72);
  camera.position.copy(target).add(new THREE.Vector3(0, state.scanHeight * .08, state.zoom));
  orbit.target.copy(target);
  orbit.minDistance = sceneScale * .35;
  orbit.maxDistance = sceneScale * 2.2;
  orbit.update();

  const setBoundControl = (id, value, min, max) => {
    const input = document.getElementById(id);
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.dispatchEvent(new Event('input'));
  };
  setBoundControl('ground-y', state.groundY, box.min.y - size.y * .1, box.max.y + size.y * .1);
  setBoundControl('scan-height', state.scanHeight, size.y * .15, size.y * 1.2);
  setBoundControl('object-radius', state.objectRadius, sceneScale * .02, sceneScale * .3);
  setBoundControl('spread', state.spread, sceneScale * .08, sceneScale * .8);
  setBoundControl('zoom', state.zoom, sceneScale * .35, sceneScale * 2.2);

  loading.dataset.bounds = JSON.stringify({
    min: box.min.toArray(),
    max: box.max.toArray(),
    center: center.toArray(),
    size: size.toArray()
  });
  loading.classList.add('is-ready');
  loading.querySelector('span').textContent = 'Point cloud ready';
  loadingOutput.textContent = `${pointIndex.toLocaleString()} pts`;
  state.collider = pointCloud;
  scene.remove(splat);
  splat.dispose();
}).catch((error) => {
  loading.querySelector('span').textContent = 'PLY load failed';
  loadingOutput.textContent = 'ERR';
  console.error(error);
});

const timelineInput = document.getElementById('timeline');
const timelineOutput = document.querySelector('[data-for="timeline"]');
const phaseIndex = document.getElementById('phase-index');
const phaseName = document.getElementById('phase-name');
const guiToggle = document.getElementById('gui-toggle');

timelineInput.addEventListener('pointerdown', () => { state.scrubbing = true; });
window.addEventListener('pointerup', () => { state.scrubbing = false; });
timelineInput.addEventListener('input', () => { state.timeline = Number(timelineInput.value); });

guiToggle.addEventListener('click', () => {
  const hidden = page.classList.toggle('is-gui-hidden');
  guiToggle.textContent = hidden ? 'Show GUI' : 'Hide GUI';
  guiToggle.setAttribute('aria-expanded', String(!hidden));
});

bindRange('scan-height', (value) => {
  state.scanHeight = value;
  pointUniforms.uScanHeight.value = value;
}, (value) => `${value.toFixed(1)} M`);
bindRange('object-radius', (value) => {
  state.objectRadius = value;
  pointUniforms.uObjectRadius.value = value;
}, (value) => `${value.toFixed(1)} M`);
bindRange('ground-y', (value) => {
  state.groundY = value;
  pointUniforms.uGroundY.value = value;
}, (value) => `${value.toFixed(2)} Y`);
bindRange('thickness', (value) => {
  state.thickness = value;
  pointUniforms.uThickness.value = value;
}, (value) => `${value.toFixed(2)} M`);
bindRange('point-size', (value) => {
  state.pointSize = value;
  pointUniforms.uPointSize.value = value;
}, (value) => `${value.toFixed(2)} PX`);
bindRange('density', (value) => {
  state.density = value;
  pointUniforms.uDensity.value = value;
}, (value) => `${Math.round(value * 100)}%`);
bindRange('glyph-size', (value) => {
  asciiPass.uniforms.uCellSize.value = value;
}, (value) => `${Math.round(value)} PX`);
bindRange('ascii-contrast', (value) => {
  asciiPass.uniforms.uContrast.value = value;
}, (value) => `${value.toFixed(2)}×`);
bindRange('ascii-mix', (value) => {
  asciiPass.uniforms.uMix.value = value;
}, (value) => `${Math.round(value * 100)}%`);
bindRange('spread', (value) => {
  state.spread = value;
  pointUniforms.uSpread.value = value;
}, (value) => `${value.toFixed(1)} M`);
const zoomInput = bindRange('zoom', (value) => {
  state.zoom = value;
  if (!state.collider) return;
  const direction = camera.position.clone().sub(orbit.target);
  if (direction.lengthSq() < .0001) direction.set(0, .08, 1);
  camera.position.copy(orbit.target).add(direction.setLength(value));
  orbit.update();
}, (value) => `${Math.round(value)} M`);
orbit.addEventListener('change', () => {
  if (!state.collider) return;
  state.zoom = camera.position.distanceTo(orbit.target);
  zoomInput.value = String(state.zoom);
  document.querySelector('[data-for="zoom"]').textContent = `${Math.round(state.zoom)} M`;
});

const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = .12;
const pointerNdc = new THREE.Vector2();
let pointerStart = null;
canvas.addEventListener('pointerdown', (event) => {
  pointerStart = { x: event.clientX, y: event.clientY, button: event.button };
});
canvas.addEventListener('pointerup', (event) => {
  if (!pointerStart || pointerStart.button !== 0 || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) {
    pointerStart = null;
    return;
  }
  pointerStart = null;
  if (!state.collider) return;
  const rect = canvas.getBoundingClientRect();
  pointerNdc.set(
    (event.clientX - rect.left) / rect.width * 2 - 1,
    -((event.clientY - rect.top) / rect.height * 2 - 1)
  );
  raycaster.setFromCamera(pointerNdc, camera);
  const hit = raycaster.intersectObject(state.collider, true)[0];
  if (!hit) return;
  state.origin.copy(hit.point);
  state.origin.y = state.groundY;
  state.timeline = 0;
});

stage.start(() => {
  timelineInput.value = String(state.timeline);
  timelineOutput.textContent = `${Math.round(state.timeline * 100)}%`;

  const descentEnd = .42;
  pointUniforms.uTimeline.value = state.timeline;

  if (state.timeline < descentEnd) {
    phaseIndex.textContent = '01';
    phaseName.textContent = 'Volume descent';
  } else if (state.timeline < .98) {
    phaseIndex.textContent = '02';
    phaseName.textContent = 'Plane propagation';
  } else {
    phaseIndex.textContent = '03';
    phaseName.textContent = 'Reset field';
  }

  orbit.update();
  renderer.getDrawingBufferSize(renderSize);
  if (renderSize.x !== composerWidth || renderSize.y !== composerHeight) {
    composerWidth = renderSize.x;
    composerHeight = renderSize.y;
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(canvas.clientWidth, canvas.clientHeight);
    asciiPass.uniforms.uResolution.value.set(composerWidth, composerHeight);
  }
  composer.render();
  return false;
});
