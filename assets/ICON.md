# PicoMarQ icon

A white sheet with a folded top-right corner and a bold outline in PicoMarQ red (#870121), carrying the Markdown "M" (the letter from the public-domain Markdown mark) whose right stem runs on below the baseline into an arrowhead — the design was settled on 2026-10-10 after a round of comparisons at taskbar sizes.

- The sheet is almost square (98.5% of the icon's width) so the icon matches its neighbours for size; the dog-ear is what says "document", not the paper's proportions. The corners outside the sheet are transparent.
- The glyph sits in the band between the bottom of the fold and the bottom of the sheet, as large as a 5% margin allows, and is centred on the M itself: the arrowhead's point past the right stem is ignored, so the letter looks centred.
- `scripts/build-icon.cjs` holds the drawing and renders every size with Playwright's Chromium (`npm run build:icon`; `npx playwright install chromium` first, or set `PICOMARQ_CHROMIUM` to a Chromium binary). It writes `app.ico` with 16, 20, 24, 32, 40, 48, 64, 128 and 256 px images (PNG-encoded; the two smallest use a heavier outline), `assets/app-icon.svg`, and the PNG copies `assets/app-icon.png` and `app-icon.png`. `npm run package:windows` embeds every size in the executable and verifies the embedded pixels against `app.ico`.

Earlier icons: a plum-and-ivory Q monogram (Quill, builds 0.1.6–0.1.11) and a black-outline document with the M↓ mark on an opaque white square (0.1.12).
