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
 * - Mobile optimizations: reduced frame count, touch scroll, lazy loading
 */

(function () {
  'use strict';

  // --- Configuration ---
  const TOTAL_FRAMES = 192;
  const CONCURRENT_DOWNLOADS = 6;
  const MIN_FRAMES_TO_START = 8;
  const PRELOADER_MAX_WAIT = 4000;

  // --- Device tiering: fewer frames + lower render cost on phones/tablets ---
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const width = window.innerWidth;

  let TIER = 'desktop';
  if (width < 560 || (isTouch && width < 820) || cores <= 4 || memory <= 2) {
    TIER = 'low';
  } else if (width < 1024 || isTouch || cores <= 6 || memory <= 4) {
    TIER = 'mid';
  }

  const PROFILE = {
    low:     { frames: 28, dpr: 1,   lerp: 0.22, smooth: false, eager: 20 },
    mid:     { frames: 48, dpr: 1.25, lerp: 0.16, smooth: false, eager: 30 },
    desktop: { frames: 96, dpr: 2,   lerp: 0.11, smooth: true,  eager: 40 }
  }[TIER];

  const isMobile = TIER !== 'desktop';
  const LERP_EASE = PROFILE.lerp;
  const MOBILE_FRAME_COUNT = PROFILE.frames;
  const MOBILE_FRAME_STEP = TOTAL_FRAMES / MOBILE_FRAME_COUNT;

  // --- DOM Elements ---
  const canvas = document.getElementById('sequence-canvas');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }); // alpha: false optimizes rendering
  const timelineProgress = document.getElementById('timeline-progress');
  const frameCurrentEl = document.getElementById('frame-current');
  const framePctEl = document.getElementById('frame-pct');
  const scrollPrompt = document.getElementById('scroll-prompt');
  
  // Mobile nav elements
  const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
  const mainNav = document.getElementById('main-nav');
  const navLinks = document.querySelectorAll('.nav-link');

  // Preloader elements
  const preloader = document.getElementById('preloader');
  const loadPercentageEl = document.getElementById('load-percentage');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const spinnerFill = document.getElementById('spinner-fill');
  const preloaderSubtext = document.getElementById('preloader-subtext');

  // SVG spinner circumference: 2 * PI * r = 2 * 3.14159 * 20 = 125.66
  const SPINNER_CIRCUMFERENCE = 125.66;

  // --- State Variables ---
  const frameImages = new Array(MOBILE_FRAME_COUNT);
  let loadedCount = 0;
  let targetProgress = 0;
  let currentProgress = 0;
  let lastDrawnIndex = -1;
  let isPreloaderDismissed = false;
  let needsRedraw = true;
  let isScrolling = false;
  let scrollTimeout = null;

  // --- Helper: Generate frame URL (1-indexed zero-padded) ---
  function getFrameUrl(index) {
    // Map mobile frame index to actual frame number
    const actualFrameIndex = Math.min(
      TOTAL_FRAMES - 1,
      Math.round(index * MOBILE_FRAME_STEP)
    );
    const frameNum = String(actualFrameIndex + 1).padStart(6, '0');
    return `video_frames_png/frame_${frameNum}.png`;
  }

  // --- Initialize Frame Placeholders ---
  for (let i = 0; i < MOBILE_FRAME_COUNT; i++) {
    frameImages[i] = {
      index: i,
      actualIndex: Math.min(TOTAL_FRAMES - 1, Math.round(i * MOBILE_FRAME_STEP)),
      img: new Image(),
      loaded: false,
      failed: false
    };
  }

  // --- Canvas Sizing & Responsive Fit ---
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, PROFILE.dpr);
    const displayWidth = window.innerWidth;
    const displayHeight = window.innerHeight;

    if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
      canvas.width = Math.round(displayWidth * dpr);
      canvas.height = Math.round(displayHeight * dpr);
      canvas.style.width = displayWidth + 'px';
      canvas.style.height = displayHeight + 'px';
      ctx.imageSmoothingEnabled = PROFILE.smooth;
      ctx.imageSmoothingQuality = PROFILE.smooth ? 'high' : 'low';
      needsRedraw = true;
    }
  }

  window.addEventListener('resize', debounce(resizeCanvas, 150), { passive: true });
  resizeCanvas();

  // Debounce helper
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // --- Frame Search Fallback ---
  function getBestAvailableFrame(requestedIdx) {
    if (frameImages[requestedIdx] && frameImages[requestedIdx].loaded) {
      return frameImages[requestedIdx].img;
    }

    // Bidirectional search outward for the nearest cached frame
    let offset = 1;
    while (requestedIdx - offset >= 0 || requestedIdx + offset < MOBILE_FRAME_COUNT) {
      const prevIdx = requestedIdx - offset;
      if (prevIdx >= 0 && frameImages[prevIdx] && frameImages[prevIdx].loaded) {
        return frameImages[prevIdx].img;
      }
      const nextIdx = requestedIdx + offset;
      if (nextIdx < MOBILE_FRAME_COUNT && frameImages[nextIdx] && frameImages[nextIdx].loaded) {
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
    const displayFrameNum = frameImages[frameIdx] 
      ? frameImages[frameIdx].actualIndex + 1 
      : Math.round(progress * TOTAL_FRAMES);
    const paddedFrame = String(displayFrameNum).padStart(3, '0');
    
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
    
    // Touch scroll handling
    isScrolling = true;
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
    }, 150);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  // Initial check
  onScroll();

  // NOTE: Scroll-linked canvas relies on the browser's own native touch
  // scrolling. Never call window.scrollTo() inside touchmove — it kills
  // momentum/inertia and forces synchronous layout every event, which is the
  // main cause of the stuttery feel on phones and tablets.

  // --- Physics-based Main Animation Loop (rAF) ---
  let rafId = null;
  let isPaused = false;

  function tick() {
    const diff = targetProgress - currentProgress;

    if (Math.abs(diff) > 0.0001) {
      currentProgress += diff * LERP_EASE;
    } else {
      currentProgress = targetProgress;
    }

    const activeIndex = Math.min(
      MOBILE_FRAME_COUNT - 1,
      Math.max(0, Math.round(currentProgress * (MOBILE_FRAME_COUNT - 1)))
    );

    if (activeIndex !== lastDrawnIndex || needsRedraw) {
      drawFrame(activeIndex);
      lastDrawnIndex = activeIndex;
      updateUI(activeIndex, currentProgress);
      prefetchAroundScroll();
    }

    rafId = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (rafId === null && !isPaused) rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // Don't burn battery/CPU animating a background nobody can see.
  document.addEventListener('visibilitychange', () => {
    isPaused = document.hidden;
    if (isPaused) {
      stopLoop();
    } else {
      needsRedraw = true;
      startLoop();
    }
  });

  startLoop();

  // --- Progressive Preloader Architecture ---
  function updatePreloaderProgress() {
    const pct = Math.min(100, Math.round((loadedCount / MOBILE_FRAME_COUNT) * 100));

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
        console.warn(`Failed to load frame ${item.actualIndex + 1}`);
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

  // --- Lazy windowed frame loading ---
  // Frames are fetched in a window around the current scroll position instead
  // of streaming the whole sequence. This keeps memory and network flat on
  // phones/tablets, which is what makes the scrub feel smooth.
  const pending = new Set();

  function requestFrameRange(centerIdx) {
    if (centerIdx < 0 || centerIdx >= MOBILE_FRAME_COUNT) return;
    const half = Math.ceil(MOBILE_FRAME_COUNT * 0.35);
    const start = Math.max(0, centerIdx - half);
    const end = Math.min(MOBILE_FRAME_COUNT - 1, centerIdx + half);
    for (let i = start; i <= end; i++) {
      const item = frameImages[i];
      if (item && !item.loaded && !item.failed && !pending.has(i)) {
        pending.add(i);
        loadSingleFrame(i).finally(() => pending.delete(i));
      }
    }
  }

  // --- Preloading Sequence ---
  async function startPreloading() {
    // 1. First frame: Immediate priority so the page paints instantly
    await loadSingleFrame(0);
    drawFrame(0);

    // 2. Sparse keyframes across the whole sequence so any scroll position has
    //    a real frame to fall back on (prevents long blank stretches).
    const keyframes = [];
    const keyframeStep = Math.max(1, Math.floor(MOBILE_FRAME_COUNT / 8));
    for (let i = 0; i < MOBILE_FRAME_COUNT; i += keyframeStep) {
      if (i !== 0) keyframes.push(i);
    }
    if (!keyframes.includes(MOBILE_FRAME_COUNT - 1)) {
      keyframes.push(MOBILE_FRAME_COUNT - 1);
    }

    await runBatchQueue(keyframes);

    // 3. Load the opening window (most likely first thing a visitor scrubs to)
    const eagerCount = Math.min(PROFILE.eager, MOBILE_FRAME_COUNT);
    const opening = [];
    for (let i = 1; i < eagerCount; i++) {
      if (!keyframes.includes(i)) opening.push(i);
    }
    runBatchQueue(opening);
  }

  // Keep a window of frames warm around wherever the user currently is.
  let lastWindowCenter = -999;
  function prefetchAroundScroll() {
    const idx = Math.round(targetProgress * (MOBILE_FRAME_COUNT - 1));
    if (idx === lastWindowCenter) return;
    lastWindowCenter = idx;
    requestFrameRange(idx);
  }

  // Start preloading as soon as DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startPreloading);
  } else {
    startPreloading();
  }

  // Fallback: Force dismiss preloader after max wait time
  setTimeout(() => {
    if (!isPreloaderDismissed) {
      console.log('Preloader timeout reached, dismissing...');
      dismissPreloader();
    }
  }, PRELOADER_MAX_WAIT);

  // --- Mobile Navigation Toggle ---
  function toggleMobileMenu() {
    const isExpanded = mobileMenuToggle.getAttribute('aria-expanded') === 'true';
    mobileMenuToggle.setAttribute('aria-expanded', !isExpanded);
    mainNav.classList.toggle('is-open');
    document.body.style.overflow = isExpanded ? '' : 'hidden';
  }

  function closeMobileMenu() {
    mobileMenuToggle.setAttribute('aria-expanded', 'false');
    mainNav.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  if (mobileMenuToggle && mainNav) {
    mobileMenuToggle.addEventListener('click', toggleMobileMenu);

    // Close menu when clicking nav links
    navLinks.forEach(link => {
      link.addEventListener('click', closeMobileMenu);
    });

    // Close menu on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mainNav.classList.contains('is-open')) {
        closeMobileMenu();
      }
    });

    // Close menu when clicking backdrop
    const navBackdrop = mainNav.querySelector('.nav-backdrop');
    if (navBackdrop) {
      navBackdrop.addEventListener('click', closeMobileMenu);
    }
  }

  // --- Keyboard Navigation Support ---
  window.addEventListener('keydown', (e) => {
    // Don't interfere with form inputs, buttons, links, or contenteditable
    const target = e.target;
    if (target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.tagName === 'SELECT' ||
        target.tagName === 'BUTTON' ||
        target.tagName === 'A' ||
        target.isContentEditable ||
        target.closest('button, a, [role="button"]')) return;

    const scrollStep = window.innerHeight * 0.25;
    if (e.key === 'ArrowDown' || e.key === 'PageDown') {
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

  // Ensure mailto links work reliably
  document.querySelectorAll('a[href^="mailto:"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      window.location.href = this.getAttribute('href');
    });
  });

  // --- Minimal UI Sound Effects ---
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;

  function ensureAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new AudioContextClass();
      } catch (e) {
        return null;
      }
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playTone(frequency, duration, volume) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 329.63;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    ctx.resume().then(() => {
      osc.start();
      osc.stop(ctx.currentTime + duration);
    }).catch(() => {});
  }

  function playClick() {
    playTone(329.63, 0.45, 0.08);
  }

  document.querySelectorAll('a, button, .skill-badge, .work-card, .stat-card, .learning-card').forEach(el => {
    el.addEventListener('click', playClick, { passive: true });
  });

  // --- Smooth Scroll for Anchor Links ---
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const headerHeight = document.querySelector('.site-header').offsetHeight;
        const targetPosition = target.getBoundingClientRect().top + window.scrollY - headerHeight;
        
        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
        
        // Close mobile menu if open
        closeMobileMenu();
      }
    });
  });

  // --- Intersection Observer for Scroll Animations ---
  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -10% 0px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
      }
    });
  }, observerOptions);

  // Observe sections for scroll animations
  document.querySelectorAll('section').forEach(section => {
    observer.observe(section);
  });

  // Fallback: Make all sections visible after 600ms to prevent stuck states
  setTimeout(() => {
    document.querySelectorAll('section').forEach(section => {
      section.classList.add('is-visible');
    });
  }, 600);

  // --- Performance: promote the canvas to its own layer once ---
  // (a permanent layer avoids re-rasterising the fixed stage on every frame)
  canvas.style.willChange = 'transform';
  canvas.style.transform = 'translateZ(0)';

})();
