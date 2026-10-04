/**
 * Sainik Ghosh — Scroll-Based Video Frame Sequence Animation
 * 
 * Features:
 * - 192-frame sequence with 1280x720 source resolution
 * - Intelligent progressive loading (Priority 1: Frame 1, Priority 2: Keyframes, Priority 3: Remaining frames)
 * - Nearest-neighbor frame fallback ensuring zero flicker during high-speed scrub
 * - Physics-based LERP (Linear Interpolation) damping for silky-smooth motion
 * - High-DPI / Retina canvas support with crisp object-fit cover rendering
 * - Non-blocking concurrency-managed preloading
 */

(function () {
  'use strict';

  // --- Configuration ---
  const TOTAL_FRAMES = 192;
  const LERP_EASE = 0.11; // Smooth damping coefficient (0.08 - 0.15 feels best)
  const CONCURRENT_DOWNLOADS = 6;
  const MIN_FRAMES_TO_START = 20;

  // --- DOM Elements ---
  const canvas = document.getElementById('sequence-canvas');
  const ctx = canvas.getContext('2d', { alpha: false }); // alpha: false optimizes rendering
  const timelineProgress = document.getElementById('timeline-progress');
  const frameCurrentEl = document.getElementById('frame-current');
  const framePctEl = document.getElementById('frame-pct');
  const scrollPrompt = document.getElementById('scroll-prompt');
  
  // Preloader elements
  const preloader = document.getElementById('preloader');
  const loadPercentageEl = document.getElementById('load-percentage');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const spinnerFill = document.getElementById('spinner-fill');
  const preloaderSubtext = document.getElementById('preloader-subtext');

  // SVG spinner circumference: 2 * PI * r = 2 * 3.14159 * 20 = 125.66
  const SPINNER_CIRCUMFERENCE = 125.66;

  // --- State Variables ---
  const frameImages = new Array(TOTAL_FRAMES);
  let loadedCount = 0;
  let targetProgress = 0;
  let currentProgress = 0;
  let lastDrawnIndex = -1;
  let isPreloaderDismissed = false;
  let needsRedraw = true;

  // --- Helper: Generate frame URL (1-indexed zero-padded) ---
  function getFrameUrl(index) {
    const frameNum = String(index + 1).padStart(6, '0');
    return `video_frames_png/frame_${frameNum}.png`;
  }

  // --- Initialize Frame Placeholders ---
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    frameImages[i] = {
      index: i,
      img: new Image(),
      loaded: false,
      failed: false
    };
  }

  // --- Canvas High-DPI Sizing & Responsive Fit ---
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const displayWidth = window.innerWidth;
    const displayHeight = window.innerHeight;

    if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
      canvas.width = Math.round(displayWidth * dpr);
      canvas.height = Math.round(displayHeight * dpr);
      canvas.style.width = displayWidth + 'px';
      canvas.style.height = displayHeight + 'px';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      needsRedraw = true;
    }
  }

  window.addEventListener('resize', resizeCanvas, { passive: true });
  resizeCanvas();

  // --- Frame Search Fallback ---
  function getBestAvailableFrame(requestedIdx) {
    if (frameImages[requestedIdx] && frameImages[requestedIdx].loaded) {
      return frameImages[requestedIdx].img;
    }

    // Bidirectional search outward for the nearest cached frame
    let offset = 1;
    while (requestedIdx - offset >= 0 || requestedIdx + offset < TOTAL_FRAMES) {
      const prevIdx = requestedIdx - offset;
      if (prevIdx >= 0 && frameImages[prevIdx] && frameImages[prevIdx].loaded) {
        return frameImages[prevIdx].img;
      }
      const nextIdx = requestedIdx + offset;
      if (nextIdx < TOTAL_FRAMES && frameImages[nextIdx] && frameImages[nextIdx].loaded) {
        return frameImages[nextIdx].img;
      }
      offset++;
    }

    return null;
  }

  // --- Canvas Draw Routine ---
  function drawFrame(frameIdx) {
    const img = getBestAvailableFrame(frameIdx);
    if (!img) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const iw = img.naturalWidth || 1280;
    const ih = img.naturalHeight || 720;

    // Object-fit: cover calculation
    const hRatio = cw / iw;
    const vRatio = ch / ih;
    const scale = Math.max(hRatio, vRatio);

    const renderW = iw * scale;
    const renderH = ih * scale;
    let renderX = (cw - renderW) / 2;
    const renderY = (ch - renderH) / 2;

    // On desktop screens (>= 1024px), subtly shift image rightward (~14% of canvas width)
    // so Sainik's portrait sits on the right side behind the hero section, exactly like port1.jpg!
    if (window.innerWidth >= 1024) {
      renderX += (cw * 0.14);
    }

    ctx.drawImage(img, renderX, renderY, renderW, renderH);
    needsRedraw = false;
  }

  // --- UI & HUD Updates ---
  function updateUI(frameIdx, progress) {
    const paddedFrame = String(frameIdx + 1).padStart(3, '0');
    if (frameCurrentEl && frameCurrentEl.textContent !== paddedFrame) {
      frameCurrentEl.textContent = paddedFrame;
    }

    const pctString = Math.round(progress * 100) + '%';
    if (framePctEl && framePctEl.textContent !== pctString) {
      framePctEl.textContent = pctString;
    }

    if (timelineProgress) {
      timelineProgress.style.width = (progress * 100) + '%';
    }

    // Hide scroll prompt on initial scroll
    if (scrollPrompt) {
      if (progress > 0.015) {
        scrollPrompt.classList.add('is-hidden');
      } else {
        scrollPrompt.classList.remove('is-hidden');
      }
    }
  }

  // --- Scroll Tracking ---
  function onScroll() {
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight <= 0) {
      targetProgress = 0;
    } else {
      targetProgress = Math.max(0, Math.min(1, window.scrollY / docHeight));
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  // Initial check
  onScroll();

  // --- Physics-based Main Animation Loop (rAF) ---
  function tick() {
    const diff = targetProgress - currentProgress;

    if (Math.abs(diff) > 0.0001) {
      currentProgress += diff * LERP_EASE;
    } else {
      currentProgress = targetProgress;
    }

    const activeIndex = Math.min(
      TOTAL_FRAMES - 1,
      Math.max(0, Math.round(currentProgress * (TOTAL_FRAMES - 1)))
    );

    if (activeIndex !== lastDrawnIndex || needsRedraw) {
      drawFrame(activeIndex);
      lastDrawnIndex = activeIndex;
      updateUI(activeIndex, currentProgress);
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  // --- Progressive Preloader Architecture ---
  function updatePreloaderProgress() {
    const pct = Math.min(100, Math.round((loadedCount / TOTAL_FRAMES) * 100));

    if (loadPercentageEl) loadPercentageEl.textContent = pct + '%';
    if (progressBarFill) progressBarFill.style.width = pct + '%';

    if (spinnerFill) {
      const offset = SPINNER_CIRCUMFERENCE - (pct / 100) * SPINNER_CIRCUMFERENCE;
      spinnerFill.style.strokeDashoffset = offset;
    }

    if (loadedCount >= MIN_FRAMES_TO_START && !isPreloaderDismissed) {
      dismissPreloader();
    }
  }

  function dismissPreloader() {
    if (isPreloaderDismissed) return;
    isPreloaderDismissed = true;

    if (preloaderSubtext) preloaderSubtext.textContent = 'Ready to explore';

    setTimeout(() => {
      preloader.classList.add('fade-out');
      // Ensure initial frame is painted immediately
      needsRedraw = true;
    }, 250);
  }

  function loadSingleFrame(index) {
    return new Promise((resolve) => {
      const item = frameImages[index];
      if (item.loaded) {
        resolve(item);
        return;
      }

      item.img.onload = () => {
        item.loaded = true;
        loadedCount++;
        updatePreloaderProgress();

        // If this is the very first frame, draw it immediately!
        if (index === 0 && lastDrawnIndex === -1) {
          drawFrame(0);
        }

        resolve(item);
      };

      item.img.onerror = () => {
        console.warn(`Failed to load frame ${index + 1}`);
        item.failed = true;
        loadedCount++;
        updatePreloaderProgress();
        resolve(item);
      };

      item.img.src = getFrameUrl(index);
    });
  }

  // Concurrent Batch Queue
  async function runBatchQueue(queue) {
    let cursor = 0;

    async function worker() {
      while (cursor < queue.length) {
        const idx = queue[cursor++];
        await loadSingleFrame(idx);
      }
    }

    const workers = [];
    const concurrency = Math.min(CONCURRENT_DOWNLOADS, queue.length);
    for (let w = 0; w < concurrency; w++) {
      workers.push(worker());
    }

    await Promise.all(workers);
  }

  // --- Preloading Sequence ---
  async function startPreloading() {
    // 1. First frame: Immediate priority
    await loadSingleFrame(0);
    drawFrame(0);

    // 2. Keyframes distributed evenly across sequence (every 6th frame)
    const keyframes = [];
    for (let i = 0; i < TOTAL_FRAMES; i += 6) {
      if (i !== 0) keyframes.push(i);
    }
    // Also include last frame
    if (!keyframes.includes(TOTAL_FRAMES - 1)) {
      keyframes.push(TOTAL_FRAMES - 1);
    }

    await runBatchQueue(keyframes);

    // 3. Fill in all remaining intermediate frames
    const remainingFrames = [];
    for (let i = 0; i < TOTAL_FRAMES; i++) {
      if (i !== 0 && !keyframes.includes(i)) {
        remainingFrames.push(i);
      }
    }

    // Continue background streaming of all remaining frames
    runBatchQueue(remainingFrames).then(() => {
      if (preloaderSubtext) preloaderSubtext.textContent = 'All 192 frames loaded';
      dismissPreloader();
    });
  }

  // Start preloading as soon as DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startPreloading);
  } else {
    startPreloading();
  }

  // --- Keyboard Navigation Support ---
  window.addEventListener('keydown', (e) => {
    const scrollStep = window.innerHeight * 0.25;
    if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
      window.scrollBy({ top: scrollStep, behavior: 'smooth' });
      e.preventDefault();
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      window.scrollBy({ top: -scrollStep, behavior: 'smooth' });
      e.preventDefault();
    } else if (e.key === 'Home') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      e.preventDefault();
    } else if (e.key === 'End') {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
      e.preventDefault();
    }
  });

})();
