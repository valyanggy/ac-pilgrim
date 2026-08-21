import { initHeroMeshCut } from './mesh-cut.js';

const stage = document.querySelector('#heroStage');
const canvas = document.querySelector('#sceneCanvas');
const ctx = canvas.getContext('2d');
const timeline = document.querySelector('#timeline');
const playButton = document.querySelector('#playButton');
const stageNext = document.querySelector('#stageNext');
const frameNumber = document.querySelector('#frameNumber');
const systemState = document.querySelector('#systemState');
const pathogenLayer = document.querySelector('#pathogenLayer');
const matchReadout = document.querySelector('#matchReadout');
const analysisTitle = document.querySelector('#analysisTitle');
const depthTravelInput = document.querySelector('#depthTravel');
const depthGuiToggle = document.querySelector('#depthGuiToggle');
const focusThreatImage = document.querySelector('#focusThreatImage');
const isVideoStoryboard = document.querySelector('.video-storyboard') !== null;
const isFeedbackStoryboard = document.querySelector('.feedback-storyboard') !== null;
const usesIdleAutoFocus = stage.dataset.idleAutoFocus === 'true';

const originalFrames = [
  { title: 'ARGUS SCAN', state: 'POINT MODEL / ACTIVE', duration: 7000 },
  { title: 'OPTICAL FIELD', state: 'OPTICAL FIELD / ACTIVE', duration: 3800 },
  { title: 'AIRBORNE SIGNALS', state: 'PARTICLE LAYER / VISIBLE', duration: 3000 },
  { title: 'TARGET ACQUISITION', state: 'HOVER TO ISOLATE', duration: 5000 },
  { title: 'SAMPLE ISOLATED', state: 'TARGET / LOCKED', duration: 2200 },
  { title: 'DATABASE MATCH', state: 'MATCH ENGINE / ACTIVE', duration: 3400 },
  { title: 'THREAT FOUND', state: 'CLASSIFICATION / MALICIOUS', duration: 2700 },
  { title: 'NETWORK', state: 'GLOBAL NETWORK / ACTIVE', duration: 2800 },
  { title: 'RESOLVE', state: 'SYSTEM / CONTINUOUS', duration: 5000 },
];

const frames = isFeedbackStoryboard
  ? [
      originalFrames[0],
      // 02 merges former optical field + airborne signals: video emerges with pathogens.
      { ...originalFrames[1], state: 'PARTICLE LAYER / VISIBLE', duration: Number(stage.dataset.opticalDuration || 3800) },
      { ...originalFrames[3], duration: Number(stage.dataset.acquisitionDuration || 3500) },
      { title: 'PAIR SCAN', state: 'CHARACTERIZATION IN PROGRESS', duration: Number(stage.dataset.pairScanDuration || 5300) },
      { title: 'CHARACTERIZED', state: 'PATHOGEN CHARACTERIZED', duration: 1750 },
      { title: 'RESOLVE', state: 'PATHOGEN CHARACTERIZED', duration: 5000 },
    ]
  : isVideoStoryboard
  ? [
      originalFrames[0],
      originalFrames[1],
      originalFrames[2],
      originalFrames[3],
      { title: 'PAIR SCAN', state: 'STYLE BOUNDARY / ACTIVE', duration: 9000 },
      { title: 'RESOLVE', state: 'EARLY SIGNAL / GLOBAL RESPONSE', duration: 5000 },
    ]
  : originalFrames;

// Feedback 07-3 drops the old standalone airborne beat, so later beats shift down one.
const acquisitionFrame = isFeedbackStoryboard ? 3 : 4;
const pairScanFrame = isFeedbackStoryboard ? 4 : 5;

let frame = 1;
let playing = false;
let hasStarted = false;
let playTimer;
let playDeadline = 0;
let remainingDelay = null;
let autoFocusTimer = null;
let lastPointerX = Number.NaN;
let lastPointerY = Number.NaN;
let lastIntentionalPointerMoveAt = Number.NEGATIVE_INFINITY;
let raf;
let startTime = performance.now();
const hudInitiationDuration = Number(stage.dataset.autoFocusDelay || 2000);
// Autoplay always resolves pair-scan to centered pair 1; manual click can pick another.
let preferPrimaryOnPairScan = true;

