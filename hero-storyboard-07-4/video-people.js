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
const pairLibraryItems = [...document.querySelectorAll('.pair-library-item')];
const pairLibraryImages = [...document.querySelectorAll('.pair-scan-library img')];
const pairInspectionMeta = [...document.querySelectorAll('.pair-inspection-meta')];
const finalFrameVideo = document.querySelector('#finalFrameVideo');
const finalFramePair = document.querySelector('#finalFramePair');
const sequenceStatus = document.querySelector('.sequence-status');
const sequenceStatusText = document.querySelector('#sequenceStatusText');
const detectionLog = document.querySelector('#liveDetectionLog');
const environmentReadout = document.querySelector('#environmentReadout');
const skipSequence = document.querySelector('#skipSequence');

const perspectivePathogens = [...document.querySelectorAll('.pathogen')];

// Treat the HUD target center as the vanishing point, but let the authored
// pathogen positions act as staggered spawn points across the screen. Each
// visible fly-by advances a modest distance outward along that perspective ray.
function updatePerspectiveFlightPaths() {
  const stageBounds = stage.getBoundingClientRect();
  const targetBounds = document.querySelector('.figma-hud-target')?.getBoundingClientRect();
  if (!stageBounds.width || !stageBounds.height || !targetBounds) return;

  const vanishX = targetBounds.left - stageBounds.left + targetBounds.width * .5;
  const vanishY = targetBounds.top - stageBounds.top + targetBounds.height * .5;

  perspectivePathogens.forEach((pathogen, index) => {
    const bounds = pathogen.getBoundingClientRect();
    const isPrimary = pathogen.classList.contains('is-primary');
    const anchorX = bounds.left - stageBounds.left + bounds.width * .5;
    const anchorY = bounds.top - stageBounds.top + bounds.height * .5;
    let dx = anchorX - vanishX;
    let dy = anchorY - vanishY;
    let magnitude = Math.hypot(dx, dy);

    // The primary pathogen begins exactly on the vanishing point, so give it
    // a stable ray rather than allowing a zero-length trajectory.
    if (magnitude < 18) {
      const angle = -.58 + index * 2.399963;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      magnitude = 1;
    }

    const unitX = dx / magnitude;
    const unitY = dy / magnitude;
    const travel = isPrimary ? 6 : 60 + (index % 4) * 10;
    const radialOffset = isPrimary ? 0 : ((index * 37) % 41) - 20;
    const startX = anchorX + unitX * radialOffset;
    const startY = anchorY + unitY * radialOffset;
    const endX = startX + unitX * travel;
    const endY = startY + unitY * travel;
    const curve = isPrimary
      ? 0
      : (index % 2 ? -1 : 1) * Math.min(24, travel * (.065 + (index % 3) * .008));
    const normalX = -unitY;
    const normalY = unitX;
    const control1X = startX + unitX * travel * .32 + normalX * curve;
    const control1Y = startY + unitY * travel * .32 + normalY * curve;
    const control2X = startX + unitX * travel * .72 - normalX * curve * .35;
    const control2Y = startY + unitY * travel * .72 - normalY * curve * .35;
    const local = value => value.toFixed(1);
    const path = [
      `M ${local(startX - anchorX)} ${local(startY - anchorY)}`,
      `C ${local(control1X - anchorX)} ${local(control1Y - anchorY)},`,
      `${local(control2X - anchorX)} ${local(control2Y - anchorY)},`,
      `${local(endX - anchorX)} ${local(endY - anchorY)}`,
    ].join(' ');
    const duration = 2.4 + (index % 4) * .1;
    const delay = -((index * .37) % duration);
    pathogen.style.setProperty('--firefly-path', `path("${path}")`);
    pathogen.style.setProperty('--firefly-duration', `${duration.toFixed(2)}s`);
    pathogen.style.setProperty('--firefly-delay', `${delay.toFixed(2)}s`);
  });
}

const pathogenGlyphDither = initPathogenGlyphDither({
  canvas: pairScanImageB,
  source: pairScanRealisticSource,
});

