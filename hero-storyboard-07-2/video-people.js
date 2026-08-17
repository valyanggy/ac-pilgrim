import { initPathogenGlyphDither } from './pathogen-glyph-dither.js';

const video = document.querySelector('#videoPeopleSource');
const stage = document.querySelector('#heroStage');
const travelInput = document.querySelector('#depthTravel');
const figmaHud = document.querySelector('.figma-hud');
const pairScanImageA = document.querySelector('.pair-scan-image-a');
const pairScanImageB = document.querySelector('.pair-scan-image-b');
const pairScanRealisticSource = document.querySelector('.pair-scan-realistic-source');
const pairScanSpecimen = document.querySelector('.pair-scan-specimen');
const pairScanGuiToggle = document.querySelector('#pairScanGuiToggle');
const pairScanLine = document.querySelector('.pair-scan-line');
const pairDetectedCard = document.querySelector('.pair-detected-card');
const pairDetectedImage = document.querySelector('[data-detected-image]');
const pairLibraryImages = [...document.querySelectorAll('.pair-scan-library img')];
const finalFrameVideo = document.querySelector('#finalFrameVideo');
const finalFramePair = document.querySelector('#finalFramePair');
const pathogenGlyphDither = initPathogenGlyphDither({
  canvas: pairScanImageB,
  source: pairScanRealisticSource,
});

pairScanGuiToggle?.addEventListener('click', () => {
  const hidden = stage.classList.toggle('is-pair-gui-hidden');
  pairScanGuiToggle.textContent = hidden ? 'Show GUI' : 'Hide GUI';
  pairScanGuiToggle.setAttribute('aria-expanded', String(!hidden));
});

[
  ['pairGlyphCell', 'cell', value => `${value.toFixed(0)} PX`],
  ['pairGlyphDensity', 'density', value => `${Math.round(value * 100)}%`],
  ['pairGlyphThreshold', 'threshold', value => value.toFixed(2)],
  ['pairGlyphContrast', 'contrast', value => `${value.toFixed(2)}×`],
  ['pairNoiseAmount', 'noiseAmount', value => `${Math.round(value * 100)}%`],
  ['pairNoiseRate', 'noiseRate', value => `${value.toFixed(0)} HZ`],
  ['pairNoiseRange', 'glyphRange', value => value.toFixed(0)],
].forEach(([id, key, format]) => {
  const input = document.querySelector(`#${id}`);
  input?.addEventListener('input', () => {
    const value = Number(input.value);
    document.querySelector(`[data-pair-output="${key}"]`).textContent = format(value);
    pathogenGlyphDither.setOptions({ [key]: value });
  });
});

const pairGlyphColorInputs = [...document.querySelectorAll('.pair-glyph-color')];
pairGlyphColorInputs.forEach(input => {
  input.addEventListener('input', () => {
    input.nextElementSibling.textContent = input.value.toUpperCase();
    pathogenGlyphDither.setOptions({ colors: pairGlyphColorInputs.map(colorInput => colorInput.value) });
  });
});

function captureFinalFrame() {
  video.pause();
  if (!finalFrameVideo || !finalFramePair || !video.videoWidth || !video.videoHeight) return;

  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  finalFrameVideo.width = Math.round(width * dpr);
  finalFrameVideo.height = Math.round(height * dpr);
  const context = finalFrameVideo.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  const coverScale = Math.max(width / video.videoWidth, height / video.videoHeight);
  const drawWidth = video.videoWidth * coverScale;
  const drawHeight = video.videoHeight * coverScale;
  context.drawImage(video, (width - drawWidth) * .5, (height - drawHeight) * .5, drawWidth, drawHeight);

  const sourceScene = document.querySelector('.pair-scan-scene');
  const frozenScene = sourceScene?.cloneNode(true);
  finalFramePair.replaceChildren();
  [
    '--pair-content-opacity',
    '--pair-backdrop-opacity',
    '--pair-scene-dim',
    '--pair-specimen-scale',
    '--pair-progress',
  ].forEach(property => {
    const value = stage.style.getPropertyValue(property);
    if (value) finalFramePair.style.setProperty(property, value);
  });
  if (!frozenScene) return;
  frozenScene.classList.add('final-pair-scan');
  finalFramePair.appendChild(frozenScene);
  const frozenCanvas = frozenScene.querySelector('.pair-scan-image-b');
  if (frozenCanvas && pairScanImageB.width && pairScanImageB.height) {
    frozenCanvas.width = pairScanImageB.width;
    frozenCanvas.height = pairScanImageB.height;
    frozenCanvas.getContext('2d').drawImage(pairScanImageB, 0, 0);
  }
}