stage.addEventListener('pointermove', event => {
  const moved = Number.isFinite(lastPointerX)
    ? Math.hypot(event.clientX - lastPointerX, event.clientY - lastPointerY) > 1
    : Math.hypot(event.movementX || 0, event.movementY || 0) > 1;
  if (moved) {
    lastIntentionalPointerMoveAt = performance.now();
  }
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
}, { capture: true, passive: true });

function holdAcquisitionForHover() {
  if (!usesIdleAutoFocus || !playing || frame !== acquisitionFrame) return;
  clearTimeout(autoFocusTimer);
  autoFocusTimer = null;
  clearTimeout(playTimer);
  playTimer = null;
  remainingDelay = null;
}

function restartAcquisitionIdleWindow() {
  if (!usesIdleAutoFocus || !playing || frame !== acquisitionFrame) return;
  schedulePrimaryAutoFocus(hudInitiationDuration);
  scheduleNext(getFrameDuration(acquisitionFrame));
}

const heroMeshCut = initHeroMeshCut({
  canvas: document.querySelector('#heroMeshCanvas'),
  onDepthReveal: (value) => {
    stage.style.setProperty('--airport-reveal', value.toFixed(4));
  },
  onScanProgress: (value) => {
    stage.style.setProperty('--mesh-sequence-progress', value.toFixed(4));
  },
  onComplete: () => {
    if (frame === 1 && playing) setFrame(2);
  },
  onTravel: (value) => {
    depthTravelInput.value = String(value);
    document.querySelector('[data-depth-output="travel"]').textContent = `${Math.round(value * 100)}%`;
    stage.style.setProperty('--airport-scale', (1 + value * .22).toFixed(4));
  },
});

const depthControlBindings = [
  ['depthScanTiming', 'scanTiming', value => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`],
  ['depthScanSpeed', 'scanSpeed', value => `${value.toFixed(2)}×`],
  ['depthFarPoints', 'farPoints', value => `${Math.round(value * 100)}%`],
  ['depthImageGap', 'imageGap', value => `${value.toFixed(1)} Z`],
  ['depthDensity', 'density', value => `${Math.round(value * 100)}%`],
  ['depthWidth', 'width', value => value.toFixed(3)],
  ['depthAmount', 'depth', value => `${value.toFixed(1)}×`],
];

depthControlBindings.forEach(([id, key, format]) => {
  const input = document.querySelector(`#${id}`);
  heroMeshCut.setDepthControls({ [key]: Number(input.value) });
  input.addEventListener('input', () => {
    const value = Number(input.value);
    document.querySelector(`[data-depth-output="${key}"]`).textContent = format(value);
    heroMeshCut.setDepthControls({ [key]: value });
  });
});

document.querySelector('#depthColor').addEventListener('input', event => {
  const color = event.currentTarget.value;
  document.querySelector('[data-depth-output="color"]').textContent = color.toUpperCase();
  heroMeshCut.setDepthControls({ color });
});
heroMeshCut.setDepthControls({ color: document.querySelector('#depthColor').value });

depthTravelInput.addEventListener('input', () => {
  const value = Number(depthTravelInput.value);
  document.querySelector('[data-depth-output="travel"]').textContent = `${Math.round(value * 100)}%`;
  heroMeshCut.setDepthTravel(value);
});

depthGuiToggle.addEventListener('click', () => {
  const hidden = stage.classList.toggle('is-depth-gui-hidden');
  depthGuiToggle.textContent = hidden ? 'Show GUI' : 'Hide GUI';
  depthGuiToggle.setAttribute('aria-expanded', String(!hidden));
});