skipSequence?.addEventListener('click', () => {
  // Preserve the final-frame capture even when the intermediate sequence is
  // bypassed, then use the existing timeline control to update app state.
  stage.dispatchEvent(new CustomEvent('storyboard:prepare-final'));
  document.querySelector('.timeline [role="tab"]:last-child')?.click();
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
  [detectionHeader, 'SYSTEM LOG', 0],
  [environmentHeader, 'ENVIRONMENT', 160],
  [environmentReadout, 'TEMP  21.4°C   HUM  44%\n08:42:17', 260],
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

function scanEase(value) {
  const x = Math.max(0, Math.min(1, value));
  const sample = (a, b, t) => {
    const c = 3 * a;
    const d = 3 * (b - a) - c;
    const e = 1 - c - d;
    return ((e * t + d) * t + c) * t;
  };
  let low = 0;
  let high = 1;
  let t = x;
  for (let iteration = 0; iteration < 14; iteration += 1) {
    t = (low + high) * .5;
    if (sample(.85, .15, t) < x) low = t;
    else high = t;
  }
  return sample(0, 1, t);
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
  'DETECTION IN PROGRESS',
  'DETECTION IN PROGRESS',
  'CHARACTERIZATION IN PROGRESS',
  'PATHOGEN CHARACTERIZED',
  'PATHOGEN CHARACTERIZED',
];
const depthSequenceSpeed = Math.max(.4, Number(document.querySelector('#depthScanSpeed')?.value || 1));
const sequenceFrameDurations = [
  3500 / depthSequenceSpeed,
  2600 / depthSequenceSpeed + 900,
  Number(stage.dataset.acquisitionDuration || 6500),
  Number(stage.dataset.pairScanDuration || 11000),
  1750,
  5000,
];
sequenceStatus?.style.setProperty(
  '--sequence-columns',
  sequenceFrameDurations.map(duration => `${duration.toFixed(2)}fr`).join(' '),
);

const shuffleGlyphs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
let pairProbeItems = [];
let pairMatchItem = null;
const pairProbeCount = 9;
const pairDetectionDuration = 1500;
const pairScanDuration = 3200;
const pairMatchPhaseStart = pairDetectionDuration + pairScanDuration;
const pairProbeBaseDelay = pairMatchPhaseStart - 550;
// Two measured checks establish the search rhythm. The remaining false
// candidates accelerate progressively before a clean pause and slow lock-on.
const pairProbeOffsets = [0, 420, 800, 1140, 1430, 1670, 1860, 2010, 2110];
const pairProbeDurations = [680, 650, 600, 540, 470, 400, 340, 290, 240];
const pairFinalSettlePause = 50;
let pairMatchAt = 1100;
const pairMatchRevealDuration = 2600;

function preparePairMatchPath() {
  const selectedPair = Number(stage.dataset.selectedPair || 1);
  pairMatchItem = pairLibraryItems.find(item => Number(item.dataset.pair) === selectedPair)
    || pairLibraryItems.find(item => item.dataset.pair);
  const falseItems = pairLibraryItems.filter(item => item !== pairMatchItem);
  for (let index = falseItems.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [falseItems[index], falseItems[swapIndex]] = [falseItems[swapIndex], falseItems[index]];
  }
  pairProbeItems = falseItems.slice(0, pairProbeCount);
  pairLibraryItems.forEach(item => {
    item.classList.remove('is-probing', 'is-match-pending', 'is-match');
    item.style.removeProperty('--probe-delay');
    item.style.removeProperty('--probe-duration');
    item.style.removeProperty('--match-delay');
  });
  void stage.offsetWidth;
  pairProbeItems.forEach((item, index) => {
    const delay = pairProbeBaseDelay + pairProbeOffsets[index];
    item.style.setProperty('--probe-delay', `${delay}ms`);
    item.style.setProperty('--probe-duration', `${pairProbeDurations[index]}ms`);
    item.classList.add('is-probing');
  });
  // The correct cell arrives after the accelerating run has had time to breathe;
  // that final blue probe then resolves slowly to red.
  const lastProbeOffset = pairProbeOffsets[Math.max(0, pairProbeItems.length - 1)] || 0;
  pairMatchAt = pairProbeBaseDelay + lastProbeOffset + pairFinalSettlePause;
  if (pairMatchItem) {
    pairMatchItem.style.setProperty('--match-delay', `${pairMatchAt}ms`);
    pairMatchItem.classList.add('is-match-pending');
  }
}

function updatePairInspection(elapsed, complete = false) {
  if (!pairProbeItems.length || !pairMatchItem) preparePairMatchPath();
  const matched = complete || elapsed >= pairMatchAt + pairMatchRevealDuration;
  if (matched && pairMatchItem) {
    pairMatchItem.classList.remove('is-match-pending');
    pairMatchItem.classList.add('is-match');
  }
  pairLibraryImages.forEach(image => image.classList.toggle('active', matched && image.parentElement === pairMatchItem));
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
  stage.style.setProperty('--scan-pointer-x', `${(event.clientX - bounds.left).toFixed(2)}px`);
  stage.style.setProperty('--scan-pointer-y', `${(event.clientY - bounds.top).toFixed(2)}px`);
});

stage.addEventListener('pointerleave', () => {
  povTargetX = 0;
  povTargetY = 0;
});

function render() {
  animationFrame = requestAnimationFrame(render);
  const now = performance.now();
  const frame = Number(stage.dataset.frame || 1);
  const characterizationFrame = frame === 4;
  const characterizedFrame = frame === 5 || frame === 6;
  const pairFrame = characterizationFrame || characterizedFrame;
  // Frame 05 captures the final frame 04 glyph render; frame 06 carries that
  // secured composition forward without restarting the noise.
  pathogenGlyphDither.setActive(characterizationFrame);
  if (frame !== previousFrame) {
    frameStartedAt = now;
    if (frame === 1) video.currentTime = 0;
    if (frame === 2) {
      document.querySelectorAll('.pathogen').forEach(el => {
        el.style.animation = 'none';
        void el.offsetWidth;
        el.style.animation = '';
      });
    }
    if (frame === 3) {
      updatePerspectiveFlightPaths();
      hudTypewriterEntries.forEach(([element]) => { element.textContent = '' });
      // Frame 02 has already completed the HUD wake-up. Frame 03 reveals the
      // full pathogen field first, then brings in the information panels.
      hudTypeStartedAt = now + 760;
      resetDetectionLog(now + 760);
    }
    if (frame === 4) {
      pairProbeItems = [];
      pairMatchItem = null;
      preparePairMatchPath();
    }
    const nextSequenceStatusTarget = sequenceStatusMessages[frame - 1] || sequenceStatusMessages.at(-1);
    const sequenceStatusChanged = nextSequenceStatusTarget !== sequenceStatusTarget;
    sequenceStatusTarget = nextSequenceStatusTarget;
    if (frame === 6) {
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
  if (frame === 2 || frame === 3) renderDetectionLog(now);
  const visible = frame >= 1 && frame <= 6;
  const povActive = frame === 3 || characterizationFrame;
  const rawProgress = frame <= 2 ? Number(travelInput.value) : visible ? 1 : 0;
  const progress = smoothstep(rawProgress);
  const frameElapsed = now - frameStartedAt;
  const sequenceDuration = sequenceFrameDurations[frame - 1] || 1;
  const sequenceProgress = frame === 1
    ? Math.max(0, Math.min(1, Number(stage.style.getPropertyValue('--mesh-sequence-progress')) || 0))
    : Math.max(0, Math.min(1, frameElapsed / sequenceDuration));
  const sequenceConfirmProgress = Math.max(0, Math.min(1,
    (pairMatchAt + pairMatchRevealDuration) / sequenceFrameDurations[3]
  ));
  const sequenceRedProgress = frame > 4
    ? 1
    : frame === 4
      ? Math.max(0, Math.min(1,
          (sequenceProgress - sequenceConfirmProgress) / Math.max(.001, 1 - sequenceConfirmProgress)
        ))
      : 0;
  sequenceStatus?.style.setProperty('--sequence-progress', sequenceProgress.toFixed(4));
  sequenceStatus?.style.setProperty('--sequence-confirm-offset', `${(sequenceConfirmProgress * 100).toFixed(2)}%`);
  sequenceStatus?.style.setProperty('--sequence-red-progress', sequenceRedProgress.toFixed(4));
  const lockProgress = characterizationFrame ? smoothstep(frameElapsed / 1200) : characterizedFrame ? 1 : 0;
  const specimenIntroProgress = characterizationFrame ? smoothstep(frameElapsed / 850) : characterizedFrame ? 1 : 0;
  const sceneBlurProgress = characterizationFrame ? smoothstep(frameElapsed / 700) : characterizedFrame ? 1 : 0;
  const frame5HudOpacity = characterizationFrame ? 1 - smoothstep((frameElapsed - 200) / 700) : characterizedFrame ? 0 : 1;
  const frame5OverlayOpacity = characterizationFrame ? 1 - smoothstep(frameElapsed / 720) : characterizedFrame ? 0 : 1;
  const frame5BackdropProgress = characterizationFrame ? smoothstep((frameElapsed - 900) / 600) : characterizedFrame ? 1 : 0;
  const backgroundFade = pairFrame ? 1 - frame5BackdropProgress * .26 : 1;
  const pairSceneDim = characterizationFrame
    ? .52 - smoothstep(frameElapsed / 800) * .36
    : characterizedFrame ? .16 : 0;
  const pairContentProgress = characterizationFrame ? smoothstep(frameElapsed / 850) : characterizedFrame ? 1 : 0;
  const scanElapsed = frameElapsed;
  const pairScanDelay = pairDetectionDuration;
  const pairScanRawProgress = characterizedFrame
    ? 1
    : scanElapsed <= pairScanDelay ? 0 : Math.min(1, (scanElapsed - pairScanDelay) / pairScanDuration);
  const pairScanProgress = characterizedFrame
    ? 1
    : scanEase(pairScanRawProgress);

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
  stage.style.setProperty('--pair-scene-dim', pairSceneDim.toFixed(4));
  stage.style.setProperty('--pair-content-opacity', pairContentProgress.toFixed(4));
  stage.style.setProperty('--pair-specimen-scale', (.88 + pairContentProgress * .12).toFixed(4));
  stage.style.setProperty('--pair-progress', `${(pairScanProgress * 100).toFixed(2)}%`);
  const pairConfirmed = characterizedFrame
    || (characterizationFrame && frameElapsed >= pairMatchAt + pairMatchRevealDuration);
  stage.style.setProperty('--pair-meta-color', pairConfirmed ? '#de1705' : '#ffffff');
  stage.classList.toggle('is-pair-confirmed', pairConfirmed);

  if (pairFrame) {
    const specimenScale = .95 + specimenIntroProgress * .05;
    pairScanImageA.style.transform = `scale(${specimenScale.toFixed(5)})`;
    pairScanImageA.style.filter = `blur(${((1 - specimenIntroProgress) * 15).toFixed(2)}px)`;
    pairScanImageA.style.opacity = '1';
    const scanPercent = pairScanProgress * 100;
    pairScanImageA.style.clipPath = `inset(${scanPercent.toFixed(3)}% 0 0 0)`;
    pairScanImageB.style.clipPath = `inset(0 0 ${(100 - scanPercent).toFixed(3)}% 0)`;
    const scanTravel = pairScanSpecimen.clientHeight * pairScanProgress;
    pairScanLine.style.transform = `translate3d(0, ${scanTravel.toFixed(2)}px, 0)`;
    const scanLineOpacity = characterizedFrame || pairScanRawProgress <= 0
      ? 0
      : pairScanProgress < .08
        ? smoothstep(pairScanProgress / .08)
        : pairScanProgress <= .9
          ? 1
          : 1 - smoothstep((pairScanProgress - .9) / .1);
    pairScanLine.style.opacity = (scanLineOpacity * pairContentProgress).toFixed(4);
    updatePairInspection(frameElapsed, characterizedFrame);
    if (frame === 5) updatePairMetadataScramble(frameElapsed);
  }

  video.style.opacity = visible ? String(progress * backgroundFade) : '0';
  video.style.filter = pairFrame
    ? `blur(${(sceneBlurProgress * 15).toFixed(2)}px) brightness(${(1 - sceneBlurProgress * .42).toFixed(3)})`
    : 'blur(0px) brightness(1)';
  // Fade and camera push share one continuous 01→02 progress value, so the
  // crowd starts moving the instant it becomes visible and never restarts.
  const entranceZoom = frame <= 2 ? progress : 1;
  const videoScale = 1 + entranceZoom * .16 + (pairFrame ? lockProgress * .06 : 0);
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

  // Play as soon as travel starts revealing the plate (during 01 scan handoff),
  // so 02 lands on live motion instead of a still that then starts.
  const shouldPlayVideo = (frame === 1 && progress > .02)
    || (frame >= 2 && frame <= 3)
    || (characterizationFrame && frameElapsed < 1200);
  if (shouldPlayVideo && video.paused) video.play().catch(() => {});
  if (!shouldPlayVideo && !video.paused) video.pause();
  wasVisible = visible;
}

video.currentTime = 0;
animationFrame = requestAnimationFrame(render);

let perspectiveResizeFrame = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(perspectiveResizeFrame);
  perspectiveResizeFrame = requestAnimationFrame(() => {
    if (Number(stage.dataset.frame) === 3) updatePerspectiveFlightPaths();
  });
});

window.addEventListener('pagehide', () => {
  cancelAnimationFrame(animationFrame);
  cancelAnimationFrame(perspectiveResizeFrame);
  video.pause();
  pathogenGlyphDither.destroy?.();
}, { once: true });
