# SyncAR Spine — Video Export Guide

Export the animation from `index-alpha.html` as a **PNG sequence with alpha channel**,
then convert to **ProRes 4444** for After Effects / Final Cut Pro, or keep as **WebM VP9**
for browser / OBS delivery.

---

## How it works

```
index-alpha.html
      │
      │  Puppeteer (headless Chrome)
      │  • CDP forces transparent compositor background
      │  • GSAP global timeline is paused and scrubbed frame-by-frame
      │  • Each frame is saved as a 1920×1080 RGBA PNG
      ▼
frames/frame_00000.png … frame_00569.png   ← 570 frames @ 30 fps / 19 s
      │
      │  FFmpeg
      ▼
syncar-spine-alpha.webm        ← VP9 + alpha (browser / OBS delivery)
syncar-spine-prores4444.mov    ← ProRes 4444 with alpha (After Effects / FCP)
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 16 + | https://nodejs.org |
| FFmpeg | 5 + | https://ffmpeg.org/download.html |
| Python (optional) | 3.x | for the HTTP server |

> **Windows note:** Add FFmpeg to your `PATH` after installing it.  
> Verify: `ffmpeg -version`

---

## Quick Start

### 1 — Start the HTTP server

The exporter fetches `index-alpha.html` over HTTP (not `file://`) to allow
video autoplay and Web Audio. From the **project root**:

```powershell
# Python (already installed on most systems)
python -m http.server 8765 --directory "Desktop/brutspace"
# ← adjust the path to wherever the project root is

# OR — simple Node.js server (no install needed in Node 18+)
npx serve -l 8765 .
```

The page must be reachable at:
`http://localhost:8765/syncar-circle/index-alpha.html`

### 2 — Install Puppeteer

```powershell
cd "Desktop/mo project/syncar-circle"
npm install
```

> `npm install` downloads Puppeteer **and** a bundled Chromium (~300 MB).
> This only needs to run once.

### 3 — Export frames + WebM

```powershell
node export.js
# or: npm run export
```

Expected output:

```
╔══════════════════════════════════════════════╗
║   SyncAR Spine — Animation Frame Exporter   ║
╚══════════════════════════════════════════════╝

→ Launching Chromium…
→ Loading http://localhost:8765/syncar-circle/index-alpha.html
→ Capturing 570 frames @ 30 fps (19 s)

  [████████████████████████████████]  100.0 %  frame  570 / 570

✓ Frame capture complete.

→ Assembling WebM (VP9 + alpha)…
✓ WebM saved → syncar-spine-alpha.webm  (8.3 MB)

✓ Total time: 142.7 s
```

Outputs produced:

| Path | Description |
|------|-------------|
| `frames/frame_00000.png` … | 570 RGBA PNGs, 1920 × 1080 |
| `syncar-spine-alpha.webm` | VP9 + alpha (for OBS / browser) |

---

## Convert to ProRes 4444

Run **one** of the following FFmpeg commands from inside `syncar-circle/`:

### Option A — From WebM (fast, ~1 min)

```bash
ffmpeg -i syncar-spine-alpha.webm \
  -c:v prores_ks \
  -profile:v 4444 \
  -pix_fmt yuva444p10le \
  -vendor apl0 \
  syncar-spine-prores4444.mov
```

### Option B — From PNG frames (lossless, highest quality)

> Recommended when quality is the top priority.
> Skips the intermediate VP9 compression step entirely.

```bash
ffmpeg -framerate 30 \
  -i frames/frame_%05d.png \
  -c:v prores_ks \
  -profile:v 4444 \
  -pix_fmt yuva444p10le \
  -vendor apl0 \
  syncar-spine-prores4444.mov
```

### Flag reference

| Flag | Value | Meaning |
|------|-------|---------|
| `-c:v prores_ks` | — | Apple ProRes encoder (built into FFmpeg) |
| `-profile:v 4444` | — | ProRes 4444 (supports alpha channel) |
| `-pix_fmt yuva444p10le` | — | 10-bit YUV 4:4:4 **with alpha** — required for ProRes 4444 |
| `-vendor apl0` | — | Marks the file as Apple-originated; improves FCP compatibility |
| `-bits_per_mb 8000` | optional | Raises bitrate ceiling for extreme quality (`-b:v 0` uses default) |

---

## Importing in After Effects

1. File → Import → File → select `syncar-spine-prores4444.mov`
2. In the Import dialog set **Footage** → **Straight - Unmatted** alpha
3. Drop onto a comp with a **black or coloured background layer below it**
4. The animation alpha channel will composite correctly

---

## Importing in Final Cut Pro

1. File → Import → Files → select `syncar-spine-prores4444.mov`
2. FCP auto-detects the ProRes 4444 alpha
3. Place on timeline — alpha composites immediately

---

## Using the WebM directly in OBS

1. Add a **Browser Source** (1920 × 1080)
2. Tick **"Use custom frame rate"** → 30
3. Point it at `http://localhost:8765/syncar-circle/index-alpha.html`

> Or use a **Media Source** pointing to `syncar-spine-alpha.webm` with  
> **"Loop"** unchecked. OBS Studio 29+ handles VP9+alpha natively.

---

## Configuration

Edit the `CONFIG` block at the top of `export.js` to change any parameter:

```js
const CONFIG = {
  url:           'http://localhost:8765/syncar-circle/index-alpha.html',
  fps:           30,
  duration:      19,      // seconds captured — increase for longer animations
  framesDir:     'frames',
  outputWebm:    'syncar-spine-alpha.webm',
  width:         1920,
  height:        1080,
  hideParticles: true,    // particles use rAF independently of GSAP; keep true
};
```

---

## Troubleshooting

### `Error: connect ECONNREFUSED 127.0.0.1:8765`
The HTTP server is not running. Start it before running `node export.js`.

### `Error: gsap is not defined`
The page failed to load GSAP from the CDN. Check your internet connection,
or host GSAP locally and update the `<script>` tag in `index-alpha.html`.

### Frames are all black / not transparent
Make sure you are using `index-alpha.html` (not `index.html`).  
The `index.html` version has a `#000000` background.

### FFmpeg `Unknown encoder 'prores_ks'`
Your FFmpeg build does not include the ProRes encoder.  
Download a **full** build from https://ffmpeg.org/download.html (GPL or LGPL full).

### `npm install` is slow / Chromium download hangs
Set `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` and point to an existing  
Chrome/Chromium installation via `executablePath` in the `puppeteer.launch()`  
call in `export.js`:

```js
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  // … rest of options
});
```

---

## File sizes (approximate)

| Output | Size |
|--------|------|
| PNG sequence (570 frames, 1920×1080 RGBA) | ~1.8 GB |
| WebM VP9 + alpha (CRF 10) | ~8–15 MB |
| ProRes 4444 (from WebM) | ~200–400 MB |
| ProRes 4444 (from frames, no loss) | ~300–450 MB |

---

*SyncAR Spine by Surgical Theater*
