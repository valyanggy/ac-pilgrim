import { THREE, createStage, bindRange } from '../shared.js';

const canvas = document.querySelector('.webgl');
const stage = createStage(canvas, { camera: [0, 0, 2], fov: 45, fog: 0 });
const { scene, camera, renderer } = stage;
scene.fog = null;

const uniforms = {
  uTime: { value: 0 },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uPointer: { value: new THREE.Vector2() },
  uSlice: { value: .05 },
  uThreshold: { value: .43 },
  uFlow: { value: .55 },
  uSignal: { value: new THREE.Color('#79e0cf') }
};

const material = new THREE.ShaderMaterial({
  uniforms,
  depthTest: false,
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
  `,
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform vec2 uPointer;
    uniform float uSlice;
    uniform float uThreshold;
    uniform float uFlow;
    uniform vec3 uSignal;

    float hash(vec3 p) {
      p = fract(p * .1031); p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z);
    }
    float noise(vec3 p) {
      vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    float bayer(vec2 p) {
      vec2 q = mod(floor(p), 4.0);
      return fract((q.x * 2.0 + q.y * 3.0 + mod(q.x + q.y, 2.0) * 5.0) / 16.0);
    }
    float field(vec3 p) {
      float head = 1.0 - length(p / vec3(.72, .9, .58));
      float cloud = noise(p * 3.0 + vec3(0.0, uTime * .08 * uFlow, uTime * .12 * uFlow));
      float curl = noise(p * 7.0 + vec3(uTime * .14 * uFlow, 0.0, 0.0));
      return head * .82 + cloud * .32 + curl * .12;
    }
    void main() {
      vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution.xy) / min(uResolution.x, uResolution.y);
      uv.x -= uPointer.x * .06;
      uv.y -= uPointer.y * .04;
      vec3 ro = vec3(0.0, 0.0, 2.5);
      vec3 rd = normalize(vec3(uv, -1.75));
      float acc = 0.0;
      float section = 0.0;
      float depth = 0.0;
      for (int i = 0; i < 54; i++) {
        float t = float(i) * .065;
        vec3 p = ro + rd * t;
        float d = field(p);
        float local = smoothstep(uThreshold, uThreshold + .18, d);
        acc += local * .027;
        float sliceBand = 1.0 - smoothstep(.015, .09, abs(p.z - uSlice));
        section += local * sliceBand * .12;
        depth += local * t * .002;
      }
      float density = clamp(acc + section, 0.0, 1.0);
      float pattern = bayer(gl_FragCoord.xy);
      float dotMask = step(pattern, density);
      float grid = step(.56, fract(gl_FragCoord.x * .5)) * step(.56, fract(gl_FragCoord.y * .5));
      dotMask *= grid;
      vec3 neutral = vec3(.58, .61, .6);
      vec3 color = mix(neutral, uSignal, clamp(section * 2.2, 0.0, 1.0));
      float scanLine = 1.0 - smoothstep(.0, .012, abs(uv.x - uSlice * .48));
      color += uSignal * scanLine * .18;
      float vignette = smoothstep(1.65, .25, length(uv));
      gl_FragColor = vec4(color * (dotMask * vignette + scanLine * .08), 1.0);
    }
  `
});

const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
scene.add(quad);
camera.position.z = 1;

bindRange('slice', (v) => { uniforms.uSlice.value = v; }, (v) => `${v.toFixed(2)} Z`);
bindRange('threshold', (v) => { uniforms.uThreshold.value = v; }, (v) => v.toFixed(2));
bindRange('flow', (v) => { uniforms.uFlow.value = v; }, (v) => `${Math.round(v * 100)}%`);

stage.start((time, pointer) => {
  uniforms.uTime.value = time;
  uniforms.uPointer.value.lerp(pointer, .035);
  renderer.getDrawingBufferSize(uniforms.uResolution.value);
});
