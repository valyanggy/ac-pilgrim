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
const pairScanSpeedInput = document.querySelector('#pairScanSpeed');
const pairScanLine = document.querySelector('.pair-scan-line');
const pairScanLibrary = document.querySelector('.pair-scan-library');
const pairLibraryImages = [...document.querySelectorAll('.pair-scan-library img')];
const pairInspectionMeta = [...document.querySelectorAll('.pair-inspection-meta')];
const pairMatchWindow = document.querySelector('.pair-match-window');
const finalFrameVideo = document.querySelector('#finalFrameVideo');
const finalFramePair = document.querySelector('#finalFramePair');
const sequenceStatus = document.querySelector('.sequence-status');
const sequenceStatusText = document.querySelector('#sequenceStatusText');
const detectionLog = document.querySelector('#liveDetectionLog');
const environmentReadout = document.querySelector('#environmentReadout');
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

pairScanSpeedInput?.addEventListener('input', () => {
  const value = Number(pairScanSpeedInput.value);
  document.querySelector('[data-pair-output="scanSpeed"]').textContent = `${value.toFixed(2)}×`;
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

const environmentHeader = document.querySelector('.figma-hud-data.environment-data > span');
const detectionHeader = document.querySelector('.figma-hud-data.detection > span');
const hudTypewriterEntries = [
  [detectionHeader, 'DETECTION LOG', 0],
  [environmentHeader, 'ENVIRONMENT', 90],
  [environmentReadout, 'TEMP  21.4°C   HUM  44%\n08:42:17', 180],
].filter(([element]) => element);

const detectionSamples = [
  ['PARTICULATE', 'CLEARED'],
  ['AEROSOL TRACE', '18.7%'],
  ['RHINOVIRUS', '23.5%'],
  ['INFLUENZA-A', '61.0%'],
  ['ADENOVIRUS', '42.1%'],
  ['SPORE CLUSTER', 'CLEARED'],
  ['BIOAEROSOL', '12.8%'],
  ['PROTEIN TRACE', 'CLEARED'],
];
let detectionEntries = [];
let detectionSampleIndex = 0;
let nextDetectionAt = 0;
let detectionTypingStartedAt = 0;

function detectionTimestamp(index) {
  const seconds = 8 * 3600 + 41 * 60 + 52 + index * 7;
  const hour = String(Math.floor(seconds / 3600) % 24).padStart(2, '0');
  const minute = String(Math.floor(seconds / 60) % 60).padStart(2, '0');
  const second = String(seconds % 60).padStart(2, '0');
  return `${hour}:${minute}:${second}`;
}

function resetDetectionLog(now) {
  detectionSampleIndex = 3;
  detectionEntries = detectionSamples.slice(0, 3).map((sample, index) => `${detectionTimestamp(index)}  ${sample[0]} | ${sample[1]}`);
  detectionTypingStartedAt = now;
  nextDetectionAt = now + 2400;
}

function highlightHudValues(text) {
  const escaped = text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return escaped.replace(/(?:\d{2}:\d{2}:\d{2}|\d+(?:\.\d+)?(?:%|°C|μ)?)/g, '<b>$&</b>');
}

function renderDetectionLog(now) {
  if (!detectionLog || !detectionEntries.length) return;
  if (now >= nextDetectionAt) {
    const sample = detectionSamples[detectionSampleIndex % detectionSamples.length];
    detectionEntries.push(`${detectionTimestamp(detectionSampleIndex)}  ${sample[0]} | ${sample[1]}`);
    detectionEntries = detectionEntries.slice(-3);
    detectionSampleIndex += 1;
    detectionTypingStartedAt = now;
    nextDetectionAt = now + 2400;
  }
  const newest = detectionEntries.at(-1);
  const reveal = Math.max(0, Math.min(newest.length, Math.floor((now - detectionTypingStartedAt) * .034)));
  detectionLog.innerHTML = highlightHudValues([...detectionEntries.slice(0, -1), newest.slice(0, reveal)].join('\n'));
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
let hudTypeStartedAt = -1;
let sequenceScrambleStartedAt = performance.now();
let sequenceScrambleBucket = -1;
let sequenceStatusTarget = 'ACTIVATING ARGUS';
let frameStartedAt = performance.now();
const sequenceStatusMessages = [
  'ACTIVATING ARGUS',
  'ACTIVATING ARGUS',
  'DETECTION IN PROGRESS',
  'DETECTION IN PROGRESS',
  'CHARACTERIZATION IN PROGRESS',
  'PATHOGEN CHARACTERIZED',
  'PATHOGEN CHARACTERIZED',
];

const shuffleGlyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
let pairMatchPath = [];

function preparePairMatchPath() {
  const selectedPair = Number(stage.dataset.selectedPair || 1);
  const matchingIndexes = pairLibraryImages
    .map((image, index) => Number(image.dataset.pair) === selectedPair ? index : -1)
    .filter(index => index >= 0);
  const targetIndex = matchingIndexes.at(-1) ?? pairLibraryImages.length - 1;
  const decoys = pairLibraryImages
    .map((image, index) => ({ index, pair: Number(image.dataset.pair) }))
    .filter(item => item.index !== targetIndex && item.pair !== selectedPair);
  for (let index = decoys.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [decoys[index], decoys[swapIndex]] = [decoys[swapIndex], decoys[index]];
  }
  pairMatchPath = [...decoys.slice(0, 2).map(item => item.index), targetIndex];
}

function updatePairInspection(elapsed, complete = false, matchDuration = 3000) {
  if (!pairMatchPath.length) preparePairMatchPath();
  const selectedIndex = pairMatchPath.at(-1) ?? pairLibraryImages.length - 1;
  const hopDuration = matchDuration / Math.max(1, pairMatchPath.length - 1);
  const totalDuration = matchDuration;
  const safeElapsed = Math.max(0, elapsed);
  const pathPosition = complete ? pairMatchPath.length - 1 : Math.min(pairMatchPath.length - 1, safeElapsed / hopDuration);
  const pathStart = Math.min(pairMatchPath.length - 1, Math.floor(pathPosition));
  const pathEnd = Math.min(pairMatchPath.length - 1, pathStart + 1);
  const hopProgress = smoothstep(pathPosition - pathStart);
  const startBounds = pairLibraryImages[pairMatchPath[pathStart]]?.getBoundingClientRect();
  const endBounds = pairLibraryImages[pairMatchPath[pathEnd]]?.getBoundingClientRect();
  const libraryBounds = pairScanLibrary?.getBoundingClientRect();
  const stageBounds = stage.getBoundingClientRect();
  const matched = complete || safeElapsed >= totalDuration;
  if (pairMatchWindow && startBounds && endBounds && libraryBounds) {
    const startCenter = startBounds.top + startBounds.height * .5;
    const endCenter = endBounds.top + endBounds.height * .5;
    const windowSize = Math.max(48, libraryBounds.width - 14);
    const top = startCenter + (endCenter - startCenter) * hopProgress - windowSize * .5 - stageBounds.top;
    pairMatchWindow.style.left = `${(libraryBounds.left + (libraryBounds.width - windowSize) * .5 - stageBounds.left).toFixed(2)}px`;
    pairMatchWindow.style.top = `${top.toFixed(2)}px`;
    pairMatchWindow.style.width = `${windowSize.toFixed(2)}px`;
    pairMatchWindow.style.height = `${windowSize.toFixed(2)}px`;
    pairMatchWindow.classList.toggle('is-matched', matched);
  }
  pairLibraryImages.forEach((image, index) => image.classList.toggle('active', index === selectedIndex && matched));
  pairInspectionMeta.forEach((element, index) => {
    const text = (element.dataset.typewriter || '').replace(/\\n/g, '\n');
    const count = complete ? text.length : Math.max(0, Math.min(text.length, Math.floor((elapsed - index * 130) * .035)));
    element.textContent = text.slice(0, count);
  });
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

function updatePairMetadataScramble(elapsed) {
  const reveal = smoothstep(elapsed / 950);
  const bucket = Math.floor(elapsed / 48);
  pairInspectionMeta.forEach((element, index) => {
    const text = (element.dataset.typewriter || '').replace(/\\n/g, '\n');
    element.textContent = shuffledText(text, reveal, bucket + index * 19 + 71);
  });
}

function updateHudTypewriter(now) {
  if (hudTypeStartedAt < 0) return;
  let complete = true;
  hudTypewriterEntries.forEach(([element, original, delay]) => {
    const revealed = Math.max(0, Math.min(original.length, Math.floor((now - hudTypeStartedAt - delay) * .055)));
    const visibleText = original.slice(0, revealed);
    if (element === environmentReadout) element.innerHTML = highlightHudValues(visibleText);
    else element.textContent = visibleText;
    if (revealed < original.length) complete = false;
  });
  if (complete) hudTypeStartedAt = -1;
}

function updateSequenceScramble(now) {
  if (!sequenceStatusText || sequenceScrambleStartedAt < 0) return;
  const elapsed = now - sequenceScrambleStartedAt;
  const bucket = Math.floor(elapsed / 44);
  if (bucket === sequenceScrambleBucket) return;
  sequenceScrambleBucket = bucket;
  const reveal = smoothstep(elapsed / 900);
  sequenceStatusText.textContent = shuffledText(sequenceStatusTarget, reveal, bucket + 31);
  if (reveal >= 1) {
    sequenceStatusText.textContent = sequenceStatusTarget;
    sequenceScrambleStartedAt = -1;
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
  const characterizationFrame = frame === 5;
  const characterizedFrame = frame === 6 || frame === 7;
  const pairFrame = characterizationFrame || characterizedFrame;
  // Frame 07 is the exact completed frame 06 composition with only the headline
  // added, so leave the last dither render frozen instead of continuing its noise.
  pathogenGlyphDither.setActive(pairFrame && frame !== 7);
  if (frame !== previousFrame) {
    frameStartedAt = now;
    if (frame === 4) {
      hudTypewriterEntries.forEach(([element]) => { element.textContent = '' });
      hudTypeStartedAt = now;
      resetDetectionLog(now + 500);
    }
    if (frame === 5) {
      pairMatchPath = [];
      preparePairMatchPath();
    }
    const nextSequenceStatusTarget = sequenceStatusMessages[frame - 1] || sequenceStatusMessages.at(-1);
    const sequenceStatusChanged = nextSequenceStatusTarget !== sequenceStatusTarget;
    sequenceStatusTarget = nextSequenceStatusTarget;
    if (frame === 7) {
      sequenceStatusText.textContent = sequenceStatusTarget;
      sequenceScrambleStartedAt = -1;
    } else if (sequenceStatusChanged) {
      sequenceScrambleStartedAt = now;
      sequenceScrambleBucket = -1;
    }
    previousFrame = frame;
  }
  if (sequenceStatus) sequenceStatus.dataset.frame = String(frame);
  updateSequenceScramble(now);
  updateHudTypewriter(now);
  if (frame === 4) renderDetectionLog(now);
  const visible = frame >= 1 && frame <= 7;
  const povActive = frame === 4 || characterizationFrame;
  const rawProgress = frame <= 2 ? Number(travelInput.value) : visible ? 1 : 0;
  const progress = smoothstep(rawProgress);
  const frameElapsed = now - frameStartedAt;
  const lockProgress = characterizationFrame ? smoothstep(frameElapsed / 1200) : characterizedFrame ? 1 : 0;
  const specimenIntroProgress = characterizationFrame ? smoothstep(frameElapsed / 850) : characterizedFrame ? 1 : 0;
  const sceneBlurProgress = characterizationFrame ? smoothstep(frameElapsed / 700) : characterizedFrame ? 1 : 0;
  const frame5HudOpacity = characterizationFrame ? 1 - smoothstep((frameElapsed - 200) / 700) : characterizedFrame ? 0 : 1;
  const frame5OverlayOpacity = characterizationFrame ? 1 - smoothstep(frameElapsed / 720) : characterizedFrame ? 0 : 1;
  const frame5BackdropProgress = characterizationFrame ? smoothstep((frameElapsed - 900) / 600) : characterizedFrame ? 1 : 0;
  const backgroundFade = pairFrame ? 1 - frame5BackdropProgress * .26 : 1;
  const pairContentProgress = characterizationFrame ? smoothstep(frameElapsed / 850) : characterizedFrame ? 1 : 0;
  const scanElapsed = frameElapsed;
  const pairScanSpeed = Math.max(.25, Number(pairScanSpeedInput?.value || 1.25));
  const pairScanDuration = 3750 / pairScanSpeed;
  const pairScanProgress = characterizedFrame
    ? 1
    : scanElapsed <= 0 ? 0 : Math.min(1, scanElapsed / pairScanDuration);

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
  stage.style.setProperty('--frame5-scene-blur', `${(sceneBlurProgress * 15).toFixed(2)}px`);
  stage.style.setProperty('--frame5-background-scale', (1.06 + lockProgress * .12).toFixed(4));
  stage.style.setProperty('--pair-backdrop-opacity', (pairContentProgress * .9).toFixed(4));
  stage.style.setProperty('--pair-scene-dim', (frame5BackdropProgress * .16).toFixed(4));
  stage.style.setProperty('--pair-content-opacity', pairContentProgress.toFixed(4));
  stage.style.setProperty('--pair-specimen-scale', (.88 + pairContentProgress * .12).toFixed(4));
  stage.style.setProperty('--pair-progress', `${(pairScanProgress * 100).toFixed(2)}%`);

  if (pairFrame) {
    const specimenScale = .95 + specimenIntroProgress * .05;
    pairScanImageA.style.transform = `scale(${specimenScale.toFixed(5)})`;
    pairScanImageA.style.filter = `blur(${((1 - specimenIntroProgress) * 15).toFixed(2)}px)`;
    pairScanImageA.style.opacity = '1';
    const scanPercent = pairScanProgress * 100;
    pairScanImageA.style.clipPath = `inset(${scanPercent.toFixed(3)}% 0 0 0)`;
    pairScanImageB.style.clipPath = `inset(0 0 ${(100 - scanPercent).toFixed(3)}% 0)`;
    pairScanLine.style.top = `${(20.111 + pairScanProgress * 59.334).toFixed(3)}%`;
    updatePairInspection(frameElapsed, characterizedFrame, 3000);
    if (frame === 6) updatePairMetadataScramble(frameElapsed);
  }

  video.style.opacity = visible ? String(progress * backgroundFade) : '0';
  video.style.filter = pairFrame
    ? `blur(${(sceneBlurProgress * 15).toFixed(2)}px) brightness(${(1 - sceneBlurProgress * .42).toFixed(3)})`
    : 'blur(0px) brightness(1)';
  const videoScale = 1 + progress * .16 + (pairFrame ? lockProgress * .06 : 0);
  const lockX = Number.parseFloat(stage.style.getPropertyValue('--lock-x')) || 50;
  const lockY = Number.parseFloat(stage.style.getPropertyValue('--lock-y')) || 50;
  const desiredCenterX = (50 - lockX) / 100 * stage.clientWidth * videoScale;
  const desiredCenterY = (50 - lockY) / 100 * stage.clientHeight * videoScale;
  const maxCameraX = stage.clientWidth * .04;
  const maxCameraY = stage.clientHeight * .03;
  const centerX = Math.max(-maxCameraX, Math.min(maxCameraX, desiredCenterX));
  const centerY = Math.max(-maxCameraY, Math.min(maxCameraY, desiredCenterY));
  const cameraX = pairFrame
    ? backgroundX * (1 - lockProgress * .65) + centerX * lockProgress
    : backgroundX;
  const cameraY = pairFrame
    ? backgroundY * (1 - lockProgress * .65) + centerY * lockProgress
    : backgroundY;
  video.style.transformOrigin = '50% 50%';
  video.style.transform = `translate3d(${cameraX.toFixed(2)}px, ${cameraY.toFixed(2)}px, 0) perspective(1200px) rotateY(${(povX * .9).toFixed(3)}deg) rotateX(${(-povY * .55).toFixed(3)}deg) scale(${videoScale.toFixed(4)})`;

  const shouldPlayVideo = frame >= 2 && (frame <= 4 || (characterizationFrame && frameElapsed < 1200));
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
