/* ─────────────────────────────────────────────────────────────
   SyncAR Spine — Surgical Theater
   animation.js
   Requires: GSAP 3 (loaded via CDN before this file)
───────────────────────────────────────────────────────────── */

/* ═══════════════════════════════════════════════════════════════
   1. SCENE SCALE
   Fit the 1920 × 1080 scene to the viewport with letterboxing.
═══════════════════════════════════════════════════════════════ */
const SCENE_W = 1920;
const SCENE_H = 1080;
const scene   = document.getElementById('scene');

function scaleScene() {
  const scale = Math.min(
    window.innerWidth  / SCENE_W,
    window.innerHeight / SCENE_H
  );
  scene.style.transform = `scale(${scale})`;
}

scaleScene();
window.addEventListener('resize', scaleScene);


/* ═══════════════════════════════════════════════════════════════
   2. PARTICLE BACKGROUND
   20 white dots drifting slowly across the 1920×1080 canvas.
   Each has a slight random-walk velocity to avoid mechanical
   straight-line movement. No connections — keep it minimal.
═══════════════════════════════════════════════════════════════ */
(function initParticles() {
  const canvas = document.getElementById('bg-particles');
  const ctx    = canvas.getContext('2d');
  canvas.width  = 1920;
  canvas.height = 1080;

  const PARTICLE_COUNT = 20;

  const dots = Array.from({ length: PARTICLE_COUNT }, () => ({
    x:  Math.random() * 1920,
    y:  Math.random() * 1080,
    r:  Math.random() * 1.4 + 0.5,               // radius 0.5 – 1.9 px
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    a:  Math.random() * 0.08 + 0.07,             // opacity 0.07 – 0.15
  }));

  function tick() {
    ctx.clearRect(0, 0, 1920, 1080);

    for (const d of dots) {
      // Gentle random-walk: nudge velocity slightly each frame
      d.vx += (Math.random() - 0.5) * 0.018;
      d.vy += (Math.random() - 0.5) * 0.018;
      // Soft speed clamp so they never rush
      d.vx = Math.max(-0.42, Math.min(0.42, d.vx));
      d.vy = Math.max(-0.42, Math.min(0.42, d.vy));

      d.x += d.vx;
      d.y += d.vy;

      // Wrap around edges with a 1px buffer
      if (d.x < -1) d.x = 1921;
      if (d.x > 1921) d.x = -1;
      if (d.y < -1) d.y = 1081;
      if (d.y > 1081) d.y = -1;

      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${d.a.toFixed(3)})`;
      ctx.fill();
    }

    requestAnimationFrame(tick);
  }

  tick();
}());


/* ═══════════════════════════════════════════════════════════════
   3. WEB AUDIO — activation blip
   Lazy AudioContext. 880 Hz sine, 80 ms, gain 0.15, linear
   fade-out over the last 40 ms. Silent fail if unavailable.
═══════════════════════════════════════════════════════════════ */
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playBlip() {
  try {
    const ctx      = getAudioCtx();
    const now      = ctx.currentTime;
    const duration = 0.08;
    const holdUntil = now + 0.04;

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type            = 'sine';
    osc.frequency.value = 880;

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.linearRampToValueAtTime(0.15, holdUntil);
    gain.gain.linearRampToValueAtTime(0,    now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  } catch (_) { /* silent */ }
}


/* ═══════════════════════════════════════════════════════════════
   4. GSAP TIMELINE
═══════════════════════════════════════════════════════════════ */

// SVG circle centre — anchor for all scale transforms
const ORIGIN = '960 540';

// ── Selectors ───────────────────────────────────────────────
const seg1 = '#seg-1', seg2 = '#seg-2', seg3 = '#seg-3';
const lbl1 = '#label-1', lbl2 = '#label-2', lbl3 = '#label-3';
const swp1 = '#sweep-1', swp2 = '#sweep-2', swp3 = '#sweep-3';
const glowRed    = '#glow-red feDropShadow';
const glowPurple = '#glow-purple feDropShadow';
const glowGold   = '#glow-gold feDropShadow';

// ── Initial states ───────────────────────────────────────────
gsap.set([seg1, seg2, seg3, lbl1, lbl2, lbl3,
          '#center-group'], { opacity: 0 });

gsap.set('#end-frame',   { opacity: 0 });
gsap.set('#end-cursor',  { opacity: 0 });
gsap.set('#end-subtitle',{ opacity: 0.7 });

// Filters pre-attached (invisible at start)
gsap.set(seg1, { attr: { filter: 'url(#glow-red)'    } });
gsap.set(seg2, { attr: { filter: 'url(#glow-purple)' } });
gsap.set(seg3, { attr: { filter: 'url(#glow-gold)'   } });
gsap.set(glowRed,    { attr: { stdDeviation: 0, 'flood-opacity': 0 } });
gsap.set(glowPurple, { attr: { stdDeviation: 0, 'flood-opacity': 0 } });
gsap.set(glowGold,   { attr: { stdDeviation: 0, 'flood-opacity': 0 } });

// Sweeps invisible at rest
gsap.set([swp1, swp2, swp3], { opacity: 0 });


/* ── Helper: arc sweep ──────────────────────────────────────
   White highlight (120px stroke) sweeps along midline in 0.45s.
   Dasharray: 65 bright + 312 gap = 377 ≈ arc length at r=188, 115°.
──────────────────────────────────────────────────────────── */
function sweepArc(sweepId, atTime) {
  tl.fromTo(
    sweepId,
    { attr: { 'stroke-dashoffset': 130 }, opacity: 0.28 },
    { attr: { 'stroke-dashoffset': -624 }, opacity: 0,
      duration: 0.45, ease: 'power1.inOut' },
    atTime
  );
}

/* ── Helper: segment activation block ──────────────────────
   Color change + glow fade-in + scale pulse + arc sweep.
   glowDev / glowOpacity let each segment tune its own glow.
──────────────────────────────────────────────────────────── */
function activateBlock(segId, sweepId, color, glowSel, atTime,
                       glowDev = 20, glowOpacity = 0.9) {
  tl
    .to(segId, {
      attr: { fill: color },
      duration: 0.45,
      ease: 'power2.out',
      onStart: playBlip,
    }, atTime)

    .to(glowSel, {
      attr: { stdDeviation: glowDev, 'flood-opacity': glowOpacity },
      duration: 0.5,
      ease: 'power2.out',
    }, atTime)

    .to(segId, {
      scale: 1.02, svgOrigin: ORIGIN,
      duration: 0.3, ease: 'sine.out',
    }, atTime + 0.1)

    .to(segId, {
      scale: 1, svgOrigin: ORIGIN,
      duration: 0.3, ease: 'sine.in',
    }, atTime + 0.4);

  sweepArc(sweepId, atTime);
}


/* ── Main timeline ──────────────────────────────────────────── */
const tl = gsap.timeline();

// ── 0s  Fade in everything in muted state ───────────────────
tl.to([seg1, seg2, seg3], {
    opacity: 1, duration: 1, ease: 'power2.out',
  }, 0)
  .to([lbl1, lbl2, lbl3], {
    opacity: 1, duration: 1, ease: 'power2.out',
  }, 0.15)
  .to('#center-group', {
    opacity: 1, duration: 1, ease: 'power2.out',
  }, 0.3);


// ── 2s  Pre-Operative → bright red ──────────────────────────
activateBlock(seg1, swp1, '#E8163A', glowRed, 2);

// ── 4.5s  Patient Engagement → bright vivid purple ──────────
activateBlock(seg2, swp2, '#9B30FF', glowPurple, 4.5, 18, 0.85);

// ── 7s  Intra-Operative → bright vivid gold ─────────────────
activateBlock(seg3, swp3, '#F0B400', glowGold, 7);

// ── 9s  Unified soft pulse — all 3 together ─────────────────
tl.to([seg1, seg2, seg3], {
    scale: 1.015, svgOrigin: ORIGIN,
    duration: 0.45, ease: 'sine.out',
  }, 9)
  .to([seg1, seg2, seg3], {
    scale: 1, svgOrigin: ORIGIN,
    duration: 0.45, ease: 'sine.in',
  }, 9.45);

// ── 11s  Circle fades out ────────────────────────────────────
tl.to('#diagram', {
  opacity: 0, duration: 1.5, ease: 'power2.inOut',
}, 11);

// ── 12.5s  End frame fades in ────────────────────────────────
tl.to('#end-frame', {
  opacity: 1, duration: 1.2, ease: 'power2.out',
}, 12.5);

// ── 13.7s  Cursor blinks 3× then fades away ─────────────────
// Starts AFTER the end-frame fade-in completes (12.5s + 1.2s = 13.7s)
// so the blinks are visible against the fully-opaque parent.
// fromTo locks the "from" state precisely — no ambiguity.
// 3 full blinks: appear→off, off→on, on→off, off→on, on→off, off→on
// = repeat:5 yoyo = 6 half-cycles × 0.38s = 2.28s
// Final fade: 0.55s  |  Total cursor life ≈ 2.83s after frame appears
tl.fromTo('#end-cursor',
    { opacity: 1 },
    { opacity: 0, duration: 0.38, ease: 'none', yoyo: true, repeat: 5 },
    13.7
  )
  .to('#end-cursor', {
    opacity: 0,
    duration: 0.55,
    ease: 'power2.out',
  });


/* ═══════════════════════════════════════════════════════════════
   5. BREATHING EFFECT — center spine model
   Subtle scale 1 → 1.03 → 1, 4s period, infinite loop.
   Starts with a 1.3s delay so it doesn't fight the initial
   opacity fade-in. Anchored to the circle's centre (960, 540).
   Killed automatically when the diagram fades out at t=11s.
═══════════════════════════════════════════════════════════════ */
const breathingTween = gsap.to('#center-group', {
  scale: 1.03,
  svgOrigin: ORIGIN,
  duration: 2,
  ease: 'sine.inOut',
  yoyo: true,
  repeat: -1,
  delay: 1.3,
});

// Stop the infinite breathing loop once the diagram has fully faded out,
// so it doesn't waste resources on an invisible element.
tl.call(() => breathingTween.kill(), null, 12.5);
