'use strict';
/**
 * record.js — SyncAR Spine circle → syncar-spine-animation.mp4
 *
 * Captures the full 17-second animation frame-by-frame at 30 fps
 * using a headless Chrome (Puppeteer) + FFmpeg H.264 encode.
 *
 * Usage:  node record.js
 */

const puppeteer    = require('puppeteer');
const path         = require('path');
const fs           = require('fs');
const http         = require('http');
const { execSync } = require('child_process');

// ── Config ─────────────────────────────────────────────────────────────────
const ROOT        = path.resolve(__dirname, '..'); // "mo project" parent folder
const SERVER_PORT = 3099;
const PAGE_URL    = `http://localhost:${SERVER_PORT}/syncar-circle/index.html`;
const OUTPUT_DIR  = path.join(__dirname, '_frames');
const OUTPUT_MP4  = path.join(__dirname, 'syncar-spine-animation.mp4');
const FPS         = 30;
const DURATION    = 17;             // seconds — full animation + small buffer
const TOTAL       = FPS * DURATION; // 510 frames

// ── MIME map ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.woff2':'font/woff2',
  '.ico':  'image/x-icon',
};

// ── Minimal HTTP server (range-request aware for <video>) ──────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let urlPath = req.url.split('?')[0];
      try { urlPath = decodeURIComponent(urlPath); } catch (_) {}

      const filePath = path.normalize(path.join(ROOT, urlPath));
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }

      fs.stat(filePath, (statErr, stat) => {
        if (statErr) { res.writeHead(404); res.end('Not found'); return; }

        const ext   = path.extname(filePath).toLowerCase();
        const mime  = MIME[ext] || 'application/octet-stream';
        const range = req.headers.range;

        if (range) {
          const [, s, e] = range.match(/bytes=(\d+)-(\d*)/) || [];
          const start = parseInt(s, 10);
          const end   = e ? parseInt(e, 10) : stat.size - 1;
          res.writeHead(206, {
            'Content-Range':  `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges':  'bytes',
            'Content-Length': end - start + 1,
            'Content-Type':   mime,
          });
          fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type':   mime,
            'Accept-Ranges':  'bytes',
          });
          fs.createReadStream(filePath).pipe(res);
        }
      });
    });

    srv.on('error', reject);
    srv.listen(SERVER_PORT, '127.0.0.1', () => resolve(srv));
  });
}

// ── Find FFmpeg ────────────────────────────────────────────────────────────
function getFFmpegPath() {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return 'ffmpeg'; } catch (_) {}
  try {
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) return p;
  } catch (_) {}
  throw new Error(
    'FFmpeg not found. Install it:\n' +
    '  winget install Gyan.FFmpeg\n' +
    '  or: choco install ffmpeg\n' +
    '  or: npm install --save-dev ffmpeg-static'
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
async function record() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║      SyncAR Spine — MP4 Recorder                    ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // Prep frames directory
  if (fs.existsSync(OUTPUT_DIR)) fs.rmSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR);

  // Start HTTP server so <video> src can load via HTTP
  process.stdout.write('  [1/4] Starting HTTP server ...');
  const server = await startServer();
  console.log(` port ${SERVER_PORT} ✓`);

  // Launch headless Chrome
  process.stdout.write('  [2/4] Launching headless Chrome (1920×1080) ...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1920,1080',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

  // Freeze requestAnimationFrame BEFORE page scripts run.
  // This stops the particle canvas loop so particles stay blank (clean frames).
  // GSAP manual-time API works without rAF.
  await page.evaluateOnNewDocument(() => {
    const _store = [];
    window.requestAnimationFrame = cb => { _store.push(cb); return _store.length; };
    window.cancelAnimationFrame  = () => {};
  });
  console.log(' ✓');

  process.stdout.write('  [3/4] Loading page & waiting for GSAP ...');
  await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(
    () => typeof gsap !== 'undefined' && !!document.querySelector('#seg-1'),
    { timeout: 15000 }
  );
  // Let GSAP apply all initial gsap.set() calls
  await new Promise(r => setTimeout(r, 400));

  // Pause entire global timeline and seek to t=0
  await page.evaluate(() => { gsap.globalTimeline.pause(0, true); });
  console.log(' ✓\n');

  // Frame capture loop
  console.log(`  [4/4] Capturing ${TOTAL} frames @ ${FPS} fps  (${DURATION}s)...\n`);
  const t0 = Date.now();

  for (let f = 0; f < TOTAL; f++) {
    const t = f / FPS;

    // Advance GSAP clock to exact frame time (no real-time wait needed)
    await page.evaluate(time => { gsap.globalTimeline.time(time, true); }, t);

    await page.screenshot({
      path:    path.join(OUTPUT_DIR, `frame_${String(f).padStart(5, '0')}.jpg`),
      type:    'jpeg',
      quality: 92,
    });

    if (f % FPS === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      const eta     = f > 0 ? Math.round(((Date.now()-t0)/f) * (TOTAL-f) / 1000) : '?';
      const pct     = Math.round((f / TOTAL) * 100);
      process.stdout.write(
        `\r  ${String(pct).padStart(3)}%  ${String(t.toFixed(0)).padStart(2)}s/${DURATION}s  ` +
        `elapsed: ${elapsed}s  ETA: ${eta}s   `
      );
    }
  }
  process.stdout.write(`\r  100%  ${DURATION}s/${DURATION}s  — capture done!            \n\n`);

  await browser.close();
  server.close();

  // Encode MP4
  const ffmpeg = getFFmpegPath();
  console.log('  Encoding H.264 MP4 with FFmpeg...\n');
  execSync(
    `"${ffmpeg}" -y ` +
    `-framerate ${FPS} -i "${OUTPUT_DIR}\\frame_%05d.jpg" ` +
    `-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p ` +
    `-movflags +faststart "${OUTPUT_MP4}"`,
    { stdio: 'inherit' }
  );

  // Clean up temp frames
  fs.rmSync(OUTPUT_DIR, { recursive: true });

  const sizeMB = (fs.statSync(OUTPUT_MP4).size / 1024 / 1024).toFixed(1);
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  ✓ Recording complete!                               ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`\n  File:  ${OUTPUT_MP4}`);
  console.log(`  Size:  ${sizeMB} MB`);
  console.log(`  Spec:  ${FPS}fps  H.264  1920×1080\n`);
}

record().catch(err => {
  console.error('\n  ✗ Error:', err.message || err);
  process.exit(1);
});
