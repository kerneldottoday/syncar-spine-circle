/* ─────────────────────────────────────────────────────────────
   SyncAR Spine — Surgical Theater
   animation.js  (v3 — client meeting update)
   Requires: GSAP 3 (loaded via CDN before this file)
───────────────────────────────────────────────────────────── */

/* ═══════════════════════════════════════════════════════════════
   1. SCENE SCALE
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
═══════════════════════════════════════════════════════════════ */
(function initParticles() {
  const canvas = document.getElementById('bg-particles');
  const ctx    = canvas.getContext('2d');
  canvas.width  = 1920;
  canvas.height = 1080;

  const dots = Array.from({ length: 20 }, () => ({
    x:  Math.random() * 1920,
    y:  Math.random() * 1080,
    r:  Math.random() * 1.4 + 0.5,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    a:  Math.random() * 0.08 + 0.07,
  }));

  function tick() {
    ctx.clearRect(0, 0, 1920, 1080);
    for (const d of dots) {
      d.vx += (Math.random() - 0.5) * 0.018;
      d.vy += (Math.random() - 0.5) * 0.018;
      d.vx = Math.max(-0.42, Math.min(0.42, d.vx));
      d.vy = Math.max(-0.42, Math.min(0.42, d.vy));
      d.x += d.vx;
      d.y += d.vy;
      if (d.x < -1)   d.x = 1921;
      if (d.x > 1921) d.x = -1;
      if (d.y < -1)   d.y = 1081;
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
═══════════════════════════════════════════════════════════════ */
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playBlip() {
  try {
    const ctx      = getAudioCtx();
    const now      = ctx.currentTime;
    const duration = 0.08;
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.04);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  } catch (_) { /* silent */ }
}


/* ═══════════════════════════════════════════════════════════════
   4. GSAP TIMELINE
═══════════════════════════════════════════════════════════════ */

const ORIGIN = '960 540';

// ── Selectors ───────────────────────────────────────────────
const seg1 = '#seg-1', seg2 = '#seg-2', seg3 = '#seg-3';
const lbl1 = '#label-1', lbl2 = '#label-2', lbl3 = '#label-3';
const swp1 = '#sweep-1', swp2 = '#sweep-2', swp3 = '#sweep-3';

// New: segment→glow mapping (colours reassigned per v3 layout)
// seg-1 = Surgical Planning   → red/orange glow
// seg-2 = Intraoperative Exec → gold glow
// seg-3 = Patient Engagement  → purple glow
const glowRed    = '#glow-red feDropShadow';
const glowGold   = '#glow-gold feDropShadow';
const glowPurple = '#glow-purple feDropShadow';

// ── Initial states ───────────────────────────────────────────
gsap.set([seg1, seg2, seg3, lbl1, lbl2, lbl3, '#center-group'], { opacity: 0 });
gsap.set('#end-frame',    { opacity: 0 });
gsap.set('#end-cursor',   { opacity: 0 });
gsap.set('#end-subtitle', { opacity: 0.7 });
gsap.set('#end-company',  { opacity: 0.55 });

// Pre-attach glow filters (invisible at start)
gsap.set(seg1, { attr: { filter: 'url(#glow-red)'    } });
gsap.set(seg2, { attr: { filter: 'url(#glow-gold)'   } });
gsap.set(seg3, { attr: { filter: 'url(#glow-purple)' } });
gsap.set(glowRed,    { attr: { stdDeviation: 0, 'flood-opacity': 0 } });
gsap.set(glowGold,   { attr: { stdDeviation: 0, 'flood-opacity': 0 } });
gsap.set(glowPurple, { attr: { stdDeviation: 0, 'flood-opacity': 0 } });

// Sweeps invisible at rest
gsap.set([swp1, swp2, swp3], { opacity: 0 });

// Banners: initial positions (off-screen, opacity 0)
gsap.set('#banner-patient',  { opacity: 0, x: -70 });
gsap.set('#banner-surgical', { opacity: 0, x:  70 });
gsap.set('#banner-intraop',  { opacity: 0, xPercent: -50, y: 70 });


/* ── Helper: arc sweep ──────────────────────────────────────
   dasharray 145 708  (arc ≈ 853px at r=425, 115°)
   offset: 145 → -708
──────────────────────────────────────────────────────────── */
function sweepArc(sweepId, atTime) {
  tl.fromTo(
    sweepId,
    { attr: { 'stroke-dashoffset': 145 }, opacity: 0.28 },
    { attr: { 'stroke-dashoffset': -708 }, opacity: 0,
      duration: 0.45, ease: 'power1.inOut' },
    atTime
  );
}

/* ── Helper: segment activation block ──────────────────────
   Switches fill to gradient URL immediately (can't tween URLs),
   then animates glow + scale pulse + arc sweep.
──────────────────────────────────────────────────────────── */
function activateBlock(segId, sweepId, gradientUrl, glowSel, atTime,
                       glowDev = 20, glowOpacity = 0.9) {
  tl
    // Instant fill switch to gradient
    .set(segId, { attr: { fill: gradientUrl } }, atTime)

    // Glow fade-in + blip
    .to(glowSel, {
      attr: { stdDeviation: glowDev, 'flood-opacity': glowOpacity },
      duration: 0.5,
      ease: 'power2.out',
      onStart: playBlip,
    }, atTime)

    // Scale pulse
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


// ── 2s  Patient Engagement (upper-left, seg-3) lights up FIRST ──
activateBlock(seg3, swp3, 'url(#grad-patient)', glowPurple, 2, 18, 0.85);
tl.to('#banner-patient', {
  opacity: 1, x: 0, duration: 0.5, ease: 'power2.out',
}, 2);


// ── 4.5s  Surgical Planning (upper-right, seg-1) lights up SECOND ──
activateBlock(seg1, swp1, 'url(#grad-surgical)', glowRed, 4.5);
tl.to('#banner-surgical', {
  opacity: 1, x: 0, duration: 0.5, ease: 'power2.out',
}, 4.5);


// ── 7s  Intraoperative Execution (bottom, seg-2) lights up THIRD ──
activateBlock(seg2, swp2, 'url(#grad-intraop)', glowGold, 7);
tl.to('#banner-intraop', {
  opacity: 1, y: 0, duration: 0.5, ease: 'power2.out',
}, 7);


// ── 9s  Unified soft pulse — all 3 together ─────────────────
tl.to([seg1, seg2, seg3], {
    scale: 1.015, svgOrigin: ORIGIN,
    duration: 0.45, ease: 'sine.out',
  }, 9)
  .to([seg1, seg2, seg3], {
    scale: 1, svgOrigin: ORIGIN,
    duration: 0.45, ease: 'sine.in',
  }, 9.45);


// ── 12s  Circle + banners fade out ──────────────────────────
tl.to('#diagram', {
  opacity: 0, duration: 1.5, ease: 'power2.inOut',
}, 12);
tl.to(['#banner-patient', '#banner-surgical', '#banner-intraop'], {
  opacity: 0, duration: 1, ease: 'power2.inOut',
}, 12);


// ── 13.5s  End frame fades in ────────────────────────────────
tl.to('#end-frame', {
  opacity: 1, duration: 1.2, ease: 'power2.out',
}, 13.5);


// ── 14.7s  Cursor blinks 3× then fades away ─────────────────
tl.fromTo('#end-cursor',
    { opacity: 1 },
    { opacity: 0, duration: 0.38, ease: 'none', yoyo: true, repeat: 5 },
    14.7
  )
  .to('#end-cursor', {
    opacity: 0, duration: 0.55, ease: 'power2.out',
  });


// ── 20s hold marker (keeps timeline alive to ~20s) ──────────
tl.set({}, {}, 20);


/* ═══════════════════════════════════════════════════════════════
   5. SPINE MODEL — breathing + continuous rotation
   Breathing (scale 1→1.03→1) on center-group.
   Rotation (360° / 20s, infinite) also on center-group.
   Both use svgOrigin '960 540'; GSAP 3 composes them correctly.
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

const rotationTween = gsap.to('#center-group', {
  rotation: 360,
  svgOrigin: ORIGIN,
  duration: 20,
  ease: 'none',
  repeat: -1,
});

// Kill infinite tweens after the diagram has fully faded out
tl.call(() => {
  breathingTween.kill();
  rotationTween.kill();
}, null, 14.7);
