const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const colors = read('src/context/theme-colors.ts');
const settings = read('src/components/settings/EditorSettingsSection.tsx');
const appCss = read('src/App.css');
const types = read('src/types/note.ts');
const indexHtml = read('dist/index.html');
const runtimePath = indexHtml.match(/src="\.\/assets\/([^"\s]+\.js)"/)[1];
const runtimeCssPath = indexHtml.match(/href="\.\/assets\/([^"\s]+\.css)"/)[1];
const runtime = read(`dist/assets/${runtimePath}`);
const runtimeCss = read(`dist/assets/${runtimeCssPath}`);
const keys = ['heading-1','heading-2','heading-3','heading-4','bold','italic'];

test('six independently configurable display colors exist in source and the prebuilt UI', () => {
  for (const key of keys) {
    assert.match(types, new RegExp('\\| "'+key+'"'));
    assert.match(settings, new RegExp('key: "'+key+'"'));
    assert.match(colors, new RegExp('"?'+key+'"?: "#000000"'));
    assert.match(colors, new RegExp('"?'+key+'"?: "#ffffff"'));
    assert(runtime.includes('key:"'+key+'"'), 'prebuilt picker missing '+key);
    assert(runtime.includes('\"'+key+'\":\"#000000\"') || runtime.includes(key+':\"#000000\"'), 'prebuilt light default missing '+key);
    assert(runtime.includes('\"'+key+'\":\"#ffffff\"') || runtime.includes(key+':\"#ffffff\"'), 'prebuilt dark default missing '+key);
    assert(appCss.includes('var(--color-'+key+')'), 'source CSS missing '+key);
    assert(runtimeCss.includes('var(--color-'+key+')'), 'prebuilt CSS missing '+key);
  }
  assert.match(settings, /group: "Text"/);
  assert.match(settings, /group: "UI"/);
  assert.doesNotMatch(settings, /Text & UI/);
});

test('normal text is pure black in light and pure white in dark', () => {
  assert.match(colors, /text: "#000000"/);
  assert.match(colors, /text: "#ffffff"/);
  assert.match(appCss, /--color-text: #000000;/);
  assert.match(appCss, /--color-text: #ffffff;/);
  // The compiled stylesheet may use the short forms #000 and #fff.
  assert.match(runtimeCss, /--color-text:#(?:000|000000);/);
  assert.match(runtimeCss, /--color-text:#(?:fff|ffffff);/);
});

test('blockquote retains side rule, drops quote marks and forced italics', () => {
  assert.match(appCss, /quotes: none;/);
  assert.match(appCss, /font-style: normal;/);
  assert.match(appCss, /border-inline-start-color: var\(--color-border\);/);
  assert.match(appCss, /blockquote p:first-of-type/);
  assert.match(appCss, /blockquote p:last-of-type/);
  assert.match(appCss, /content: none;/);
  assert.match(runtimeCss, /quotes:none;/);
  assert.match(runtimeCss, /font-style:normal;/);
  assert.match(runtimeCss, /blockquote p:first-of-type/);
  assert.match(runtimeCss, /content:none/);
  assert.match(appCss, /\.prose em,[\s\S]*?\.prose i \{[\s\S]*?--color-italic/);
});

test('colors are appearance preferences, not Markdown formatting changes', () => {
  const theme = read('src/context/ThemeContext.tsx');
  assert.match(types, /customColorsLight\?: CustomColors/);
  assert.match(types, /customColorsDark\?: CustomColors/);
  assert.match(theme, /patch\(\{ \[settingKey\]: colors \}\)/);
  assert.match(theme, /--color-\$\{key\}/);
  assert(!read('src/components/editor/markdown-serialize.ts').includes('customColors'));
  assert(!read('src/components/editor/markdown-serialize.ts').includes('heading-1'));
});
