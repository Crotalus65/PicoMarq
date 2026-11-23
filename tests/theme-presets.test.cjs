const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { captureTheme, parseTheme, fallbackFont, defaultAppearance } = require('../desktop/theme-presets.cjs');

const fullSettings = () => ({
  theme: { mode: 'dark' },
  startupBehavior: 'new',
  smartTypography: false,
  editorFont: { baseFontFamily: 'system-font', systemFontFamily: 'Literata', baseFontSize: 19, boldWeight: 700, lineHeight: 1.9 },
  editorWidth: 'custom', customEditorWidthPx: 985, interfaceZoom: 1.25, toolbarIconScale: 1.5,
  customColorsLight: { 'italic': '#D50000', 'heading-4': '#101010' },
  customColorsDark: { 'italic': '#FF4FA3', bold: 'rgba(240, 130, 190, 0.8)' },
});

test('save and load a complete appearance configuration, including both palettes', () => {
  const capture = captureTheme(fullSettings());
  assert.equal(capture.version, 1);
  assert.equal(capture.format, 'PicoMarQ Theme');
  assert(!('startupBehavior' in capture.appearance));
  assert(!('smartTypography' in capture.appearance));
  const parsed = parseTheme(JSON.stringify(capture));
  assert.deepEqual(parsed, capture.appearance);
  assert.equal(parsed.customColorsLight.italic, '#D50000');
  assert.equal(parsed.customColorsDark.italic, '#FF4FA3');
  assert.equal(parsed.editorWidth, 'custom');
  assert.equal(parsed.editorFont.systemFontFamily, 'Literata');
});

test('incomplete existing preferences export sane defaults', () => {
  const parsed = parseTheme(JSON.stringify(captureTheme({ theme: { mode: 'light' } })));
  assert.equal(parsed.editorFont.baseFontFamily, 'system-sans');
  assert.equal(parsed.editorFont.baseFontSize, 15);
  assert.equal(parsed.editorWidth, 'full');
  assert.deepEqual(parsed.customColorsLight, {});
  assert.deepEqual(parsed.customColorsDark, {});
});

test('import resolves missing system fonts to built-in Sans without altering size', () => {
  const appearance = parseTheme(JSON.stringify(captureTheme(fullSettings())));
  const unavailable = fallbackFont(appearance, ['Arial', 'Cambria']);
  assert.equal(unavailable.editorFont.baseFontFamily, 'system-sans');
  assert.equal(unavailable.editorFont.systemFontFamily, '');
  assert.equal(unavailable.editorFont.baseFontSize, 19);
  assert.deepEqual(unavailable.customColorsDark, appearance.customColorsDark);
  assert.equal(appearance.editorFont.baseFontFamily, 'system-font'); // don't mutate imported data
  const available = fallbackFont(appearance, ['Arial', 'literata']);
  assert.equal(available.editorFont.baseFontFamily, 'system-font');
});

test('invalid files reject before modifying any preferences', () => {
  const theme = captureTheme(fullSettings());
  assert.throws(() => parseTheme('{broken'), /not valid JSON/);
  assert.throws(() => parseTheme('{"hello":"world"}'), /not a supported/);
  assert.throws(() => parseTheme(JSON.stringify({ ...theme, version: 99 })), /not a supported/);
  assert.throws(() => parseTheme(JSON.stringify({ ...theme, appearance: { ...theme.appearance, interfaceZoom: 200 } })), /zoom is out of range/);
  assert.throws(() => parseTheme(JSON.stringify({ ...theme, appearance: { ...theme.appearance, customColorsLight: { italic: 'javascript:alert(1)' } } })), /Invalid light color/);
  assert.throws(() => parseTheme(JSON.stringify({ ...theme, appearance: { ...theme.appearance, customColorsDark: { unknown: '#000000' } } })), /Unrecognized dark color/);
});

test('Restore Default Theme gives the built-in appearance and keeps Light or Dark', () => {
  for (const mode of ['light', 'dark']) {
    const appearance = defaultAppearance(mode);
    assert.equal(appearance.theme.mode, mode);
    assert.deepEqual(appearance.editorFont, { baseFontFamily: 'system-sans', systemFontFamily: '', baseFontSize: 15, boldWeight: 600, lineHeight: 1.6 });
    assert.equal(appearance.editorWidth, 'full');
    assert.equal(appearance.customEditorWidthPx, 768);
    assert.equal(appearance.interfaceZoom, 1);
    assert.equal(appearance.toolbarIconScale, 1);
    assert.deepEqual(appearance.customColorsLight, {});
    assert.deepEqual(appearance.customColorsDark, {});
    assert(!('startupBehavior' in appearance));
    assert(!('smartTypography' in appearance));
    // A valid theme: saving and loading it gives the same appearance.
    assert.deepEqual(parseTheme(JSON.stringify(captureTheme(appearance))), appearance);
  }
  assert.equal(defaultAppearance(undefined).theme.mode, 'light');
  // Applied over existing preferences, it keeps Startup and Smart Typography.
  const restored = { ...fullSettings(), ...defaultAppearance('dark') };
  assert.equal(restored.startupBehavior, 'new');
  assert.equal(restored.smartTypography, false);
  assert.deepEqual(restored.customColorsDark, {});
  // The same defaults the renderer uses (and its Reset to defaults buttons).
  const context = fs.readFileSync(path.join(__dirname, '../src/context/ThemeContext.tsx'), 'utf8');
  assert(context.includes("defaultEditorFontSettings: Required<EditorFontSettings> = { baseFontFamily: 'system-sans', systemFontFamily: '', baseFontSize: 15, boldWeight: 600, lineHeight: 1.6 }"));
  assert(context.includes("resetInterfaceSettings: () => patch({ editorWidth: 'full', interfaceZoom: 1, toolbarIconScale: 1, customEditorWidthPx: 768 })"));
});

test('Heading 4 is bold, not italic; size variable remains unchanged', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/App.css'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8');
  const stylesheet = html.match(/href="\.\/assets\/([^"]+\.css)"/)[1];
  const dist = fs.readFileSync(path.join(__dirname, '../dist/assets', stylesheet), 'utf8');
  const rule = css.match(/\.prose h4\s*\{([^}]+)\}/)?.[1];
  const compiled = dist.match(/\.prose h4\{([^}]+)\}/)?.[1];
  for (const body of [rule, compiled]) {
    assert(body.includes('font-size: var(--editor-h4-size)') || body.includes('font-size:var(--editor-h4-size)'));
    assert(body.includes('font-weight: var(--editor-bold-weight)') || body.includes('font-weight:var(--editor-bold-weight)'));
    assert(body.includes('font-style: normal') || body.includes('font-style:normal'));
  }
});

test('compiled renderer and source HTML both activate the same theme controls', () => {
  for (const file of ['index.html','dist/index.html']) assert(fs.readFileSync(path.join(__dirname,'..',file),'utf8').includes('src="./theme-presets-ui.js"'));
  const runtime = fs.readFileSync(path.join(__dirname,'../dist/theme-presets-ui.js'),'utf8');
  const source = fs.readFileSync(path.join(__dirname,'../public/theme-presets-ui.js'),'utf8');
  assert.equal(runtime, source);
  assert(runtime.includes("'save_theme'"));
  assert(runtime.includes("'load_theme'"));
  assert(runtime.includes("'restore_default_theme'"));
  const main = fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
  assert(main.includes("case 'save_theme':"));
  assert(main.includes("case 'load_theme':"));
  assert(main.includes("case 'restore_default_theme':"));
});