const pathogenPaths = [
  'M50 4C62 4 61 24 72 27s22-10 28 1-11 17-6 28 22 10 19 22-16 20-27 15-2 23-20 22-17-15-28-10-9 22-22 15 1-24-12-29-21 5-29-8 18-14 16-27-17-6-14-20S39 4 50 4Z',
  'M13 21c11-11 21 6 30-3S60 1 69 15s-8 20 5 29 20 18 7 30-22-2-27 12-18 21-31 9 5-22-8-29S-2 63 8 50 2 32 13 21Z',
  'M50 5l9 25 24-12-12 25 24 8-25 8 12 24-24-12-9 25-8-26-25 12 13-24-25-9 25-8-12-25 24 13Z',
];
const pathogenPairIds = [1, 2, 3, 4, 5, 6, 10];
const vectorPathogenSources = pathogenPairIds.map(
  pairId => `/assets/pathogen-scan-pairs/${pairId}.svg`,
);

function createPathogens() {
  // Keep other fireflies outside a ~100px pocket around the centered pair 1.
  const feedbackOrbit = [
    [-282, -54, 34],
    [-176, 108, 42],
    [-108, 72, 30],
    [48, 116, 38],
    [156, 152, 32],
    [312, 81, 44],
    [218, -126, 36],
    [82, -98, 30],
    [-20, -154, 40],
    [-146, -166, 28],
    [244, -28, 34],
    [-224, 58, 38],
  ];
  const feedbackAtmosphere = [
    [7, 12, 70],
    [20, 78, 58],
    [90, 10, 64],
    [94, 46, 80],
    [80, 86, 56],
    [5, 58, 48],
    [31, 91, 62],
    [96, 74, 50],
    [73, 25, 44],
    [3, 34, 42],
    [74, 6, 52],
  ];
  const drifts = [[24,-31,8],[-19,-38,-6],[17,-27,5],[-23,-35,-8],[13,-24,7],[25,-32,-5],[-17,-29,6],[20,-36,-7],[-12,-26,4]];
  const atmospherePairIds = pathogenPairIds.filter(id => id !== 1);
  const visibleOrbit = feedbackOrbit.filter((_, index) => [0, 2, 3, 5, 7].includes(index));
  const visibleAtmosphere = feedbackAtmosphere.slice(0, 6);
  const innerOrbitScale = Number(stage.dataset.innerOrbitScale || 1);
  const entries = isFeedbackStoryboard
    ? [
        { kind: 'primary', x: 50, y: 45, size: 84 },
        ...visibleOrbit.map(([orbitX, orbitY, size]) => {
          const scale = Math.hypot(orbitX, orbitY) < 180 ? innerOrbitScale : 1;
          return { kind: 'orbit', x: 50, y: 45, size, orbitX: orbitX * scale, orbitY: orbitY * scale };
        }),
        ...visibleAtmosphere.map(([x, y, size]) => ({ kind: 'far', x, y, size })),
      ]
    : (isVideoStoryboard
      ? [[12,19,78],[30,34,60],[77,22,52],[86,57,92],[61,16,40],[20,68,47],[71,66,72],[44,22,38],[51,54,84]]
      : [[15,23,58],[32,36,82],[76,27,52],[85,58,90],[62,18,36],[22,67,44],[70,66,64],[45,25,30]]
    ).map(([x, y, size]) => ({ kind: 'far', x, y, size }));

  entries.forEach((entry, index) => {
    const { kind, x, y, size: sourceSize } = entry;
    const isPrimary = kind === 'primary';
    const isOrbit = kind === 'orbit';
    const size = isFeedbackStoryboard
      ? isPrimary ? 82 : 60 + ((index * 23) % 47)
      : sourceSize;
    const pairId = isPrimary
      ? 1
      : isFeedbackStoryboard
      ? atmospherePairIds[(index - 1) % atmospherePairIds.length]
      : pathogenPairIds[index % pathogenPairIds.length];
    const [rawDriftX, rawDriftY] = drifts[index % drifts.length];
    const driftScale = isPrimary || isOrbit ? 0 : isFeedbackStoryboard ? .35 : 1;
    const driftX = rawDriftX * driftScale;
    const driftY = rawDriftY * driftScale;
    const glowRgb = index % 2 === 0 ? '157,255,0' : '89,194,255';
    const button = document.createElement('button');
    let hoverLockTimer = null;
    button.className = isPrimary ? 'pathogen is-primary' : isOrbit ? 'pathogen is-center-orbit' : 'pathogen';
    button.type = 'button';
    if (isVideoStoryboard) button.dataset.scanPair = String(pairId);
    button.setAttribute('aria-label', isPrimary ? 'Isolate primary airborne particle' : `Isolate airborne particle ${index + 1}`);
    const responsiveOrbitOffset = (value, axis) => {
      const magnitude = Math.abs(value);
      const viewportUnit = axis === 'x' ? 'vw' : 'vh';
      const viewportValue = magnitude / (axis === 'x' ? 14.4 : 9);
      const maximum = Math.round(magnitude * 1.6);
      return value < 0
        ? `clamp(-${maximum}px,-${viewportValue.toFixed(2)}${viewportUnit},-${magnitude}px)`
        : `clamp(${magnitude}px,${viewportValue.toFixed(2)}${viewportUnit},${maximum}px)`;
    };
    const orbitVars = isOrbit
      ? `--orbit-x:${responsiveOrbitOffset(entry.orbitX, 'x')};--orbit-y:${responsiveOrbitOffset(entry.orbitY, 'y')};--orbit-size:${size}px;`
      : '';
    const feedbackDelay = (1.18 + ((index * 7) % 11) * .035).toFixed(2);
    button.style.cssText = isVideoStoryboard
      ? `left:${x}%;top:${y}%;--size:${size}px;--glow-rgb:${glowRgb};--speed:${isPrimary ? 2.8 : isOrbit ? 3.1 + (index % 5) * .38 : 7.8 + (index % 4) * 1.05}s;--delay:${isFeedbackStoryboard ? feedbackDelay : (-index * 1.13).toFixed(2)}s;--start-x:${(-driftX * .35).toFixed(1)}px;--start-y:${(-driftY * .25).toFixed(1)}px;--mid-x:${(driftX * .2).toFixed(1)}px;--mid-y:${(driftY * .35).toFixed(1)}px;--end-x:${driftX.toFixed(1)}px;--end-y:${driftY.toFixed(1)}px;${orbitVars}`
      : `left:${x}%;top:${y}%;--size:${size}px;--speed:${5 + index%4}s;--delay:${-index * .7}s`;
    button.innerHTML = isVideoStoryboard
      ? `<img src="/assets/pathogen-scan-pairs/${pairId}.svg" alt="" />`
      : `<svg viewBox="0 0 100 100"><path d="${pathogenPaths[index % pathogenPaths.length]}" /></svg>`;
    const beginPathogenHover = () => {
      if (frame !== acquisitionFrame) return;
      holdAcquisitionForHover();
      if (usesIdleAutoFocus) {
        if (button.classList.contains('is-user-hovering')) return;
        button.classList.add('is-user-hovering');
        stage.classList.add('is-scan-cursor-active');
      }
      button.classList.add('is-selected');
      if (!isVideoStoryboard) return;
      if (isFeedbackStoryboard) {
        stage.classList.add('is-threat-focus');
        stage.classList.remove('is-threat-focus-locked');
        const source = button.querySelector('img')?.src;
        if (focusThreatImage && source) {
          focusThreatImage.style.setProperty('--focus-threat-image', `url("${source}")`);
        }
      }
      button.classList.add('is-threat-locking');
      clearTimeout(hoverLockTimer);
      hoverLockTimer = window.setTimeout(() => {
        if (frame !== acquisitionFrame || !button.matches(':hover')) return;
        button.classList.add('is-threat-locked');
        if (isFeedbackStoryboard) stage.classList.add('is-threat-focus-locked');
        lockPathogen(button);
      }, 2000);
    };
    button.addEventListener('mouseenter', () => {
      if (!usesIdleAutoFocus) beginPathogenHover();
    });
    button.addEventListener('pointermove', () => {
      if (usesIdleAutoFocus && performance.now() - lastIntentionalPointerMoveAt < 180) beginPathogenHover();
    });
    button.addEventListener('mouseleave', () => {
      if (frame !== acquisitionFrame) return;
      if (usesIdleAutoFocus && !button.classList.contains('is-user-hovering')) return;
      clearTimeout(hoverLockTimer);
      hoverLockTimer = null;
      button.classList.remove('is-selected', 'is-threat-locking', 'is-threat-locked', 'is-user-hovering');
      if (isFeedbackStoryboard) stage.classList.remove('is-threat-focus', 'is-threat-focus-locked');
      if (usesIdleAutoFocus) stage.classList.remove('is-scan-cursor-active');
      restartAcquisitionIdleWindow();
    });
    button.addEventListener('click', () => {
      if (isVideoStoryboard ? frame !== acquisitionFrame : frame < 4 || frame > 5) return;
      document.querySelectorAll('.pathogen').forEach(p => p.classList.remove('is-selected'));
      button.classList.add('is-selected');
      if (isVideoStoryboard) lockPathogen(button);
      preferPrimaryOnPairScan = false;
      setFrame(pairScanFrame);
      if (!isVideoStoryboard) window.setTimeout(() => setFrame(6), 850);
    });
    pathogenLayer.appendChild(button);
  });
}

