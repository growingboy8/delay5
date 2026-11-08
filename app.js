const liveVideo = document.getElementById('live-video');
const reviewCanvas = document.getElementById('review-canvas');
const ctx = reviewCanvas.getContext('2d', { alpha: false });
const videoWrapper = document.getElementById('video-wrapper');
const startBtn = document.getElementById('start-btn');
const statusOverlay = document.getElementById('status-overlay');
const delayRange = document.getElementById('delay-range');
const delayVal = document.getElementById('delay-val');
const orientationToggle = document.getElementById('orientation-toggle');
const orientationLabel = document.getElementById('orientation-label');
const audioToggle = document.getElementById('audio-toggle');
const intervalRange = document.getElementById('interval-range');
const intervalVal = document.getElementById('interval-val');
const countdownDisplay = document.getElementById('countdown-display');
const reviewDeck = document.getElementById('review-deck');
const scrubSlider = document.getElementById('scrub-slider');
const stepPrev = document.getElementById('step-prev');
const stepNext = document.getElementById('step-next');
const playPauseBtn = document.getElementById('play-pause-btn');
const frameCounter = document.getElementById('frame-counter');
const modePill = document.getElementById('mode-pill');

const FPS = 30;
const MAX_STORE_SECONDS = 12;
const BUFFER_LONG_EDGE = 720;

let engineOn = false;
let isCapturing = false;
let isPlayingLiveDelay = true;
let currentReviewIndex = 0;
let freezeIndex = 0;
let loopIntervalId = null;
let audioIntervalId = null;
let countdownId = null;
let audioCtx = null;
let currentStream = null;

const ring = {
  slots: [],
  capacity: 0,
  head: 0,
  length: 0,
  frameW: 0,
  frameH: 0
};

function isPortraitMode() {
  return orientationToggle.checked;
}

function delayFrames() {
  return Math.max(1, parseInt(delayRange.value, 10) * FPS);
}

function storeCapacity() {
  return Math.max(delayFrames(), MAX_STORE_SECONDS * FPS);
}

function resetRing(capacity) {
  ring.slots = new Array(capacity);
  ring.capacity = capacity;
  ring.head = 0;
  ring.length = 0;
  ring.frameW = 0;
  ring.frameH = 0;
}

function chronologicalIndexToSlot(index) {
  const start = (ring.head - ring.length + ring.capacity) % ring.capacity;
  return (start + index) % ring.capacity;
}

function getFrame(index) {
  if (index < 0 || index >= ring.length) return null;
  const slot = ring.slots[chronologicalIndexToSlot(index)];
  return slot ? slot.canvas : null;
}

function delayedLiveIndex() {
  if (ring.length === 0) return 0;
  if (ring.length < delayFrames()) return -1;
  return ring.length - delayFrames();
}

function captureSize(videoW, videoH, portrait) {
  const targetRatio = portrait ? 9 / 16 : 16 / 9;
  const srcRatio = videoW / videoH;
  let cropW = videoW;
  let cropH = videoH;
  if (srcRatio > targetRatio) {
    cropW = videoH * targetRatio;
  } else if (srcRatio < targetRatio) {
    cropH = videoW / targetRatio;
  }
  const longEdge = Math.max(cropW, cropH);
  const scale = Math.min(1, BUFFER_LONG_EDGE / longEdge);
  return {
    width: Math.max(2, Math.round(cropW * scale)),
    height: Math.max(2, Math.round(cropH * scale)),
    sx: Math.max(0, (videoW - cropW) / 2),
    sy: Math.max(0, (videoH - cropH) / 2),
    sw: cropW,
    sh: cropH
  };
}

function drawVideoInto(ctx2d, canvas, layout) {
  if (canvas.width !== layout.width || canvas.height !== layout.height) {
    canvas.width = layout.width;
    canvas.height = layout.height;
  }
  ctx2d.fillStyle = '#000';
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);
  ctx2d.drawImage(
    liveVideo,
    layout.sx, layout.sy, layout.sw, layout.sh,
    0, 0, canvas.width, canvas.height
  );
}

function pushLiveFrame() {
  const vw = liveVideo.videoWidth;
  const vh = liveVideo.videoHeight;
  if (!vw || !vh) return false;

  const layout = captureSize(vw, vh, isPortraitMode());
  if (ring.frameW && (ring.frameW !== layout.width || ring.frameH !== layout.height)) {
    resetRing(storeCapacity());
  }
  ring.frameW = layout.width;
  ring.frameH = layout.height;

  const slotIndex = ring.head;
  let slot = ring.slots[slotIndex];
  if (!slot) {
    const canvas = document.createElement('canvas');
    slot = { canvas, ctx: canvas.getContext('2d', { alpha: false }) };
    ring.slots[slotIndex] = slot;
  }
  drawVideoInto(slot.ctx, slot.canvas, layout);

  ring.head = (ring.head + 1) % ring.capacity;
  if (ring.length < ring.capacity) ring.length += 1;
  return true;
}

