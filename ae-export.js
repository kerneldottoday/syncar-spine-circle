'use strict';
/**
 * ae-export.js — SyncAR Spine After Effects Asset Exporter
 *
 * Captures each visual element as a separate transparent PNG sequence
 * for After Effects compositing:
 *
 *   AE-assets/
 *     segment-preoperative/      frame_00000.png … frame_00569.png
 *     segment-patient-engagement/
 *     segment-intra-operative/
 *     background-particles/
 *     media/Decompressions.mp4
 *     AE-instructions.md
 *
 * Usage:  node ae-export.js
 */

const puppeteer    = require('puppeteer');
const fs           = require('fs');
const path         = require('path');
const http         = require('http');
const { execSync } = require('child_process');

// ── Config ─────────────────────────────────────────────────────────────────
const SERVER_PORT  = 8769;
const ROOT         = path.resolve(__dirname, '..');          // "mo project"
const AE_DIR       = path.join(__dirname, 'AE-assets');
const ZIP_OUT      = path.join(__dirname, 'AE-package.zip');
const FPS          = 30;
const DURATION     = 19;
const TOTAL_FRAMES = FPS * DURATION;                         // 570

// ── MIME map ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.mp4': 'video/mp4',  '.webm': 'video/webm', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

// ── HTTP server ─────────────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let urlPath = req.url.split('?')[0];
      try { urlPath = decodeURIComponent(urlPath); } catch (_) {}
      const filePath = path.normalize(path.join(ROOT, urlPath));
      if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.stat(filePath, (err, stat) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const ext   = path.extname(filePath).toLowerCase();
        const mime  = MIME[ext] || 'application/octet-stream';
        const range = req.headers.range;
        if (range) {
          const [, s, e] = range.match(/bytes=(\d+)-(\d*)/) || [];
          const start = parseInt(s, 10), end = e ? parseInt(e, 10) : stat.size - 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': mime,
          });
          fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': mime, 'Accept-Ranges': 'bytes' });
          fs.createReadStream(filePath).pipe(res);
        }
      });
    });
    srv.on('error', reject);
    srv.listen(SERVER_PORT, '127.0.0.1', () => resolve(srv));
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const zeroPad = (n, w = 5) => String(n).padStart(w, '0');

function progressBar(done, total, w = 40) {
  const f = Math.round((done / total) * w);
  return '[' + '█'.repeat(f) + '░'.repeat(w - f) + ']';
}

