import { THREE, createStage, bindRange, seededRandom } from '../shared.js';

const canvas = document.querySelector('.webgl');
const stage = createStage(canvas, { camera: [0, .05, 7.4], fov: 38, fog: 0.02 });
const { scene, camera } = stage;
const random = seededRandom(4402);
const positions = [];
const layers = [];
const seeds = [];

function insideHead(x, y, z) {
  const skull = (x / 1.38) ** 2 + ((y - .35) / 1.75) ** 2 + (z / 1.28) ** 2;
  const jaw = (x / .78) ** 2 + ((y + 1.25) / .83) ** 2 + ((z + .04) / .82) ** 2;
  return skull < 1 || jaw < 1;
}

for (let i = 0; i < 150000; i++) {
  const x = (random() - .5) * 3.2;
  const y = (random() - .5) * 4.5;
  const z = (random() - .5) * 3.0;
  if (!insideHead(x, y, z)) continue;
  const brain = (x / 1.08) ** 2 + ((y - .55) / 1.32) ** 2 + (z / 1.0) ** 2;
  const ventricleL = ((x - .28) / .2) ** 2 + ((y - .55) / .42) ** 2 + (z / .2) ** 2;
  const ventricleR = ((x + .28) / .2) ** 2 + ((y - .55) / .42) ** 2 + (z / .2) ** 2;
  if (ventricleL < 1 || ventricleR < 1) continue;
  positions.push(x, y, z);
  layers.push(brain < 1 ? 1 : 0);
  seeds.push(random());
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
geometry.setAttribute('aLayer', new THREE.Float32BufferAttribute(layers, 1));
geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));

const uniforms = {
  uSlice: { value: 0 },
  uWidth: { value: .16 },
  uTime: { value: 0 },
  uSignal: { value: new THREE.Color('#8ce9d9') }
};

const material = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: `
    attribute float aLayer;
    attribute float aSeed;
    uniform float uSlice;
    uniform float uWidth;
    uniform float uTime;
    varying float vAlpha;
    varying float vLayer;
    void main() {
      float section = 1.0 - smoothstep(0.0, uWidth, abs(position.z - uSlice));
      float shell = step(aSeed, mix(0.018, 0.72, section));
      vAlpha = shell * mix(0.04, 0.82, section);
      vLayer = aLayer * section;
      vec3 p = position;
      p.x += sin(p.y * 7.0 + uTime * .3) * .006 * aLayer;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = mix(.8, 2.6, section) * (7.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform vec3 uSignal;
    varying float vAlpha;
    varying float vLayer;
    void main() {
      float d = length(gl_PointCoord - .5);
      if (d > .5) discard;
      vec3 tissue = mix(vec3(.49, .53, .52), uSignal, vLayer * .82);
      gl_FragColor = vec4(tissue, vAlpha * smoothstep(.5, .1, d));
    }
  `
});

const volume = new THREE.Points(geometry, material);
scene.add(volume);

const ringMaterial = new THREE.MeshBasicMaterial({ color: '#79e0cf', transparent: true, opacity: .018, side: THREE.DoubleSide, depthWrite: false });
const sectionFrame = new THREE.Mesh(new THREE.PlaneGeometry(3.35, 4.65, 1, 1), ringMaterial);
sectionFrame.position.z = .001;
scene.add(sectionFrame);

bindRange('slice', (v) => { uniforms.uSlice.value = v; sectionFrame.position.z = v; }, (v) => `${v.toFixed(2)} Z`);
bindRange('width', (v) => { uniforms.uWidth.value = v; }, (v) => v.toFixed(2));
bindRange('rotation', (v) => { volume.userData.targetRotation = v * .58; sectionFrame.rotation.y = v * .12; }, (v) => `${Math.round(v * 30)}°`);

stage.start((time, pointer) => {
  uniforms.uTime.value = time;
  const target = volume.userData.targetRotation ?? 0;
  volume.rotation.y += (target + pointer.x * .1 - volume.rotation.y) * .035;
  camera.position.y += (pointer.y * .08 - camera.position.y) * .025;
  camera.lookAt(0, 0, 0);
});
