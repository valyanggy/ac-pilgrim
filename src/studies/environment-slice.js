import { THREE, createStage, bindRange, seededRandom } from '../shared.js';

const canvas = document.querySelector('.webgl');
const stage = createStage(canvas, { camera: [0, 0.2, 10.8], fov: 45, fog: 0 });
const { scene, camera } = stage;
const random = seededRandom(90210);
const positions = [];
const seeds = [];

function point(x, y, z, seed = random()) {
  positions.push(x, y, z);
  seeds.push(seed);
}

function plane(count, sampler) {
  for (let i = 0; i < count; i++) point(...sampler(random(), random()));
}

// Architectural envelope: floor, back wall, ceiling ribs and side planes.
plane(36000, (a, b) => [(a - .5) * 12, -2.7 + random() * .035, -5.6 + b * 10.2]);
plane(19000, (a, b) => [(a - .5) * 12, -2.7 + b * 6.5, -5.6 + random() * .04]);
plane(9500, (a, b) => [-6 + random() * .04, -2.7 + a * 6.5, -5.6 + b * 10.2]);
plane(9500, (a, b) => [6 + random() * .04, -2.7 + a * 6.5, -5.6 + b * 10.2]);

for (let r = 0; r < 9; r++) {
  const z = -5.3 + r * 1.15;
  plane(1000, (a, b) => [(a - .5) * 12, 3.45 + random() * .03, z + (b - .5) * .045]);
}

// Simple human-like volumes positioned at different depths.
function addFigure(cx, cz, scale, lean = 0) {
  for (let i = 0; i < 7200; i++) {
    const y = -2.55 + random() * 3.6 * scale;
    const t = (y + 2.55) / (3.6 * scale);
    let rx = .32 * scale;
    let rz = .2 * scale;
    if (t > .78) { rx = .29 * scale; rz = .28 * scale; }
    else if (t > .35) { rx = (.48 - .2 * t) * scale; rz = .24 * scale; }
    else { rx = (.16 + .13 * t) * scale; rz = .14 * scale; }
    const theta = random() * Math.PI * 2;
    const radius = Math.sqrt(random());
    point(cx + Math.cos(theta) * rx * radius + lean * t, y, cz + Math.sin(theta) * rz * radius);
  }
}

addFigure(-3.5, -2.8, .88, .15);
addFigure(-1.4, .1, 1.04, -.08);
addFigure(1.6, -3.8, .82, .12);
addFigure(3.7, 1.5, 1.12, -.15);
addFigure(.1, 3.2, .72, 0);

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));

const uniforms = {
  uSlice: { value: .1 },
  uWidth: { value: .9 },
  uDensity: { value: .78 },
  uTime: { value: 0 },
  uSignal: { value: new THREE.Color('#79e0cf') }
};

const material = new THREE.ShaderMaterial({
  uniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: `
    attribute float aSeed;
    uniform float uSlice;
    uniform float uWidth;
    uniform float uDensity;
    varying float vAlpha;
    varying float vFocus;
    void main() {
      float distToSlice = abs(position.z - uSlice);
      vFocus = 1.0 - smoothstep(0.0, uWidth, distToSlice);
      vAlpha = mix(0.72, mix(0.9, 1.0, uDensity), vFocus);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = mix(1.55, 2.9, vFocus) * (8.5 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform vec3 uSignal;
    varying float vAlpha;
    varying float vFocus;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      vec3 base = mix(uSignal, vec3(0.98, 0.99, 0.97), pow(vFocus, 1.35));
      gl_FragColor = vec4(base, vAlpha * smoothstep(0.5, 0.08, d));
    }
  `
});

const cloud = new THREE.Points(geometry, material);
cloud.rotation.x = -.045;
scene.add(cloud);

const slicePlane = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 6.5),
  new THREE.MeshBasicMaterial({ color: '#79e0cf', transparent: true, opacity: .018, side: THREE.DoubleSide, depthWrite: false })
);
slicePlane.position.z = uniforms.uSlice.value;
scene.add(slicePlane);

bindRange('slice', (v) => { uniforms.uSlice.value = v; slicePlane.position.z = v; }, (v) => `${v.toFixed(2)} Z`);
bindRange('width', (v) => { uniforms.uWidth.value = v; }, (v) => v.toFixed(2));
bindRange('density', (v) => { uniforms.uDensity.value = v; }, (v) => `${Math.round(v * 100)}%`);

stage.start((time, pointer) => {
  uniforms.uTime.value = time;
  camera.position.x += (pointer.x * .55 - camera.position.x) * .025;
  camera.position.y += (.2 + pointer.y * .3 - camera.position.y) * .025;
  camera.lookAt(0, -.1, -1.2);
});
