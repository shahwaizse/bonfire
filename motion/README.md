# Bonfire: tiny GPU, big feelings

A 24-second motion graphics film. Canvas shapes and system fonts; every visual is code. A generated PCM soundtrack adds a kick/hat/bass beat and little transition blips. No stock assets, image generation, external fonts, paid tools or network calls during rendering.

The palette follows Bonfire's dark purple surfaces, lavender primary and teal accent. There is no decorative text around the frame. Mascot title cards alternate with a stylized product UI: typed prompts, moving cursor, Send clicks, camera zooms into the composer/gallery, and a click that expands saved MCP details. Scene boundaries use close-up match cuts. Character motion remains quantized to 12 poses/second for the stop/go feel.

The MP4 is 1280 x 720 at 24 fps; the README GIF is a silent 800 px, 10 fps loop. The UI and gallery are code-drawn illustrations of existing interactions, not a live recording or real image-search results.

## Preview

Open `index.html` directly in a browser, or from the repo root:

```powershell
python -m http.server 3010 --bind 127.0.0.1
```

Visit `http://127.0.0.1:3010/motion/review.html` to watch the MP4 with sound, or `http://127.0.0.1:3010/motion/` to scrub the code preview. Play/pause, replay and scrub work without a build. The exported MP4 has sound; the Canvas preview is silent.

## Export

Install the frontend dependencies and Playwright Chromium, then make FFmpeg available on PATH (or set `FFMPEG_PATH` to its executable). Run from the repo root:

```powershell
node motion/export.mjs
```

Output: `docs/bonfire-intro.mp4`, `docs/bonfire-intro.gif`, `docs/bonfire-intro-poster.png`. Temporary sound/contact-sheet files default to `D:/Projects/bonfire-motion-render`; override with `BONFIRE_MOTION_TEMP` on another machine. Export uses the frontend's existing Playwright package rather than adding a second dependency tree.

Edit timings/copy/colors/drawings in `film.js`. The film is deterministic; `window.bonfireFilm.draw(seconds)` renders any frame directly.