function lockPathogen(button) {
  const image = button?.querySelector('img');
  if (!image) return;
  const stageBounds = stage.getBoundingClientRect();
  const lockSource = isFeedbackStoryboard
    ? document.querySelector('.figma-hud-target') || button
    : button;
  const bounds = lockSource.getBoundingClientRect();
  const x = ((bounds.left + bounds.width * .5 - stageBounds.left) / stageBounds.width) * 100;
  const y = ((bounds.top + bounds.height * .5 - stageBounds.top) / stageBounds.height) * 100;
  stage.style.setProperty('--lock-x', `${x.toFixed(3)}%`);
  stage.style.setProperty('--lock-y', `${y.toFixed(3)}%`);
  stage.style.setProperty('--lock-flight-size', `${Math.max(bounds.width, bounds.height).toFixed(2)}px`);
  stage.style.setProperty('--lock-flight-x', `${x.toFixed(3)}%`);
  stage.style.setProperty('--lock-flight-y', `${y.toFixed(3)}%`);
  stage.style.setProperty('--lock-flight-scale', '1');
  stage.style.setProperty('--lock-flight-opacity', '1');
  document.querySelectorAll('[data-lock-image]').forEach(target => { target.src = image.src; });
  const scanPair = button.dataset.scanPair || '1';
  stage.dataset.selectedPair = scanPair;
  const pairA = document.querySelector('[data-pair-slot="a"]');
  const pairB = document.querySelector('[data-pair-slot="b"]');
  const realisticSource = `/assets/pathogen-scan-pairs/${scanPair}.png`;
  if (pairA) {
    if (isFeedbackStoryboard) {
      pairA.style.setProperty('--pair-realistic-image', `url("${realisticSource}")`);
    } else {
      pairA.src = image.src;
    }
  }
  const specimen = document.querySelector('.pair-scan-specimen');
  if (pairA && specimen && !isFeedbackStoryboard) {
    const specimenBounds = specimen.getBoundingClientRect();
    const targetSize = Math.min(specimenBounds.width, specimenBounds.height);
    const deltaX = bounds.left + bounds.width * .5 - (specimenBounds.left + specimenBounds.width * .5);
    const deltaY = bounds.top + bounds.height * .5 - (specimenBounds.top + specimenBounds.height * .5);
    const startScale = Math.max(bounds.width, bounds.height) / targetSize;
    pairA.style.transform = `translate3d(${deltaX.toFixed(2)}px, ${deltaY.toFixed(2)}px, 0) scale(${startScale.toFixed(5)})`;
    pairA.style.clipPath = 'inset(0 0 0 0)';
    pairA.style.opacity = '1';
  }
  if (pairB) {
    pairB.src = realisticSource;
  }
  const detectedImage = document.querySelector('[data-detected-image]');
  if (detectedImage) {
    detectedImage.src = realisticSource;
    detectedImage.dataset.matchSrc = detectedImage.src;
  }
}

