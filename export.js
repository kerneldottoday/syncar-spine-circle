'use strict';

/**
 * SyncAR Spine — Animation Frame Exporter
 *
 * Captures each frame of the animation with a true alpha channel by:
 *   1. Opening index-alpha.html in headless Chromium via Puppeteer
 *   2. Pausing GSAP's global timeline and seeking frame-by-frame
 *   3. Screenshotting each frame as a PNG with omitBackground: true
 *   4. Assembling the PNG sequence into WebM VP9+alpha via FFmpeg
 *
 * The resulting .webm or raw frame sequence can then be converted to
 * ProRes 4444 for After Effects / Final Cut Pro (see README.md).
 *
 * Prerequisites:
 *   - Node.js 16+  →  npm install
 *   - HTTP server on port 8765  →  python -m http.server 8765
 *   - FFmpeg in PATH (for video assembly step)
 *
 * Usage:
 *   node export.js
 */

const puppeteer    = require('puppeteer');
const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

/* ─────────────────────────────────────────────────────────────────────
   CONFIGURATION  — adjust before running
───────────────────────────────────────────────────────────────────── */
const CONFIG = {
  // URL of the alpha-background version of the animation
  url: 'http://localhost:8765/syncar-circle/index-alpha.html',

  // Capture parameters
  fps:      30,
  duration: 19,     // seconds — animation ends ~16.5 s; 19 s adds tail buffer

  // Output
  framesDir:   path.join(__dirname, 'frames'),
  outputWebm:  path.join(__dirname, 'syncar-spine-alpha.webm'),

  // Viewport
  width:  1920,
  height: 1080,

  // Particles are driven by requestAnimationFrame independently of GSAP
  // time, so they would be misaligned during frame-by-frame scrubbing.
  // Set to false only if you add rAF-sync logic yourself.
  hideParticles: true,
};

/* ─────────────────────────────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────────────────────────────── */
function zeroPad(n, w) {
  return String(n).padStart(w, '0');
}

function progressBar(done, total, width = 32) {
  const filled = Math.round((done / total) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function hasFFmpeg() {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

/* ─────────────────────────────────────────────────────────────────────
   STEP 1 — CAPTURE FRAMES
   Opens the page, pauses GSAP at t=0, then scrubs through every frame
   taking a transparent PNG screenshot at each step.
───────────────────────────────────────────────────────────────────── */
async function captureFrames() {
  // Prepare (or clean) the frames directory
  if (!fs.existsSync(CONFIG.framesDir)) {
    fs.mkdirSync(CONFIG.framesDir, { recursive: true });
  } else {
    const stale = fs.readdirSync(CONFIG.framesDir).filter(f => f.endsWith('.png'));
    if (stale.length > 0) {
      process.stdout.write(`  Cleaning ${stale.length} existing frame(s)…`);
      stale.forEach(f => fs.unlinkSync(path.join(CONFIG.framesDir, f)));
      console.log(' done.');
    }
  }

  console.log('\n→ Launching Chromium…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--force-device-scale-factor=1',
      '--font-render-hinting=none',     // crisper text rendering
    ],
    defaultViewport: { width: CONFIG.width, height: CONFIG.height },
  });

  try {
    const page = await browser.newPage();

    // ── Force a transparent compositor background via CDP ──────────────
    // Combined with omitBackground:true in screenshot(), this gives
    // genuine RGBA PNGs even when CSS sets background: transparent.
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', {
      color: { r: 0, g: 0, b: 0, a: 0 },
    });

    console.log(`→ Loading ${CONFIG.url}`);
    await page.goto(CONFIG.url, { waitUntil: 'networkidle2', timeout: 30_000 });

    // Let Google Fonts and the first GSAP tick settle
    await new Promise(r => setTimeout(r, 900));

    // ── Pause GSAP at time 0 ────────────────────────────────────────────
    // gsap.globalTimeline is the root timeline that owns ALL tweens and
    // sub-timelines (including the breathing loop and main sequence).
    // suppressEvents=true prevents onStart/onComplete audio callbacks
    // from firing during scrubbing.
    await page.evaluate((hideParticles) => {
      if (hideParticles) {
        const canvas = document.getElementById('bg-particles');
        if (canvas) canvas.style.display = 'none';
      }
      gsap.globalTimeline.pause(0, true);
    }, CONFIG.hideParticles);

    const totalFrames = Math.ceil(CONFIG.fps * CONFIG.duration);
    console.log(`→ Capturing ${totalFrames} frames @ ${CONFIG.fps} fps (${CONFIG.duration} s)\n`);

    for (let f = 0; f < totalFrames; f++) {
      const t = f / CONFIG.fps;

      // Seek the entire GSAP root to this exact time
      await page.evaluate((time) => {
        gsap.globalTimeline.time(time, true);
      }, t);

      // Wait two rAF ticks — the browser needs at least one full render
      // cycle after GSAP updates properties before we can screenshot.
      await page.evaluate(() =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
      );

      // Capture with transparent background
      const framePath = path.join(CONFIG.framesDir, `frame_${zeroPad(f, 5)}.png`);
      await page.screenshot({ path: framePath, omitBackground: true });

      // Update progress every 5 frames
      if (f % 5 === 0 || f === totalFrames - 1) {
        const pct = (((f + 1) / totalFrames) * 100).toFixed(1);
        process.stdout.write(
          `\r  ${progressBar(f + 1, totalFrames)} ${pct.padStart(5)} %  ` +
          `frame ${String(f + 1).padStart(4)} / ${totalFrames}`
        );
      }
    }

    console.log('\n\n✓ Frame capture complete.\n');
  } finally {
    await browser.close();
  }
}