function paintFrame(frameCanvas) {
  if (!frameCanvas) return;
  if (reviewCanvas.width !== frameCanvas.width || reviewCanvas.height !== frameCanvas.height) {
    reviewCanvas.width = frameCanvas.width;
    reviewCanvas.height = frameCanvas.height;
  }
  ctx.drawImage(frameCanvas, 0, 0);
}

function paintBuffering(sourceCanvas, percent) {
  paintFrame(sourceCanvas);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, reviewCanvas.width, reviewCanvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.font = `${Math.max(18, Math.round(reviewCanvas.width / 22))}px sans-serif`;
  ctx.fillText(`Buffering delay ${percent}%`, 24, 48);
}

function secondsBehind(index) {
  const newest = ring.length - 1;
  return ((newest - index) / FPS).toFixed(2);
}

function renderDelayedLive() {
  const liveIdx = delayedLiveIndex();
  if (liveIdx < 0) {
    const newest = getFrame(ring.length - 1);
    const percent = Math.round((ring.length / delayFrames()) * 100);
    paintBuffering(newest, Math.min(100, percent));
    frameCounter.textContent = `Filling delay buffer… ${Math.min(100, percent)}%`;
    modePill.textContent = 'Buffering';
    return;
  }
  paintFrame(getFrame(liveIdx));
  frameCounter.textContent = `Live delay (−${delayRange.value}s)`;
  modePill.textContent = `Live delay −${delayRange.value}s`;
}

function renderReviewFrame(index) {
  const frame = getFrame(index);
  if (!frame) return;
  paintFrame(frame);
  const maxIndex = freezeIndex;
  frameCounter.textContent = `Inspect −${secondsBehind(index)}s  ·  frame ${index + 1} / ${maxIndex + 1}`;
}

function enterInspectMode() {
  if (ring.length === 0) return;
  isPlayingLiveDelay = false;
  isCapturing = false;
  freezeIndex = ring.length - 1;
  const liveIdx = delayedLiveIndex();
  currentReviewIndex = liveIdx < 0 ? freezeIndex : liveIdx;
  scrubSlider.min = 0;
  scrubSlider.max = freezeIndex;
  scrubSlider.value = currentReviewIndex;
  playPauseBtn.textContent = '▶ Resume Live Feed';
  statusOverlay.style.opacity = 0;
  modePill.hidden = false;
  modePill.textContent = 'Inspect (frozen)';
  renderReviewFrame(currentReviewIndex);
}

function resumeLiveDelay() {
  isPlayingLiveDelay = true;
  isCapturing = engineOn;
  playPauseBtn.textContent = '⏸ Pause & Inspect';
  statusOverlay.style.opacity = 0;
  modePill.textContent = `Live delay −${delayRange.value}s`;
}

function applyOrientationUi() {
  if (isPortraitMode()) {
    orientationLabel.textContent = 'Mode: Vertical (9:16)';
    videoWrapper.className = 'video-container vertical-view';
  } else {
    orientationLabel.textContent = 'Mode: Widescreen (16:9)';
    videoWrapper.className = 'video-container horizontal-view';
  }
}

delayRange.addEventListener('input', () => {
  delayVal.textContent = delayRange.value;
});

intervalRange.addEventListener('input', () => {
  intervalVal.textContent = intervalRange.value;
});

orientationToggle.addEventListener('change', async () => {
  applyOrientationUi();
  if (engineOn) {
    await startEngine(true);
  }
});

function playTone(freq, duration) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function startAudioCueLoop() {
  clearInterval(audioIntervalId);
  clearInterval(countdownId);
  if (!audioToggle.checked) {
    countdownDisplay.textContent = 'Cues disabled';
    return;
  }
  const period = parseInt(intervalRange.value, 10);
  let timeLeft = period;
  const runCountdown = () => {
    if (timeLeft <= 3 && timeLeft > 0) {
      playTone(440, 0.1);
      countdownDisplay.textContent = `Beep in ${timeLeft}…`;
    } else if (timeLeft === 0) {
      playTone(880, 0.3);
      countdownDisplay.textContent = 'GO!';
      timeLeft = period + 1;
    } else {
      countdownDisplay.textContent = `Next prompt in ${timeLeft}s`;
    }
    timeLeft -= 1;
  };
  runCountdown();
  countdownId = setInterval(runCountdown, 1000);
}

audioToggle.addEventListener('change', startAudioCueLoop);
intervalRange.addEventListener('change', startAudioCueLoop);