function focusPrimaryPathogen() {
  const primary = document.querySelector('.pathogen.is-primary');
  if (!primary) return;
  document.querySelectorAll('.pathogen').forEach(pathogen => {
    pathogen.classList.toggle('is-selected', pathogen === primary);
    if (pathogen !== primary) pathogen.classList.remove('is-threat-locking', 'is-threat-locked');
  });
  primary.classList.add('is-threat-locking');
  if (usesIdleAutoFocus) stage.classList.remove('is-scan-cursor-active');
  stage.classList.add('is-threat-focus');
  stage.classList.remove('is-threat-focus-locked');
  focusThreatImage?.style.setProperty('--focus-threat-image', 'url("/assets/pathogen-scan-pairs/1.svg")');
  lockPathogen(primary);
}

function schedulePrimaryAutoFocus(delay = hudInitiationDuration) {
  clearTimeout(autoFocusTimer);
  autoFocusTimer = window.setTimeout(() => {
    autoFocusTimer = null;
    if (!playing || frame !== acquisitionFrame) return;
    focusPrimaryPathogen();
  }, delay);
}

function buildTimeline() {
  frames.forEach((item, index) => {
    const button = document.createElement('button');
    button.className = 'frame-button';
    button.type = 'button';
    button.role = 'tab';
    button.textContent = String(index + 1).padStart(2, '0');
    button.title = item.title;
    button.addEventListener('click', () => {
      pause();
      remainingDelay = null;
      setFrame(index + 1);
    });
    timeline.appendChild(button);
  });
}

