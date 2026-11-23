'use strict';
// Portable, versioned appearance-only theme format. Never read or write documents here.
const FORMAT = 'PicoMarQ Theme';
const VERSION = 1;
const COLOR_KEYS = [
  'bg', 'bg-secondary', 'bg-muted', 'bg-emphasis', 'text',
  'heading-1', 'heading-2', 'heading-3', 'heading-4', 'bold', 'italic',
  'text-muted', 'border', 'accent', 'selection',
];
const COLOR_SET = new Set(COLOR_KEYS);
const DEFAULT_FONT = { baseFontFamily: 'system-sans', systemFontFamily: '', baseFontSize: 15, boldWeight: 600, lineHeight: 1.6 };
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteIn = (value, minimum, maximum) => typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;

function parseColors(colors, label) {
  if (!isRecord(colors)) throw new Error(`${label} must be an object of color overrides.`);
  const result = {};
  for (const [key, value] of Object.entries(colors)) {
    if (!COLOR_SET.has(key)) throw new Error(`Unrecognized ${label} color: ${key}.`);
    if (typeof value !== 'string' || value.length > 64 || !(
      /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(value) ||
      /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/i.test(value)
    )) throw new Error(`Invalid ${label} color for ${key}.`);
    result[key] = value;
  }
  return result;
}

function validateAppearance(value) {
  if (!isRecord(value)) throw new Error('The theme is missing its appearance settings.');
  const mode = value.theme?.mode;
  if (mode !== 'light' && mode !== 'dark') throw new Error('A theme must specify Light or Dark mode.');
  if (!isRecord(value.editorFont)) throw new Error('The theme must specify typography settings.');
  const font = value.editorFont;
  if (!['system-sans', 'serif', 'monospace', 'system-font'].includes(font.baseFontFamily)) throw new Error('Unsupported font family.');
  if (typeof font.systemFontFamily !== 'string' || font.systemFontFamily.length > 200) throw new Error('Invalid installed font name.');
  if (!finiteIn(font.baseFontSize, 12, 24)) throw new Error('Font size is out of range.');
  if (![500, 600, 700, 800].includes(font.boldWeight)) throw new Error('Invalid bold weight.');
  if (!finiteIn(font.lineHeight, 1, 2.5)) throw new Error('Line height is out of range.');
  if (!['full', 'custom'].includes(value.editorWidth)) throw new Error('Invalid page width setting.');
  if (!finiteIn(value.customEditorWidthPx, 480, 3840)) throw new Error('Custom page width is out of range.');
  if (!finiteIn(value.interfaceZoom, 0.5, 2)) throw new Error('Text zoom is out of range.');
  if (![1, 1.5, 2].includes(value.toolbarIconScale)) throw new Error('Invalid icon size.');
  return {
    theme: { mode },
    editorFont: {
      baseFontFamily: font.baseFontFamily,
      systemFontFamily: font.systemFontFamily,
      baseFontSize: font.baseFontSize,
      boldWeight: font.boldWeight,
      lineHeight: font.lineHeight,
    },
    editorWidth: value.editorWidth,
    customEditorWidthPx: value.customEditorWidthPx,
    interfaceZoom: value.interfaceZoom,
    toolbarIconScale: value.toolbarIconScale,
    customColorsLight: parseColors(value.customColorsLight, 'light'),
    customColorsDark: parseColors(value.customColorsDark, 'dark'),
  };
}

function captureTheme(settings) {
  const font = { ...DEFAULT_FONT, ...settings.editorFont };
  return {
    format: FORMAT,
    version: VERSION,
    appearance: validateAppearance({
      theme: { mode: settings.theme?.mode === 'dark' ? 'dark' : 'light' },
      editorFont: font,
      editorWidth: settings.editorWidth === 'custom' ? 'custom' : 'full',
      customEditorWidthPx: settings.customEditorWidthPx ?? 768,
      interfaceZoom: settings.interfaceZoom ?? 1,
      toolbarIconScale: settings.toolbarIconScale ?? 1,
      customColorsLight: settings.customColorsLight ?? {},
      customColorsDark: settings.customColorsDark ?? {},
    }),
  };
}
// Settings > Saved Themes > Restore Default Theme: the appearance a new
// profile starts with (the defaults in src/context/ThemeContext.tsx and
// theme-colors.ts). No custom colors in either mode, default typography and
// User Interface settings. Light or Dark stays as it is.
function defaultAppearance(mode) {
  return validateAppearance({
    theme: { mode: mode === 'dark' ? 'dark' : 'light' },
    editorFont: { ...DEFAULT_FONT },
    editorWidth: 'full',
    customEditorWidthPx: 768,
    interfaceZoom: 1,
    toolbarIconScale: 1,
    customColorsLight: {},
    customColorsDark: {},
  });
}
function parseTheme(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('The selected file is not valid JSON.'); }
  if (!isRecord(value) || value.format !== FORMAT || value.version !== VERSION) {
    throw new Error('This file is not a supported PicoMarQ theme (version 1).');
  }
  return validateAppearance(value.appearance);
}
function fallbackFont(appearance, installed) {
  if (appearance.editorFont.baseFontFamily !== 'system-font') return appearance;
  const requested = appearance.editorFont.systemFontFamily.trim().toLocaleLowerCase();
  if (requested && installed.some(name => typeof name === 'string' && name.trim().toLocaleLowerCase() === requested)) return appearance;
  return { ...appearance, editorFont: { ...appearance.editorFont, baseFontFamily: 'system-sans', systemFontFamily: '' } };
}
module.exports = { captureTheme, parseTheme, fallbackFont, defaultAppearance, COLOR_KEYS };