stage.addEventListener('storyboard:prepare-final', captureFinalFrame);

const hudTextNodes = [];
if (figmaHud) {
  const walker = document.createTreeWalker(figmaHud, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue.trim()) hudTextNodes.push({ node, original: node.nodeValue });
    node = walker.nextNode();
  }
}

function smoothstep(value) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

let wasVisible = false;
let animationFrame = 0;
let povTargetX = 0;
let povTargetY = 0;
let povX = 0;
let povY = 0;
let previousFrame = 1;
let hudShuffleStartedAt = -1;
let hudShuffleBucket = -1;
let frameStartedAt = performance.now();

const shuffleGlyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const matchStepDurations = [1800, 1800, 1800, 3000];
const matchCycleDuration = matchStepDurations.reduce((total, duration) => total + duration, 0);

function updateMatchingWindow(elapsed) {
  if (elapsed < 0) return;
  let cycleTime = elapsed % matchCycleDuration;
  let step = 0;
  while (cycleTime >= matchStepDurations[step] && step < matchStepDurations.length - 1) {
    cycleTime -= matchStepDurations[step];
    step += 1;
  }

  const selectedIndex = Math.max(0, Math.min(pairLibraryImages.length - 1, Number(stage.dataset.selectedPair || 1) - 1));
  const decoys = pairLibraryImages.map((_, index) => index).filter(index => index !== selectedIndex);
  const matchPath = [decoys[0], decoys[1], decoys[2], selectedIndex];
  const libraryIndex = matchPath[step];
  const matched = step === matchPath.length - 1;
  pairLibraryImages.forEach((image, index) => image.classList.toggle('active', index === libraryIndex));
  const candidateBounds = pairLibraryImages[libraryIndex]?.getBoundingClientRect();
  const stageBounds = stage.getBoundingClientRect();
  if (candidateBounds) {
    pairDetectedCard.style.left = `${(candidateBounds.left + candidateBounds.width * .5 - stageBounds.left).toFixed(2)}px`;
    pairDetectedCard.style.top = `${(candidateBounds.top + candidateBounds.height * .5 - stageBounds.top).toFixed(2)}px`;
  }
  pairDetectedCard.classList.toggle('is-matched', matched);
  const nextSource = matched
    ? pairDetectedImage.dataset.matchSrc
    : pairLibraryImages[libraryIndex]?.src;
  if (nextSource && pairDetectedImage.src !== nextSource) pairDetectedImage.src = nextSource;
}

function shuffledText(original, reveal, seed) {
  let visibleIndex = 0;
  const visibleCount = [...original].filter(char => /[A-Z0-9]/i.test(char)).length;
  return [...original].map((char, index) => {
    if (!/[A-Z0-9]/i.test(char)) return char;
    const threshold = visibleCount > 1 ? visibleIndex++ / (visibleCount - 1) : 0;
    if (threshold <= reveal) return char;
    const glyphIndex = Math.abs((seed * 17 + index * 13 + char.charCodeAt(0)) % shuffleGlyphs.length);
    return shuffleGlyphs[glyphIndex];
  }).join('');
}

function updateHudShuffle(now) {
  if (hudShuffleStartedAt < 0) return;
  const elapsed = now - hudShuffleStartedAt;
  const bucket = Math.floor(elapsed / 48);
  if (bucket === hudShuffleBucket) return;
  hudShuffleBucket = bucket;

  let complete = true;
  hudTextNodes.forEach((entry, index) => {
    const delay = index * 18;
    const localProgress = Math.max(0, Math.min(1, (elapsed - delay) / (2000 - delay)));
    const reveal = localProgress * localProgress * (3 - 2 * localProgress);
    entry.node.nodeValue = shuffledText(entry.original, reveal, bucket + index * 7);
    if (localProgress < 1) complete = false;
  });

  if (complete) {
    hudTextNodes.forEach(entry => { entry.node.nodeValue = entry.original; });
    hudShuffleStartedAt = -1;
  }
}