/* ─────────────────────────────────────────────────────────────────────
   STEP 2 — ASSEMBLE VIDEO
   Encodes the PNG sequence into WebM with VP9 + alpha.
   VP9 is the only web-native codec that supports a true alpha channel
   and is universally accepted by FFmpeg as an intermediate for ProRes.

   CRF 10  = visually lossless (range 0–63; lower = better quality)
   -auto-alt-ref 0  required for alpha support in VP9
───────────────────────────────────────────────────────────────────── */
function assembleVideo() {
  if (!hasFFmpeg()) {
    console.warn('⚠  FFmpeg not found in PATH — skipping video assembly.');
    console.warn('   Install FFmpeg then run:\n');
    printFFmpegCommands(false);
    return false;
  }

  const relFrames  = path.relative(process.cwd(), CONFIG.framesDir);
  const relWebm    = path.relative(process.cwd(), CONFIG.outputWebm);

  const cmd = [
    'ffmpeg', '-y',
    '-framerate', CONFIG.fps,
    '-i',         `"${relFrames}/frame_%05d.png"`,
    '-c:v',       'libvpx-vp9',
    '-pix_fmt',   'yuva420p',
    '-b:v',       '0',
    '-crf',       '10',
    '-auto-alt-ref', '0',
    `"${relWebm}"`,
  ].join(' ');

  console.log(`→ Assembling WebM (VP9 + alpha)…`);
  console.log(`  ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit', cwd: __dirname });

  const size = (fs.statSync(CONFIG.outputWebm).size / 1_048_576).toFixed(1);
  console.log(`\n✓ WebM saved → ${relWebm}  (${size} MB)`);
  return true;
}

/* ─────────────────────────────────────────────────────────────────────
   SUMMARY — print next-step commands after a successful run
───────────────────────────────────────────────────────────────────── */
function printFFmpegCommands(webmAvailable) {
  const relWebm   = path.relative(process.cwd(), CONFIG.outputWebm) || CONFIG.outputWebm;
  const relFrames = path.relative(process.cwd(), CONFIG.framesDir)  || CONFIG.framesDir;

  console.log('─────────────────────────────────────────────────────────────');
  console.log('  CONVERT TO ProRes 4444  (After Effects / Final Cut Pro)\n');

  if (webmAvailable) {
    console.log('  Option A — from WebM (quick):');
    console.log(`    ffmpeg -i "${relWebm}" \\`);
    console.log('      -c:v prores_ks -profile:v 4444 \\');
    console.log('      -pix_fmt yuva444p10le -vendor apl0 \\');
    console.log('      syncar-spine-prores4444.mov\n');
  }

  console.log(`  Option ${webmAvailable ? 'B' : 'A'} — from PNG frames (highest quality, no intermediate loss):`);
  console.log(`    ffmpeg -framerate ${CONFIG.fps} -i "${relFrames}/frame_%05d.png" \\`);
  console.log('      -c:v prores_ks -profile:v 4444 \\');
  console.log('      -pix_fmt yuva444p10le -vendor apl0 \\');
  console.log('      syncar-spine-prores4444.mov\n');

  console.log('  See README.md for trim, quality, and import instructions.');
  console.log('─────────────────────────────────────────────────────────────\n');
}

/* ─────────────────────────────────────────────────────────────────────
   MAIN
───────────────────────────────────────────────────────────────────── */
(async () => {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   SyncAR Spine — Animation Frame Exporter   ║');
  console.log('╚══════════════════════════════════════════════╝');

  const t0 = Date.now();

  try {
    await captureFrames();
    const webmOk = assembleVideo();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    console.log(`\n✓ Total time: ${elapsed} s\n`);
    printFFmpegCommands(webmOk);
  } catch (err) {
    console.error('\n✗ Export failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
