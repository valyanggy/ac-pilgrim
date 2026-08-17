import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

function seededRandom(seed = 870821) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function triangleAreaSum(geometry) {
  const position = geometry.attributes.position;
  const index = geometry.index;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let area = 0;
  const triangleCount = index ? index.count / 3 : position.count / 3;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const ai = index ? index.getX(triangle * 3) : triangle * 3;
    const bi = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
    const ci = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
    a.fromBufferAttribute(position, ai);
    b.fromBufferAttribute(position, bi);
    c.fromBufferAttribute(position, ci);
    area += b.sub(a).cross(c.sub(a)).length() * .5;
  }
  return area;
}

function buildOrderedGeometry(root, spacing = .035) {
  root.updateMatrixWorld(true);
  const sampleRandom = seededRandom();
  const sources = [];
  let totalArea = 0;

  root.traverse((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    const localArea = triangleAreaSum(object.geometry);
    const scale = new THREE.Vector3();
    object.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    const worldArea = localArea * (Math.abs(scale.x * scale.y) + Math.abs(scale.y * scale.z) + Math.abs(scale.z * scale.x)) / 3;
    if (!Number.isFinite(worldArea) || worldArea <= 0) return;
    sources.push({
      mesh: object,
      sampler: new MeshSurfaceSampler(object).setRandomGenerator(sampleRandom).build(),
      area: worldArea,
    });
    totalArea += worldArea;
  });
  if (!sources.length) throw new Error('No sampleable mesh geometry found');

  const targetPoints = 360000;
  const rawPositions = new Float32Array(targetPoints * 3);
  const rawNormals = new Float32Array(targetPoints * 3);
  const localPosition = new THREE.Vector3();
  const localNormal = new THREE.Vector3();
  const worldPosition = new THREE.Vector3();
  const worldNormal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  let pointIndex = 0;

  sources.forEach((source, sourceIndex) => {
    const remaining = targetPoints - pointIndex;
    const count = sourceIndex === sources.length - 1
      ? remaining
      : Math.max(128, Math.round(targetPoints * source.area / totalArea));
    normalMatrix.getNormalMatrix(source.mesh.matrixWorld);
    for (let index = 0; index < Math.min(count, remaining); index += 1) {
      source.sampler.sample(localPosition, localNormal);
      worldPosition.copy(localPosition).applyMatrix4(source.mesh.matrixWorld);
      worldNormal.copy(localNormal).applyMatrix3(normalMatrix).normalize();
      const offset = pointIndex * 3;
      rawPositions[offset] = worldPosition.x;
      rawPositions[offset + 1] = worldPosition.y;
      rawPositions[offset + 2] = worldPosition.z;
      rawNormals[offset] = worldNormal.x;
      rawNormals[offset + 1] = worldNormal.y;
      rawNormals[offset + 2] = worldNormal.z;
      pointIndex += 1;
    }
  });

  const boundsGeometry = new THREE.BufferGeometry();
  boundsGeometry.setAttribute('position', new THREE.BufferAttribute(rawPositions.subarray(0, pointIndex * 3), 3));
  boundsGeometry.computeBoundingBox();
  const center = boundsGeometry.boundingBox.getCenter(new THREE.Vector3());
  const size = boundsGeometry.boundingBox.getSize(new THREE.Vector3());
  const fitScale = 5.2 / Math.max(size.x, size.y, size.z);
  const cells = new Map();

  for (let index = 0; index < pointIndex; index += 1) {
    const offset = index * 3;
    const x = (rawPositions[offset] - center.x) * fitScale;
    const y = (rawPositions[offset + 1] - center.y) * fitScale;
    const z = (rawPositions[offset + 2] - center.z) * fitScale;
    const gridX = Math.round(x / spacing);
    const gridY = Math.round(y / spacing);
    const gridZ = Math.round(z / spacing);
    const key = `${gridX}:${gridY}:${gridZ}`;
    const facing = Math.max(0, rawNormals[offset] * .28 + rawNormals[offset + 1] * .68 + rawNormals[offset + 2] * .42);
    const height = THREE.MathUtils.clamp(y / 5.2 + .5, 0, 1);
    const tone = THREE.MathUtils.clamp(.18 + facing * .55 + height * .27, 0, 1);
    const existing = cells.get(key);
    if (existing) existing.tone = Math.max(existing.tone, tone);
    else cells.set(key, { gridX, gridY, gridZ, tone });
  }
  boundsGeometry.dispose();

  const orderedCells = [...cells.values()].sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX || a.gridZ - b.gridZ);
  const positions = new Float32Array(orderedCells.length * 6);
  const tones = new Float32Array(orderedCells.length * 2);
  const seeds = new Float32Array(orderedCells.length * 2);

  orderedCells.forEach((cell, index) => {
    const primaryIndex = index * 2;
    const primaryOffset = primaryIndex * 3;
    positions[primaryOffset] = cell.gridX * spacing;
    positions[primaryOffset + 1] = cell.gridY * spacing;
    positions[primaryOffset + 2] = cell.gridZ * spacing;
    tones[primaryIndex] = cell.tone;
    const phase = Math.abs(cell.gridX + cell.gridY * 3 + cell.gridZ * 5) % 17;
    seeds[primaryIndex] = phase / 16;

    const secondaryIndex = primaryIndex + 1;
    const secondaryOffset = secondaryIndex * 3;
    const direction = Math.abs(cell.gridX * 3 + cell.gridY * 5 + cell.gridZ * 7) % 3;
    positions[secondaryOffset] = cell.gridX * spacing + (direction === 0 ? spacing * .42 : 0);
    positions[secondaryOffset + 1] = cell.gridY * spacing + (direction === 1 ? spacing * .42 : 0);
    positions[secondaryOffset + 2] = cell.gridZ * spacing + (direction === 2 ? spacing * .42 : 0);
    tones[secondaryIndex] = cell.tone * .92;
    seeds[secondaryIndex] = 1 + (phase + 1) / 17;
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aTone', new THREE.BufferAttribute(tones, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildDepthGeometry(image, step = 3) {
  const sampleCanvas = document.createElement('canvas');
  const scale = Math.min(1, 1440 / Math.max(image.naturalWidth, image.naturalHeight));
  sampleCanvas.width = Math.round(image.naturalWidth * scale);
  sampleCanvas.height = Math.round(image.naturalHeight * scale);
  const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, sampleCanvas.width, sampleCanvas.height);
  const pixels = context.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
  const positions = [];
  const luminance = [];
  const edges = [];
  const seeds = [];
  const random = seededRandom(336925);
  const worldWidth = 18.3;
  const worldHeight = worldWidth * sampleCanvas.height / sampleCanvas.width;

  const luminanceAt = (x, y) => {
    const px = Math.max(0, Math.min(sampleCanvas.width - 1, x));
    const py = Math.max(0, Math.min(sampleCanvas.height - 1, y));
    const offset = (py * sampleCanvas.width + px) * 4;
    return (pixels[offset] * .2126 + pixels[offset + 1] * .7152 + pixels[offset + 2] * .0722) / 255;
  };

  for (let y = 0; y < sampleCanvas.height; y += step) {
    for (let x = 0; x < sampleCanvas.width; x += step) {
      const lum = luminanceAt(x, y);
      const edge = Math.min(1,
        Math.abs(lum - luminanceAt(x + step, y))
        + Math.abs(lum - luminanceAt(x, y + step))
      );
      const keepChance = Math.min(1, .2 + lum * .74 + edge * 4.2);
      if (random() > keepChance) continue;
      positions.push(
        (x / sampleCanvas.width - .5) * worldWidth,
        (.5 - y / sampleCanvas.height) * worldHeight,
        0,
      );
      luminance.push(lum);
      edges.push(edge);
      seeds.push(random());
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aLum', new THREE.Float32BufferAttribute(luminance, 1));
  geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edges, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  return geometry;
}

export function initHeroMeshCut({ canvas, onComplete, onTravel, onDepthReveal }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(39, 1, .01, 100);
  const cameraDirection = new THREE.Vector3(0, .25, 11.7).normalize();
  camera.position.copy(cameraDirection).multiplyScalar(11.7);

  const uniforms = {
    uSlice: { value: 1.8 },
    uWidth: { value: .56 },
    uPointSize: { value: 3.5 },
    uDensity: { value: 1.04 },
    uOpacity: { value: 0 },
    uSignal: { value: new THREE.Color('#509dce') },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aTone;
      attribute float aSeed;
      uniform float uSlice;
      uniform float uWidth;
      uniform float uPointSize;
      varying float vFocus;
      varying float vTone;
      varying float vSeed;
      void main() {
        vFocus = 1.0 - smoothstep(0.0, uWidth, abs(position.z - uSlice));
        vTone = aTone;
        vSeed = aSeed;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float perspective = clamp(9.5 / max(1.0, -mv.z), .7, 2.6);
        gl_PointSize = mix(uPointSize, uPointSize * 2.35, pow(vFocus, 1.2)) * perspective;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uDensity;
      uniform float uOpacity;
      uniform vec3 uSignal;
      varying float vFocus;
      varying float vTone;
      varying float vSeed;
      void main() {
        if (vSeed > uDensity) discard;
        float distanceToCenter = length(gl_PointCoord - .5);
        if (distanceToCenter > .5) discard;
        float edge = 1.0 - smoothstep(.28, .5, distanceToCenter);
        vec3 inactive = mix(uSignal * .38, uSignal, smoothstep(.06, .9, vTone));
        vec3 color = mix(inactive, vec3(.99), pow(vFocus, 1.18));
        float alpha = mix(.36 + vTone * .48, 1.0, vFocus) * edge;
        gl_FragColor = vec4(color, alpha * uOpacity);
      }
    `,
  });

  const depthControls = {
    scanTiming: 0,
    scanSpeed: 1,
    farPoints: .65,
    imageGap: 28,
    density: .27,
    color: '#003758',
    width: .039,
    depth: 6.5,
  };
  const depthUniforms = {
    uSlice: { value: .9 },
    uWidth: { value: depthControls.width },
    uFeather: { value: .16 },
    uDepthGain: { value: 2.55 },
    uDepth: { value: depthControls.depth },
    uFocusMix: { value: 1 },
    uOpacity: { value: 0 },
    uFarVisibility: { value: depthControls.farPoints },
    uDensity: { value: 1 },
    uPointOpacity: { value: depthControls.density },
    uSignal: { value: new THREE.Color(depthControls.color) },
  };
  const depthMaterial = new THREE.ShaderMaterial({
    uniforms: depthUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: `
      attribute float aLum;
      attribute float aEdge;
      attribute float aSeed;
      uniform float uSlice;
      uniform float uWidth;
      uniform float uFeather;
      uniform float uDepthGain;
      uniform float uDepth;
      uniform float uFarVisibility;
      varying float vFocus;
      varying float vAlpha;
      varying float vLum;
      varying float vSeed;
      void main() {
        vec3 p = position;
        p.z = (aLum - .12) * uDepth + (aSeed - .5) * .1;
        float scanLum = min(1.0, aLum * uDepthGain);
        vFocus = 1.0 - smoothstep(uWidth, uWidth + uFeather, abs(scanLum - uSlice));
        vLum = scanLum;
        vSeed = aSeed;
        float farGain = mix(.32, 1.35, uFarVisibility);
        vAlpha = (.18 + aLum * .54 + min(aEdge * 1.8, .3)) * farGain;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = mix(1.2 + aLum * 1.1 + min(aEdge * 2.4, .8), 9.0, vFocus) * (10.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uOpacity;
      uniform float uDensity;
      uniform float uPointOpacity;
      uniform vec3 uSignal;
      varying float vFocus;
      varying float vAlpha;
      varying float vLum;
      varying float vSeed;
      void main() {
        if (vSeed > uDensity) discard;
        float distanceToCenter = length(gl_PointCoord - .5);
        if (distanceToCenter > .5) discard;
        float edge = 1.0 - smoothstep(.28, .5, distanceToCenter);
        vec3 inactive = uSignal * mix(.5, 1.35, smoothstep(.06, .78, vLum));
        vec3 activeScan = mix(min(vec3(1.0), uSignal * 5.2), vec3(.12, .82, 1.0), .72);
        vec3 color = mix(inactive * .72, activeScan, pow(vFocus, .9));
        float scanStrength = mix(uPointOpacity, 1.0, pow(vFocus, .8));
        gl_FragColor = vec4(color, mix(vAlpha, 1.0, vFocus) * edge * uOpacity * scanStrength);
      }
    `,
  });

  let cloud = null;
  let depthCloud = null;
  let active = false;
  let running = false;
  let pendingPlay = false;
  let mode = 'hidden';
  let startedAt = 0;
  let pausedAt = 0;
  let completed = false;
  let currentTravel = 0;
  const sequenceDuration = 3500;
  const depthSequenceDuration = 2600;
  const isVideoStoryboard = document.querySelector('.video-storyboard') !== null;
  const handoffCameraDistance = isVideoStoryboard ? 3.45 : 5.575;
  const pointerTarget = new THREE.Vector2();
  const pointerCurrent = new THREE.Vector2();

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function fitDepthCloudToViewport() {
    if (!depthCloud) return;
    const distance = Math.abs(camera.position.z - depthCloud.position.z);
    const viewportHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * .5)) * distance;
    const viewportWidth = viewportHeight * camera.aspect;
    const imageWidth = 18.3;
    const imageHeight = imageWidth * depthImage.naturalHeight / depthImage.naturalWidth;
    const coverScale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
    const zoomScale = 1 + currentTravel * .22;
    depthCloud.scale.set(coverScale * zoomScale, coverScale * zoomScale, 1);
  }

  function begin() {
    if (!cloud) { pendingPlay = true; return; }
    pendingPlay = false;
    running = true;
    active = true;
    mode = 'scan';
    completed = false;
    pausedAt = 0;
    startedAt = performance.now() + 250;
    uniforms.uSlice.value = 1.8;
    uniforms.uOpacity.value = 1;
    depthUniforms.uOpacity.value = 0;
    depthUniforms.uSlice.value = .9;
    currentTravel = 0;
    onDepthReveal?.(0);
    if (depthCloud) depthCloud.position.z = -depthControls.imageGap;
    onTravel?.(0);
    camera.position.copy(cameraDirection).multiplyScalar(11.7);
  }

  function smoothRange(value, start, end) {
    return THREE.MathUtils.smootherstep(value, start, end);
  }

  function applyDepthTravel(progress, transitioning = false, cameraProgress = transitioning ? progress : 1, sharedScan = progress) {
    currentTravel = THREE.MathUtils.clamp(progress, 0, 1);
    const sliceProgress = THREE.MathUtils.clamp(
      sharedScan * depthControls.scanSpeed + depthControls.scanTiming * .045,
      0,
      1,
    );
    if (depthCloud) {
      depthCloud.position.z = THREE.MathUtils.lerp(
        -depthControls.imageGap,
        -depthControls.imageGap * .64,
        currentTravel,
      );
      fitDepthCloudToViewport();
    }
    depthUniforms.uSlice.value = THREE.MathUtils.lerp(.9, .55, sliceProgress);
    if (transitioning) {
      depthUniforms.uOpacity.value = THREE.MathUtils.smoothstep(currentTravel, .03, .58);
      onDepthReveal?.(THREE.MathUtils.smoothstep(currentTravel, .02, .72));
    }
    if (cameraProgress !== null) {
      camera.position.copy(cameraDirection).multiplyScalar(transitioning
        ? THREE.MathUtils.lerp(handoffCameraDistance, 1.2, THREE.MathUtils.clamp(cameraProgress, 0, 1))
        : 1.2);
    }
    onTravel?.(currentTravel);
  }

  function beginDepth() {
    active = true;
    running = true;
    pendingPlay = false;
    pausedAt = 0;
    mode = 'depth-scan';
    startedAt = performance.now();
    uniforms.uOpacity.value = 0;
    depthUniforms.uOpacity.value = 0;
    depthUniforms.uSlice.value = 1.15;
    currentTravel = 0;
    if (depthCloud) depthCloud.position.z = -depthControls.imageGap;
    onTravel?.(0);
    onDepthReveal?.(0);
    camera.position.copy(cameraDirection).multiplyScalar(handoffCameraDistance);
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (!active) return;
    resize();
    pointerCurrent.lerp(pointerTarget, .055);
    if (cloud && (mode === 'idle' || mode === 'scan')) {
      cloud.rotation.y += (pointerCurrent.x * .09 - cloud.rotation.y) * .06;
      cloud.rotation.x += (-pointerCurrent.y * .045 - cloud.rotation.x) * .06;
    }
    if (running && mode === 'scan') {
      const elapsed = now - startedAt;
      if (elapsed >= 0) {
        const master = THREE.MathUtils.clamp(elapsed / sequenceDuration, 0, 1);
        const sharedScan = master;
        const modelFade = 1 - smoothRange(master, isVideoStoryboard ? .9 : .78, 1);

        uniforms.uSlice.value = THREE.MathUtils.lerp(1.8, -1.95, sharedScan);
        uniforms.uOpacity.value = modelFade;
        depthUniforms.uOpacity.value = 0;
        onDepthReveal?.(0);
        camera.position.copy(cameraDirection).multiplyScalar(THREE.MathUtils.lerp(11.7, handoffCameraDistance, master));

        if (master >= 1) {
          running = false;
          mode = 'handoff';
          if (!completed) {
            completed = true;
            onComplete?.();
          }
        }
      }
    }
    if (running && mode === 'depth-scan') {
      const master = THREE.MathUtils.clamp((now - startedAt) / depthSequenceDuration, 0, 1);
      uniforms.uOpacity.value = 0;
      applyDepthTravel(master, true, master, master);
      if (master >= 1) {
        running = false;
        mode = 'depth';
        depthUniforms.uOpacity.value = 1;
        onDepthReveal?.(1);
      }
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(tick);

  window.addEventListener('pointermove', (event) => {
    pointerTarget.set(
      event.clientX / Math.max(1, window.innerWidth) * 2 - 1,
      event.clientY / Math.max(1, window.innerHeight) * 2 - 1,
    );
  }, { passive: true });

  new GLTFLoader().load('/assets/pilgrim-rugged-server.glb', (gltf) => {
    try {
      cloud = new THREE.Points(buildOrderedGeometry(gltf.scene), material);
      scene.add(cloud);
      if (pendingPlay && active) begin();
      else if (mode === 'idle') uniforms.uOpacity.value = 1;
    } catch (error) {
      console.error('Hero mesh cut failed', error);
    }
  }, undefined, (error) => console.error('Hero mesh model failed', error));

  const depthImage = new Image();
  depthImage.onload = () => {
    try {
      depthCloud = new THREE.Points(buildDepthGeometry(depthImage), depthMaterial);
      depthCloud.position.z = -depthControls.imageGap;
      scene.add(depthCloud);
      if (mode === 'depth') {
        depthUniforms.uOpacity.value = 1;
        applyDepthTravel(currentTravel);
      }
    } catch (error) {
      console.error('Hero depth field failed', error);
    }
  };
  depthImage.onerror = (error) => console.error('Hero depth image failed', error);
  depthImage.src = '/assets/hero-home-pilgrim.png';

  return {
    play() {
      active = true;
      begin();
    },
    showIdle() {
      active = true;
      running = false;
      pendingPlay = false;
      pausedAt = 0;
      completed = false;
      mode = 'idle';
      uniforms.uSlice.value = 1.8;
      uniforms.uOpacity.value = 1;
      depthUniforms.uOpacity.value = 0;
      onDepthReveal?.(0);
      currentTravel = 0;
      onTravel?.(0);
      camera.position.copy(cameraDirection).multiplyScalar(11.7);
    },
    showDepth() {
      active = true;
      running = false;
      pendingPlay = false;
      pausedAt = 0;
      mode = 'depth';
      uniforms.uOpacity.value = 0;
      depthUniforms.uOpacity.value = 1;
      onDepthReveal?.(1);
      applyDepthTravel(1);
    },
    playDepth() {
      beginDepth();
    },
    pause() {
      if (!active) return;
      if (!cloud) {
        pendingPlay = false;
        pausedAt = performance.now();
        return;
      }
      if (!running || pausedAt) return;
      pausedAt = performance.now();
      running = false;
    },
    resume() {
      active = true;
      if (!cloud) {
        pendingPlay = true;
        pausedAt = 0;
        return;
      }
      if (!pausedAt) {
        if (mode === 'depth' || mode === 'depth-scan') beginDepth();
        else begin();
        return;
      }
      startedAt += performance.now() - pausedAt;
      pausedAt = 0;
      running = true;
    },
    deactivate() {
      active = false;
      running = false;
      pausedAt = 0;
      pendingPlay = false;
      mode = 'hidden';
      uniforms.uOpacity.value = 0;
      depthUniforms.uOpacity.value = 0;
      onDepthReveal?.(0);
    },
    setDepthTravel(value) {
      if (mode === 'depth') applyDepthTravel(value);
    },
    setDepthControls(next) {
      Object.assign(depthControls, next);
      depthUniforms.uWidth.value = depthControls.width;
      depthUniforms.uDepth.value = depthControls.depth;
      depthUniforms.uFarVisibility.value = depthControls.farPoints;
      depthUniforms.uPointOpacity.value = depthControls.density;
      depthUniforms.uSignal.value.set(depthControls.color);
      if (mode === 'depth') applyDepthTravel(currentTravel);
    },
  };
}