stage.addEventListener('pointermove', event => {
  const bounds = stage.getBoundingClientRect();
  povTargetX = ((event.clientX - bounds.left) / bounds.width - .5) * 2;
  povTargetY = ((event.clientY - bounds.top) / bounds.height - .5) * 2;
});

stage.addEventListener('pointerleave', () => {
  povTargetX = 0;
  povTargetY = 0;
});

function render() {
  animationFrame = requestAnimationFrame(render);
  const now = performance.now();
  const frame = Number(stage.dataset.frame || 1);
  pathogenGlyphDither.setActive(frame === 5);
  if (frame !== previousFrame) {
    frameStartedAt = now;
    if (frame === 4) {
      hudShuffleStartedAt = now;
      hudShuffleBucket = -1;
    }
    previousFrame = frame;
  }
  updateHudShuffle(now);
  const visible = frame >= 2 && frame <= 5;
  const povActive = frame === 4 || frame === 5;
  const rawProgress = frame === 2 ? Number(travelInput.value) : visible ? 1 : 0;
  const progress = smoothstep(rawProgress);
  const frameElapsed = now - frameStartedAt;
  const lockProgress = frame === 5 ? smoothstep(frameElapsed / 1200) : 0;
  const frame5HudOpacity = frame === 5 ? 1 - smoothstep((frameElapsed - 200) / 700) : 1;
  const frame5OverlayOpacity = frame === 5 ? 1 - smoothstep(frameElapsed / 720) : 1;
  const frame5BackdropProgress = frame === 5 ? smoothstep((frameElapsed - 900) / 600) : 0;
  const backgroundFade = frame === 5 ? 1 - frame5BackdropProgress * .26 : 1;
  const pairContentProgress = frame === 5 ? smoothstep((frameElapsed - 1100) / 700) : 0;
  const scanElapsed = frameElapsed - 1850;
  const scanPhase = scanElapsed > 0 ? (scanElapsed % 3200) / 3200 : 0;
  const pairScanProgress = scanElapsed <= 0
    ? 1
    : scanPhase <= .5 ? 1 - scanPhase * 2 : (scanPhase - .5) * 2;

  if (!povActive) {
    povTargetX = 0;
    povTargetY = 0;
  }
  povX += (povTargetX - povX) * .065;
  povY += (povTargetY - povY) * .065;

  const backgroundX = -povX * 24;
  const backgroundY = -povY * 15;
  const particleX = -povX * 38;
  const particleY = -povY * 23;
  stage.style.setProperty('--pov-background-x', `${backgroundX.toFixed(2)}px`);
  stage.style.setProperty('--pov-background-y', `${backgroundY.toFixed(2)}px`);
  stage.style.setProperty('--pov-particle-x', `${particleX.toFixed(2)}px`);
  stage.style.setProperty('--pov-particle-y', `${particleY.toFixed(2)}px`);
  stage.style.setProperty('--frame5-hud-opacity', frame5HudOpacity.toFixed(4));
  stage.style.setProperty('--frame5-background-opacity', backgroundFade.toFixed(4));
  stage.style.setProperty('--frame5-overlay-opacity', frame5OverlayOpacity.toFixed(4));
  stage.style.setProperty('--frame5-background-scale', (1.06 + lockProgress * .12).toFixed(4));
  stage.style.setProperty('--pair-backdrop-opacity', (pairContentProgress * .9).toFixed(4));
  stage.style.setProperty('--pair-scene-dim', (frame5BackdropProgress * .16).toFixed(4));
  stage.style.setProperty('--pair-content-opacity', pairContentProgress.toFixed(4));
  stage.style.setProperty('--pair-specimen-scale', (.88 + pairContentProgress * .12).toFixed(4));
  stage.style.setProperty('--pair-progress', `${(pairScanProgress * 100).toFixed(2)}%`);

  if (frame === 5) {
    const lockX = Number.parseFloat(stage.style.getPropertyValue('--lock-x')) || 50;
    const lockY = Number.parseFloat(stage.style.getPropertyValue('--lock-y')) || 50;
    const specimenBounds = pairScanSpecimen.getBoundingClientRect();
    const stageBounds = stage.getBoundingClientRect();
    const targetX = ((specimenBounds.left + specimenBounds.width * .5 - stageBounds.left) / stageBounds.width) * 100;
    const targetY = ((specimenBounds.top + specimenBounds.height * .5 - stageBounds.top) / stageBounds.height) * 100;
    const startSize = Number.parseFloat(stage.style.getPropertyValue('--lock-flight-size')) || 84;
    const targetSize = Math.min(specimenBounds.width, specimenBounds.height);
    const startScale = startSize / targetSize;
    const deltaX = ((lockX - targetX) / 100) * stageBounds.width;
    const deltaY = ((lockY - targetY) / 100) * stageBounds.height;
    const remaining = 1 - lockProgress;
    const currentScale = startScale + (1 - startScale) * lockProgress;
    pairScanImageA.style.transform = `translate3d(${(deltaX * remaining).toFixed(2)}px, ${(deltaY * remaining).toFixed(2)}px, 0) scale(${currentScale.toFixed(5)})`;
    const scanPercent = pairScanProgress * 100;
    pairScanImageA.style.clipPath = `inset(0 0 ${(100 - scanPercent).toFixed(3)}% 0)`;
    pairScanImageB.style.clipPath = `inset(${scanPercent.toFixed(3)}% 0 0 0)`;
    pairScanLine.style.top = `${(20.111 + pairScanProgress * 59.334).toFixed(3)}%`;
    updateMatchingWindow(frameElapsed - 1450);
  }

  video.style.opacity = visible ? String(progress * backgroundFade) : '0';
  video.style.filter = frame === 5
    ? `blur(${(frame5BackdropProgress * 5).toFixed(2)}px) brightness(${(1 - frame5BackdropProgress * .3).toFixed(3)})`
    : 'blur(0px) brightness(1)';
  const videoScale = 1 + progress * .16 + (frame === 5 ? lockProgress * .06 : 0);
  const lockX = Number.parseFloat(stage.style.getPropertyValue('--lock-x')) || 50;
  const lockY = Number.parseFloat(stage.style.getPropertyValue('--lock-y')) || 50;
  const desiredCenterX = (50 - lockX) / 100 * stage.clientWidth * videoScale;
  const desiredCenterY = (50 - lockY) / 100 * stage.clientHeight * videoScale;
  const maxCameraX = stage.clientWidth * .04;
  const maxCameraY = stage.clientHeight * .03;
  const centerX = Math.max(-maxCameraX, Math.min(maxCameraX, desiredCenterX));
  const centerY = Math.max(-maxCameraY, Math.min(maxCameraY, desiredCenterY));
  const cameraX = frame === 5
    ? backgroundX * (1 - lockProgress * .65) + centerX * lockProgress
    : backgroundX;
  const cameraY = frame === 5
    ? backgroundY * (1 - lockProgress * .65) + centerY * lockProgress
    : backgroundY;
  video.style.transformOrigin = '50% 50%';
  video.style.transform = `translate3d(${cameraX.toFixed(2)}px, ${cameraY.toFixed(2)}px, 0) perspective(1200px) rotateY(${(povX * .9).toFixed(3)}deg) rotateX(${(-povY * .55).toFixed(3)}deg) scale(${videoScale.toFixed(4)})`;

  const shouldPlayVideo = frame >= 2 && (frame <= 4 || (frame === 5 && frameElapsed < 1200));
  if (shouldPlayVideo && video.paused) video.play().catch(() => {});
  if (!shouldPlayVideo && !video.paused) video.pause();
  wasVisible = visible;
}

video.currentTime = 0;
animationFrame = requestAnimationFrame(render);

window.addEventListener('pagehide', () => {
  cancelAnimationFrame(animationFrame);
  video.pause();
  pathogenGlyphDither.destroy?.();
}, { once: true });