function processVideoFrame() {
  if (!isCapturing) return;
  if (liveVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  pushLiveFrame();
  if (isPlayingLiveDelay) {
    renderDelayedLive();
  }
}

playPauseBtn.addEventListener('click', () => {
  if (!engineOn || ring.length === 0) return;
  if (isPlayingLiveDelay) enterInspectMode();
  else resumeLiveDelay();
});

scrubSlider.addEventListener('pointerdown', () => {
  if (isPlayingLiveDelay && engineOn) enterInspectMode();
});

scrubSlider.addEventListener('input', (e) => {
  if (isPlayingLiveDelay) enterInspectMode();
  const maxAllowed = freezeIndex;
  let next = parseInt(e.target.value, 10);
  if (Number.isNaN(next)) return;
  if (next > maxAllowed) next = maxAllowed;
  currentReviewIndex = Math.max(0, next);
  scrubSlider.value = currentReviewIndex;
  renderReviewFrame(currentReviewIndex);
});

stepPrev.addEventListener('click', () => {
  if (!engineOn) return;
  if (isPlayingLiveDelay) enterInspectMode();
  if (currentReviewIndex > 0) {
    currentReviewIndex -= 1;
    scrubSlider.value = currentReviewIndex;
    renderReviewFrame(currentReviewIndex);
  }
});

stepNext.addEventListener('click', () => {
  if (!engineOn) return;
  if (isPlayingLiveDelay) enterInspectMode();
  if (currentReviewIndex < freezeIndex) {
    currentReviewIndex += 1;
    scrubSlider.value = currentReviewIndex;
    renderReviewFrame(currentReviewIndex);
  }
});

async function lockOrientation() {
  const type = isPortraitMode() ? 'portrait' : 'landscape';
  try {
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock(type);
    }
  } catch (_) {
    /* Browser or PWA may ignore orientation lock */
  }
}

async function goFullscreen() {
  const root = document.documentElement;
  try {
    if (!document.fullscreenElement && root.requestFullscreen) {
      await root.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch (_) {
    /* Standalone PWA is already close to fullscreen */
  }
}

function stopTracks() {
  if (!currentStream) return;
  currentStream.getTracks().forEach((track) => track.stop());
  currentStream = null;
}

async function openCamera() {
  const portrait = isPortraitMode();
  const attempts = portrait
    ? [
        { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 1280 }, aspectRatio: { ideal: 9 / 16 } },
        { facingMode: 'user', height: { ideal: 1280 } },
        { facingMode: { ideal: 'user' } },
        true
      ]
    : [
        { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } },
        { facingMode: 'user', width: { ideal: 1280 } },
        { facingMode: { ideal: 'user' } },
        true
      ];

  let lastError = null;
  for (const video of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Camera unavailable');
}

async function startEngine(restarting = false) {
  try {
    startBtn.disabled = true;
    statusOverlay.textContent = restarting ? 'Switching camera profile…' : 'Starting camera…';
    statusOverlay.style.opacity = 1;

    stopTracks();
    const stream = await openCamera();
    currentStream = stream;
    liveVideo.srcObject = stream;
    await liveVideo.play().catch(() => {});

    resetRing(storeCapacity());
    engineOn = true;
    isCapturing = true;
    isPlayingLiveDelay = true;
    document.body.classList.add('engine-on');
    reviewDeck.classList.remove('disabled');
    playPauseBtn.textContent = '⏸ Pause & Inspect';
    modePill.hidden = false;
    modePill.textContent = 'Live delay';
    startBtn.textContent = 'Stop Camera Engine';
    startBtn.classList.add('stop');
    startBtn.disabled = false;

    clearInterval(loopIntervalId);
    loopIntervalId = setInterval(processVideoFrame, 1000 / FPS);

    await goFullscreen();
    await lockOrientation();
    startAudioCueLoop();
    statusOverlay.style.opacity = 0;
  } catch (err) {
    console.error(err);
    statusOverlay.textContent = 'Camera failed. Allow camera access and keep the tablet unlocked.';
    statusOverlay.style.opacity = 1;
    startBtn.disabled = false;
  }
}

function stopEngine() {
  engineOn = false;
  isCapturing = false;
  isPlayingLiveDelay = true;
  clearInterval(loopIntervalId);
  loopIntervalId = null;
  stopTracks();
  liveVideo.srcObject = null;
  resetRing(1);
  ctx.clearRect(0, 0, reviewCanvas.width, reviewCanvas.height);
  document.body.classList.remove('engine-on');
  reviewDeck.classList.add('disabled');
  modePill.hidden = true;
  startBtn.textContent = 'Start Camera Engine';
  startBtn.classList.remove('stop');
  startBtn.disabled = false;
  statusOverlay.textContent = 'Camera Offline';
  statusOverlay.style.opacity = 1;
  frameCounter.textContent = 'Frame: 0 / 0';
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  try {
    if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
  } catch (_) { /* ignore */ }
}

startBtn.addEventListener('click', () => {
  if (engineOn) stopEngine();
  else startEngine();
});

applyOrientationUi();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
