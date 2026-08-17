import { THREE, createStage, bindRange, seededRandom } from '../shared.js';

const canvas = document.querySelector('.webgl');
const stage = createStage(canvas, { camera: [0, .5, 10.5], fov: 44, fog: 0.035 });
const { scene, camera } = stage;
const random = seededRandom(71211);
const positions = [];
const kinds = [];
const seeds = [];

function add(x, y, z, kind = 0) { positions.push(x, y, z); kinds.push(kind); seeds.push(random()); }

// Concentric spatial shells suggest multiple semantic depths.
for (let layer = 0; layer < 7; layer++) {
  const z = -3.6 + layer * 1.2;
  for (let i = 0; i < 10500; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 1.3 + random() * 4.7;
    const x = Math.cos(angle) * radius;
    const y = -2.4 + random() * 5.4;
    const warp = Math.sin(angle * 3 + y * .8) * .22;
    add(x, y, z + warp, 0);
  }
}

// Capsule device.
for (let i = 0; i < 22000; i++) {
  const phi = random() * Math.PI * 2;
  const y = (random() - .5) * 2.2;
  const cap = Math.abs(y) > .72;
  const cy = cap ? Math.sign(y) * .72 : y;
  const rr = cap ? Math.sqrt(Math.max(0, 1 - ((Math.abs(y) - .72) / .42) ** 2)) : 1;
  add(Math.cos(phi) * .48 * rr, cy + (y - cy), 0.45 + Math.sin(phi) * .48 * rr, 1);
}

// Airborne signal particles curl toward the capsule intake.
for (let i = 0; i < 16000; i++) {
  const t = random();
  const angle = t * 11 + random() * 2;
  const radius = (1 - t) * 3 + .18;
  add(Math.cos(angle) * radius + (random() - .5) * .2, -1 + t * 2.8 + Math.sin(angle * .7) * .3, 2.8 - t * 2.3, 2);
}

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1));
geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));

const uniforms = {
  uFocus: { value: .4 },
  uFalloff: { value: 1.1 },
  uSignal: { value: .75 },
  uTime: { value: 0 },
  uColor: { value: new THREE.Color('#79e0cf') }
};

const material = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: `
    attribute float aKind;
    attribute float aSeed;
    uniform float uFocus;
    uniform float uFalloff;
    uniform float uSignal;
    uniform float uTime;
    varying float vAlpha;
    varying float vKind;
    void main() {
      vec3 p = position;
      if (aKind > 1.5) {
        p.x += sin(uTime * .6 + position.y * 2.0 + aSeed * 8.0) * .04;
        p.y += cos(uTime * .35 + aSeed * 11.0) * .035;
      }
      float focus = exp(-abs(p.z - uFocus) / uFalloff);
      float density = mix(.035, .9, focus);
      if (aKind > .5 && aKind < 1.5) density = .92;
      if (aKind > 1.5) density *= uSignal;
      float keep = step(aSeed, density);
      vAlpha = keep * mix(.025, .78, focus);
      if (aKind > .5) vAlpha = keep * mix(.16, .94, focus);
      vKind = aKind;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = mix(.7, aKind > .5 ? 2.7 : 1.8, focus) * (8.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    uniform vec3 uColor;
    varying float vAlpha;
    varying float vKind;
    void main() {
      float d = length(gl_PointCoord - .5);
      if (d > .5) discard;
      vec3 color = vKind > 1.5 ? uColor : (vKind > .5 ? vec3(.92) : vec3(.47, .52, .51));
      gl_FragColor = vec4(color, vAlpha * smoothstep(.5, .08, d));
    }
  `
});

const system = new THREE.Points(geometry, material);
scene.add(system);

bindRange('focus', (v) => { uniforms.uFocus.value = v; }, (v) => `${v.toFixed(2)} Z`);
bindRange('falloff', (v) => { uniforms.uFalloff.value = v; }, (v) => v.toFixed(2));
bindRange('signal', (v) => { uniforms.uSignal.value = v; }, (v) => `${Math.round(v * 100)}%`);

stage.start((time, pointer) => {
  uniforms.uTime.value = time;
  system.rotation.y += (pointer.x * .12 - system.rotation.y) * .025;
  system.rotation.x += (-.05 + pointer.y * .04 - system.rotation.x) * .025;
  camera.lookAt(0, .15, .2);
});
