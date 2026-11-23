// Builds the application icon from the vector drawing below: a white sheet
// with a folded corner and a bold red outline, carrying the Markdown "M"
// whose right stem runs down into an arrowhead. Writes app.ico (16, 20, 24,
// 32, 40, 48, 64, 128 and 256 px, each a PNG image), assets/app-icon.svg
// (the 256 px drawing) and the PNG copies assets/app-icon.png and
// app-icon.png.
//
// Rendering uses the Chromium that Playwright manages (npx playwright
// install chromium); set PICOMARQ_CHROMIUM to use another Chromium binary.
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const RED = '#870121';
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

// The letter is the Markdown mark's M (public domain): stems 20 wide at
// x 30-50 and 90-110, y 30-98, the V dipping to y 84. The right stem goes on
// below the baseline, a short stub and then the arrowhead.
const GLYPH = { stub: 3, headHeight: 24, shoulder: 12 };
function glyphPath({ stub, headHeight, shoulder }) {
  const baseline = 98, stemL = 90, stemR = 110;
  const headTop = baseline + stub, tip = headTop + headHeight;
  return [
    `M30 ${baseline} V30 h20 l20 25 20-25 h20`,
    `V${headTop}`,
    `h${shoulder} L${(stemL + stemR) / 2} ${tip} L${stemL - shoulder} ${headTop} h${shoulder}`,
    `V59 L70 84 50 59 V${baseline} z`,
  ].join(' ');
}
const glyphHeight = (g) => 98 + g.stub + g.headHeight - 30;
const sheetPath = (x, y, w, h, r, f) => `M${x + r} ${y} H${x + w - f} L${x + w} ${y + f} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
const foldPath = (x, y, w, f) => `M${x + w - f} ${y} V${y + f} H${x + w} Z`;

/** The icon as SVG in a 256-unit box. A heavier outline is used for the tiniest sizes. */
function iconSvg({ stroke = 16, fold = 0.21, margin = 0.05 } = {}) {
  const outerMargin = 2;
  const sw = Math.round(256 * 0.985) - 2 * outerMargin - stroke;
  const sh = 256 - 2 * outerMargin - stroke;
  const sx = Math.round((256 - sw) / 2), sy = outerMargin + stroke / 2;
  const f = Math.round(sh * fold);
  const r = Math.round(stroke * 1.1);
  const innerLeft = sx + stroke / 2, innerRight = sx + sw - stroke / 2;
  const innerBottom = sy + sh - stroke / 2, foldBottom = sy + f + stroke / 2;
  const innerWidth = innerRight - innerLeft;
  // The glyph sits in the band between the fold and the bottom edge, as large
  // as the margins allow. It is centred on the M itself (x 30-110); the
  // arrowhead's point past the right stem is ignored, so the letter looks
  // centred rather than measuring so.
  const bandTop = foldBottom + innerWidth * margin, bandBottom = innerBottom - innerWidth * margin;
  const mW = 80;
  const sByWidth = Math.min(innerWidth * (1 - 2 * margin) / mW, (innerWidth / 2 - innerWidth * margin) / (mW / 2 + GLYPH.shoulder));
  const s = Math.min(sByWidth, (bandBottom - bandTop) / glyphHeight(GLYPH));
  const gh = glyphHeight(GLYPH) * s;
  const gx = innerLeft + innerWidth / 2 - (mW / 2) * s;
  const gy = (bandTop + bandBottom) / 2 - gh / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <path d="${sheetPath(sx, sy, sw, sh, r, f)}" fill="#ffffff" stroke="${RED}" stroke-width="${stroke}" stroke-linejoin="round"/>
  <path d="${foldPath(sx, sy, sw, f)}" fill="${RED}" stroke="${RED}" stroke-width="${stroke}" stroke-linejoin="round"/>
  <g transform="translate(${gx} ${gy}) scale(${s}) translate(-30 -30)"><path d="${glyphPath(GLYPH)}" fill="${RED}"/></g>
</svg>
`;
}

function icoFile(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const browser = await chromium.launch(process.env.PICOMARQ_CHROMIUM ? { executablePath: process.env.PICOMARQ_CHROMIUM, args: ['--no-sandbox'] } : {});
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const images = [];
    for (const size of SIZES) {
      const svg = iconSvg(size <= 20 ? { stroke: 22 } : {});
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
      const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
      images.push({ size, png });
    }
    await fs.writeFile(path.join(root, 'app.ico'), icoFile(images));
    await fs.writeFile(path.join(root, 'assets/app-icon.svg'), iconSvg());
    const largest = images[images.length - 1].png;
    await fs.writeFile(path.join(root, 'assets/app-icon.png'), largest);
    await fs.writeFile(path.join(root, 'app-icon.png'), largest);
    console.log(`Built app.ico (${SIZES.join(', ')} px), assets/app-icon.svg and the PNG copies.`);
  } finally {
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