function setFrame(next) {
  clearTimeout(autoFocusTimer);
  autoFocusTimer = null;
  const nextFrame = Math.max(1, Math.min(frames.length, next));
  if (isVideoStoryboard && nextFrame === frames.length && frame === frames.length - 1) {
    stage.dispatchEvent(new CustomEvent('storyboard:prepare-final'));
  }
  if (isVideoStoryboard && nextFrame === pairScanFrame && frame !== pairScanFrame) {
    stage.style.setProperty('--frame5-hud-opacity', '1');
    stage.style.setProperty('--pair-content-opacity', '0');
    stage.style.setProperty('--pair-backdrop-opacity', '0');
    stage.style.setProperty('--pair-scene-dim', '.52');
    stage.style.setProperty('--frame5-background-opacity', '1');
    stage.style.setProperty('--frame5-overlay-opacity', '1');
    stage.style.setProperty('--pair-progress', '100%');
  }
  frame = nextFrame;
  stage.dataset.frame = frame;
  if (isFeedbackStoryboard && frame !== acquisitionFrame) {
    stage.classList.remove('is-threat-focus', 'is-threat-focus-locked', 'is-scan-cursor-active');
    document.querySelectorAll('.pathogen.is-user-hovering').forEach(pathogen => pathogen.classList.remove('is-user-hovering'));
  }
  if (isFeedbackStoryboard && frame === acquisitionFrame && playing) schedulePrimaryAutoFocus();
  if (frame === 1) {
    if (playing) heroMeshCut.play();
    else heroMeshCut.showIdle();
  } else if (frame === 2) heroMeshCut.playDepth();
  else heroMeshCut.deactivate();
  frameNumber.textContent = String(frame).padStart(2, '0');
  if (systemState) systemState.textContent = frames[frame - 1].state;
  [...timeline.children].forEach((button, index) => {
    button.classList.toggle('active', index + 1 === frame);
    button.classList.toggle('passed', index + 1 < frame);
    button.setAttribute('aria-selected', index + 1 === frame);
  });
  stageNext.innerHTML = frame === frames.length ? 'REPLAY <span>↻</span>' : 'NEXT <span>→</span>';
  if (frame === pairScanFrame) {
    if (isFeedbackStoryboard && preferPrimaryOnPairScan) {
      const primary = document.querySelector('.pathogen.is-primary');
      document.querySelectorAll('.pathogen').forEach(p => {
        p.classList.toggle('is-selected', p === primary);
        if (p !== primary) p.classList.remove('is-threat-locking', 'is-threat-locked');
      });
      if (primary) lockPathogen(primary);
    } else if (!document.querySelector('.pathogen.is-selected')) {
      const fallback = document.querySelector('.pathogen.is-primary')
        || document.querySelector('.pathogen[data-scan-pair="1"]')
        || document.querySelector('.pathogen');
      fallback?.classList.add('is-selected');
      if (isVideoStoryboard && fallback) lockPathogen(fallback);
    }
    preferPrimaryOnPairScan = true;
  }
  if (!isVideoStoryboard) {
    if (frame === 6) animateMatch();
    if (frame === 7) {
      matchReadout.textContent = 'MATCH 98.7% / MALICIOUS';
      analysisTitle.textContent = 'THREAT CONFIRMED';
    } else {
      analysisTitle.textContent = 'STRUCTURAL MATCH';
      if (frame !== 6) matchReadout.textContent = 'MATCHING 00%';
    }
  }
  if (playing) scheduleNext();
}