function printProgress(f, total) {
  if (f % 10 === 0 || f === total - 1) {
    const pct = (((f + 1) / total) * 100).toFixed(1);
    process.stdout.write(
      `\r  ${progressBar(f + 1, total)} ${pct.padStart(5)}%  frame ${String(f + 1).padStart(4)}/${total}`
    );
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  // Clear any stale PNGs
  if (fs.existsSync(p)) {
    fs.readdirSync(p).filter(f => f.endsWith('.png'))
      .forEach(f => fs.unlinkSync(path.join(p, f)));
  }
}

// ── Capture passes ──────────────────────────────────────────────────────────

/**
 * GSAP-scrubbed pass — seeks timeline frame-by-frame for perfect sync.
 * Used for all 3 segment passes.
 */
async function captureGSAPPass(page, framesDir, hideIds) {
  await page.goto(
    `http://localhost:${SERVER_PORT}/syncar-circle/index-alpha.html`,
    { waitUntil: 'load', timeout: 45_000 }
  );
  // Wait for GSAP and the SVG segments to be ready
  await page.waitForFunction(
    () => typeof gsap !== 'undefined' && !!document.getElementById('seg-1'),
    { timeout: 15_000 }
  );
  // Extra settle time for fonts and first GSAP tick
  await new Promise(r => setTimeout(r, 600));

  // Hide elements and pause GSAP in one evaluate call (no eval, no Promise return)
  await page.evaluate((ids) => {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    gsap.globalTimeline.pause(0, true);
  }, hideIds);

  for (let f = 0; f < TOTAL_FRAMES; f++) {
    await page.evaluate(t => { gsap.globalTimeline.time(t, true); }, f / FPS);
    // Give the browser a brief tick to apply GSAP's synchronous attribute updates
    await new Promise(r => setTimeout(r, 20));
    await page.screenshot({
      path: path.join(framesDir, `frame_${zeroPad(f)}.png`),
      omitBackground: true,
    });
    printProgress(f, TOTAL_FRAMES);
  }
}

/**
 * Real-time pass — particles run on rAF so we capture at wall-clock speed.
 */
async function captureRealtimePass(page, framesDir, hideIds) {
  await page.goto(
    `http://localhost:${SERVER_PORT}/syncar-circle/index-alpha.html`,
    { waitUntil: 'load', timeout: 45_000 }
  );
  await new Promise(r => setTimeout(r, 500));

  // Hide everything except the canvas
  await page.evaluate((ids) => {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }, hideIds);

  for (let f = 0; f < TOTAL_FRAMES; f++) {
    // Throttle to ~30fps wall-clock
    await new Promise(r => setTimeout(r, Math.round(1000 / FPS)));
    await page.screenshot({
      path: path.join(framesDir, `frame_${zeroPad(f)}.png`),
      omitBackground: true,
    });
    printProgress(f, TOTAL_FRAMES);
  }
}

// ── Pass definitions ────────────────────────────────────────────────────────
const PASSES = [
  {
    name:    'segment-preoperative',
    label:   'Pre-Operative segment',
    gsap:    true,
    // IDs to hide for this pass (everything except seg-1, sweep-1, label-1)
    hideIds: ['seg-2','seg-3','sweep-2','sweep-3','label-2','label-3','center-group','end-frame','bg-particles'],
  },
  {
    name:    'segment-patient-engagement',
    label:   'Patient Engagement segment',
    gsap:    true,
    hideIds: ['seg-1','seg-3','sweep-1','sweep-3','label-1','label-3','center-group','end-frame','bg-particles'],
  },
  {
    name:    'segment-intra-operative',
    label:   'Intra-Operative segment',
    gsap:    true,
    hideIds: ['seg-1','seg-2','sweep-1','sweep-2','label-1','label-2','center-group','end-frame','bg-particles'],
  },
  {
    name:    'background-particles',
    label:   'Background particles',
    gsap:    false,
    hideIds: ['diagram','end-frame'],
  },
];

// ── AE-instructions.md ──────────────────────────────────────────────────────
function writeInstructions() {
  const dest = path.join(AE_DIR, 'AE-instructions.md');
  const md = `# SyncAR Spine — After Effects Composition Guide

## Composition Settings
| Setting | Value |
|---------|-------|
| Width | 1920 px |
| Height | 1080 px |
| Frame Rate | 30 fps |
| Duration | 19 seconds (570 frames) |
| Color Mode | 32-bit (for ProRes 4444 output) |
| Background | Transparent |

---

## Folder Contents
\`\`\`
AE-assets/
  segment-preoperative/          # 570 PNG frames — Pre-Operative arc (alpha)
  segment-patient-engagement/    # 570 PNG frames — Patient Engagement arc (alpha)
  segment-intra-operative/       # 570 PNG frames — Intra-Operative arc (alpha)
  background-particles/          # 570 PNG frames — particle field (alpha)
  media/Decompressions.mp4       # spine model video — use as separate layer
\`\`\`

---

## Layer Order (bottom → top)

| # | Layer | Source | Alpha | Blend Mode |
|---|-------|--------|-------|------------|
| 1 | Background | Solid #000000 or your BG | — | Normal |
| 2 | Particles | \`background-particles/frame_%05d.png\` | Straight | Screen |
| 3 | Pre-Operative | \`segment-preoperative/frame_%05d.png\` | Straight | Normal |
| 4 | Patient Engagement | \`segment-patient-engagement/frame_%05d.png\` | Straight | Normal |
| 5 | Intra-Operative | \`segment-intra-operative/frame_%05d.png\` | Straight | Normal |
| 6 | Spine Video | \`media/Decompressions.mp4\` | None | Normal |
| 7 | "SyncAR Spine" | Text layer (create in AE) | — | Normal |
| 8 | Subtitle | Text layer (create in AE) | — | Normal |

> Import PNG sequences: **File → Import → File**, select \`frame_00000.png\`,
> check **PNG Sequence**, set to **30 fps**.

---

## Animation Timing

### Segment layers (all start at frame 0)

| Event | Time | Frame | Description |
|-------|------|-------|-------------|
| All segments fade IN (muted) | 0s → 1s | fr 0 → 30 | Opacity 0 → 1 |
| **Pre-Operative ACTIVATES** | 2s | fr 60 | Bright red #E8163A + red glow + sweep flash |
| **Patient Engagement ACTIVATES** | 4.5s | fr 135 | Bright purple #9B30FF + purple glow + sweep |
| **Intra-Operative ACTIVATES** | 7s | fr 210 | Bright gold #F0B400 + gold glow + sweep |
| Unified pulse (all 3) | 9s | fr 270 | Scale 1 → 1.015 → 1 over 1.5s |
| All segments + video FADE OUT | 11s → 12.5s | fr 330 → 375 | Opacity 1 → 0 |

### Spine video layer (create from media/Decompressions.mp4)

| Event | Time | Frame | Notes |
|-------|------|-------|-------|
| Video visible | 0s → 12.5s | fr 0 → 375 | Fade out mirrors segments |
| Fade OUT | 11s → 12.5s | fr 330 → 375 | Sync with segment fade out |

**Spine video setup:**
- Position: 960, 540 (composition center)
- Scale: 100%
- Elliptical mask: 400 × 400 px, centered at 960 × 540, **no feather**
- Loop footage for full duration

### End-frame text (create as text layers in AE)

| Layer | Font | Size | Weight | Color | Opacity | Start | Fade In |
|-------|------|------|--------|-------|---------|-------|---------|
| "SyncAR Spine" | Montserrat | 96 px | Light (300) | #FFFFFF | 100% | fr 375 | fr 375 → 411 (1.2s) |
| "Across the Entire Continuum of Care" | Montserrat | 32 px | Light (300) | #FFFFFF | 70% | fr 390 | fr 390 → 420 (1s) |

- Letter-spacing "SyncAR Spine": 8px (~56 units in AE)
- Letter-spacing subtitle: 6px (~42 units in AE)
- Both layers centered horizontally and vertically in comp
- Install **Montserrat** from Google Fonts before building the AE project

---

## PNG Sequence Import Guide (AE)

1. **File → Import → File**
2. Navigate into \`segment-preoperative/\`
3. Select \`frame_00000.png\` → check **PNG Sequence** checkbox → Open
4. In Project panel, right-click the footage → **Interpret Footage → Main**
5. Set **Frame Rate** to **30**
6. Set **Alpha** to **Straight - Unmatted**
7. Repeat for all 4 sequences

---

## Colors Reference

| Segment | Muted (inactive) fill | Active fill | Glow color |
|---------|-----------------------|-------------|------------|
| Pre-Operative | #4d1020 | #E8163A | #E8163A |
| Patient Engagement | #2e1260 | #9B30FF | #9B30FF |
| Intra-Operative | #3d3000 | #F0B400 | #F0B400 |

---

## Suggested AE Output Settings

- **Format:** QuickTime
- **Codec:** Apple ProRes 4444
- **Color Depth:** Trillions of Colors+ (includes alpha)
- **Audio:** No audio (or PCM if needed)

---

## Notes

- The **background-particles** sequence is captured at real-time 30fps.
  Particles are very subtle (opacity ~15%, white dots). Use **Screen** or
  **Add** blend mode for natural integration.
- The PNG sequences do NOT include the end-frame text. Recreate it in AE
  as text layers for maximum resolution and flexibility.
- The spine video (\`Decompressions.mp4\`) needs a **circular ellipse mask**
  (400×400 px) applied in AE to match the circular crop in the web animation.
- All SVG glow/drop-shadow effects are **baked into** the segment PNG sequences.
`;
  fs.writeFileSync(dest, md, 'utf8');
  console.log(`  ✓ AE-instructions.md written`);
}

// ── ZIP ─────────────────────────────────────────────────────────────────────
function zipPackage() {
  if (fs.existsSync(ZIP_OUT)) fs.unlinkSync(ZIP_OUT);
  console.log('\n  Zipping AE-assets → AE-package.zip …');
  const relAssets = path.relative(process.cwd(), AE_DIR).replace(/\\/g, '\\\\');
  const relZip    = path.relative(process.cwd(), ZIP_OUT).replace(/\\/g, '\\\\');
  execSync(
    `powershell -Command "Compress-Archive -Path '${AE_DIR}\\*' -DestinationPath '${ZIP_OUT}' -Force"`,
    { stdio: 'inherit' }
  );
  const sizeMB = (fs.statSync(ZIP_OUT).size / 1024 / 1024).toFixed(1);
  console.log(`  ✓ AE-package.zip → ${sizeMB} MB`);
}

// ── MAIN ────────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║   SyncAR Spine — After Effects Asset Package Exporter    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const t0 = Date.now();
  let server, browser;

  try {
    // ── Server ──────────────────────────────────────────────────────────────
    process.stdout.write('  Starting HTTP server …');
    server = await startServer();
    console.log(` port ${SERVER_PORT} ✓`);

    // ── Browser ─────────────────────────────────────────────────────────────
    process.stdout.write('  Launching Chromium …');
    browser = await puppeteer.launch({
      headless: 'new',
      protocolTimeout: 60_000,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-gpu', '--force-device-scale-factor=1',
        '--font-render-hinting=none',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
      defaultViewport: { width: 1920, height: 1080 },
    });
    const page = await browser.newPage();

    // Force transparent compositor background
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setDefaultBackgroundColorOverride', {
      color: { r: 0, g: 0, b: 0, a: 0 },
    });
    console.log(' ✓\n');

    // ── Prep output dir ─────────────────────────────────────────────────────
    ensureDir(AE_DIR);
    const totalPasses = PASSES.length;

    // ── Run each pass ───────────────────────────────────────────────────────
    for (let p = 0; p < totalPasses; p++) {
      const pass = PASSES[p];
      const passDir = path.join(AE_DIR, pass.name);
      ensureDir(passDir);

      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`\n  [${p + 1}/${totalPasses}] ${pass.label}  (${elapsed}s elapsed)`);
      console.log(`        → ${passDir}`);

      if (pass.gsap) {
        await captureGSAPPass(page, passDir, pass.hideIds);
      } else {
        await captureRealtimePass(page, passDir, pass.hideIds);
      }
      console.log(`\n  ✓ ${pass.name} — ${TOTAL_FRAMES} frames captured`);
    }

    await browser.close();
    browser = null;
    server.close();
    server = null;

    // ── Copy spine video ────────────────────────────────────────────────────
    console.log('\n  Copying media/Decompressions.mp4 …');
    const mediaOut = path.join(AE_DIR, 'media');
    fs.mkdirSync(mediaOut, { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, 'media', 'Decompressions.mp4'),
      path.join(mediaOut, 'Decompressions.mp4')
    );
    console.log('  ✓ media/Decompressions.mp4 copied');

    // ── Instructions ────────────────────────────────────────────────────────
    console.log('\n  Writing AE-instructions.md …');
    writeInstructions();

    // ── Zip ──────────────────────────────────────────────────────────────────
    zipPackage();

    const totalMin = ((Date.now() - t0) / 1000 / 60).toFixed(1);
    const zipMB    = (fs.statSync(ZIP_OUT).size / 1024 / 1024).toFixed(1);

    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║  ✓ After Effects package complete!                       ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log(`\n  ZIP:    ${ZIP_OUT}`);
    console.log(`  Size:   ${zipMB} MB`);
    console.log(`  Frames: ${totalPasses * TOTAL_FRAMES} total PNG files`);
    console.log(`  Time:   ${totalMin} min\n`);

  } catch (err) {
    console.error('\n  ✗ Error:', err.message);
    console.error(err.stack);
    if (browser) await browser.close().catch(() => {});
    if (server)  server.close();
    process.exit(1);
  }
})();
