import * as THREE from 'three';
import './styles.css';

export { THREE };

export function createStage(canvas, options = {}) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: options.antialias ?? true,
    alpha: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(options.pixelRatio ?? Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(options.background ?? 0x050707, 1);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(options.background ?? 0x050707, options.fog ?? 0.04);
  const camera = new THREE.PerspectiveCamera(options.fov ?? 42, 1, 0.01, 100);
  camera.position.fromArray(options.camera ?? [0, 0, 8]);
  const pointer = new THREE.Vector2();
  let raf = 0;
  let disposed = false;

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * renderer.getPixelRatio()) || canvas.height !== Math.round(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  window.addEventListener('pointermove', (event) => {
    pointer.x = event.clientX / window.innerWidth * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight * 2 - 1);
  }, { passive: true });

  function start(render) {
    const clock = new THREE.Clock();
    const minFrameInterval = options.maxFps ? 1000 / options.maxFps : 0;
    let lastFrameAt = -Infinity;
    const tick = () => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      if (now - lastFrameAt < minFrameInterval) return;
      lastFrameAt = now;
      resize();
      const shouldRenderScene = render(clock.getElapsedTime(), pointer) !== false;
      if (shouldRenderScene) renderer.render(scene, camera);
    };
    tick();
  }

  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    scene.traverse((object) => {
      object.geometry?.dispose?.();
      if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose());
      else object.material?.dispose?.();
    });
    renderer.dispose();
  }
  window.addEventListener('pagehide', dispose, { once: true });
  return { renderer, scene, camera, pointer, start, dispose };
}

export function bindRange(id, callback, format = (value) => value.toFixed(2)) {
  const input = document.getElementById(id);
  const output = document.querySelector(`[data-for="${id}"]`);
  const update = () => {
    const value = Number(input.value);
    output.textContent = format(value);
    callback(value);
  };
  input.addEventListener('input', update);
  update();
  return input;
}

export function seededRandom(seed = 123456) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