function animateMatch() {
  if (!matchReadout) return;
  let pct = 0;
  let previous = performance.now();
  const tick = now => {
    if (frame !== 6) return;
    if (playing) pct = Math.min(98, pct + (now - previous) / 27);
    previous = now;
    matchReadout.textContent = `MATCHING ${String(Math.floor(pct)).padStart(2,'0')}%`;
    if (pct < 98) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function getFrameDuration(frameNumber = frame) {
  if (!isFeedbackStoryboard) return frames[frameNumber - 1].duration;
  if (frameNumber === 2) {
    const speed = Math.max(.4, Number(document.querySelector('#depthScanSpeed')?.value || 1));
    return 2600 / speed + 900;
  }
  if (frameNumber === pairScanFrame) {
    return Number(stage.dataset.pairScanDuration || 5300);
  }
  return frames[frameNumber - 1].duration;
}

function scheduleNext(delay = getFrameDuration()) {
  clearTimeout(playTimer);
  if (!playing || frame === 1) return;
  remainingDelay = delay;
  playDeadline = performance.now() + delay;
  playTimer = setTimeout(() => {
    remainingDelay = null;
    if (frame === frames.length) { pause(); return; }
    setFrame(frame + 1);
  }, delay);
}
function updatePlayButton() {
  playButton.innerHTML = playing ? '<span>Ⅱ</span>' : '<span>▶</span>';
  playButton.setAttribute('aria-label', playing ? 'Pause sequence' : hasStarted ? 'Resume sequence' : 'Play sequence');
}
function resume() {
  if (playing) return;
  hasStarted = true;
  playing = true;
  stage.classList.remove('is-paused');
  if (isFeedbackStoryboard && frame === acquisitionFrame) schedulePrimaryAutoFocus();
  if (frame <= 2) heroMeshCut.resume();
  if (frame !== 1) scheduleNext(remainingDelay ?? getFrameDuration());
  updatePlayButton();
}
function pause() {
  if (!playing) return;
  playing = false;
  if (playTimer) remainingDelay = Math.max(0, playDeadline - performance.now());
  clearTimeout(playTimer);
  clearTimeout(autoFocusTimer);
  autoFocusTimer = null;
  playTimer = null;
  stage.classList.add('is-paused');
  if (frame <= 2) heroMeshCut.pause();
  updatePlayButton();
}
playButton.addEventListener('click', () => playing ? pause() : resume());
stageNext.addEventListener('click', () => { pause(); remainingDelay = null; setFrame(frame === frames.length ? 1 : frame + 1); });
document.addEventListener('keydown', event => {
  if (event.key === 'ArrowRight') { pause(); remainingDelay = null; setFrame(frame + 1); }
  if (event.key === 'ArrowLeft') { pause(); remainingDelay = null; setFrame(frame - 1); }
  if (event.code === 'Space' && event.target === document.body) { event.preventDefault(); playing ? pause() : resume(); }
});

function buildMap() {
  const map = document.querySelector('#mapPoints');
  if (!map) return;
  const outline = document.createElementNS('http://www.w3.org/2000/svg','path');
  outline.setAttribute('d','M68 174L124 126l85 8 54-35 70 18 29 53-31 46-72 10-32 62-56-11-25-48-57-17zm326-53 72-54 139 17 44 41-17 72-75 23-23 126-50-25-22-91-63-59zm307 20 56-58 128-7 33 42 112 17 88 72-30 49-102-21-82 50-31 96-43-22-10-105-77-30z');
  map.appendChild(outline);
  const points = [[170,180],[245,250],[452,157],[530,236],[588,345],[760,160],[830,226],[920,190],[1004,266],[1080,220],[710,292]];
  points.forEach(([x,y], i) => {
    const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
    dot.setAttribute('cx',x); dot.setAttribute('cy',y); dot.setAttribute('r',i===5?4:2.3); dot.setAttribute('class',i===5?'hot':'base'); map.appendChild(dot);
    if ([1,5,8,10].includes(i)) [1,2].forEach(n => { const ring=document.createElementNS('http://www.w3.org/2000/svg','circle');ring.setAttribute('cx',x);ring.setAttribute('cy',y);ring.setAttribute('r',6);ring.setAttribute('class','ring');ring.style.animationDelay=`${n*.8+i*.11}s`;map.appendChild(ring); });
  });
}

function resize() {
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = stage.clientHeight * dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
}
function drawScene(time) {
  const w = innerWidth, h = stage.clientHeight;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,w,h);
  if (frame >= 3 && frame <= 5) {
    const horizon = h*.48;
    ctx.strokeStyle='rgba(15,100,132,.14)';ctx.lineWidth=1;
    for(let x=0;x<w;x+=w/10){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}
    for(let y=h*.18;y<h;y+=h/9){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
    const people=[[-.05,.24,.23],[.08,.2,.26],[.22,.32,.2],[.38,.17,.3],[.59,.25,.26],[.76,.2,.28],[.92,.31,.21]];
    people.forEach(([x,y,s],i) => drawPerson(w*x,h*y,h*s,i));
    ctx.fillStyle='rgba(0,63,91,.28)';ctx.fillRect(0,horizon,w,h-horizon);
  }
  raf=requestAnimationFrame(drawScene);
}
function drawPerson(x,y,size,index){
  ctx.save();ctx.translate(x,y);const blue=index%2?'rgba(0,87,128,.65)':'rgba(0,71,108,.52)';ctx.fillStyle=blue;ctx.shadowColor='#007ab2';ctx.shadowBlur=22;
  ctx.beginPath();ctx.arc(size*.48,size*.15,size*.1,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.moveTo(size*.32,size*.28);ctx.quadraticCurveTo(size*.48,size*.19,size*.65,size*.29);ctx.lineTo(size*.72,size*.78);ctx.lineTo(size*.57,size*.78);ctx.lineTo(size*.54,size*1.35);ctx.lineTo(size*.4,size*1.35);ctx.lineTo(size*.38,size*.78);ctx.lineTo(size*.23,size*.77);ctx.closePath();ctx.fill();ctx.restore();
}

buildTimeline();createPathogens();buildMap();resize();setFrame(1);updatePlayButton();drawScene(startTime);
window.addEventListener('resize',resize);
