"""Browser-only regression test for PicoMarQ theme/quote display.

Usage: python tests/colors-browser-smoke.py
Requires Python's playwright package and /usr/bin/chromium.
Loads bundled CSS/JS into an isolated about:blank document with an in-memory
localStorage shim. Does not exercise Electron or filesystem saves.
"""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
MARKDOWN = "# Heading one\n\n## Heading two\n\n### Heading three\n\n#### Heading four\n\nRegular *italic* and **bold**.\n\n> Quoted *italic* and **bold**.\n"
HTML = (ROOT / 'dist/index.html').read_text()
CSS = (ROOT / 'dist/assets' / re.search(r'href="\./assets/([^"\s]+\.css)"', HTML).group(1)).read_text()
JS = (ROOT / 'dist/assets' / re.search(r'src="\./assets/([^"\s]+\.js)"', HTML).group(1)).read_text()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path="/usr/bin/chromium", args=["--no-sandbox", "--disable-gpu"])
    page = browser.new_page(viewport={"width": 1300, "height": 1100})
    errors = []
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.set_content('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>')
    page.evaluate("""({content}) => {
      const data = new Map();
      Object.defineProperty(window, 'localStorage', {configurable: true, value: {
        getItem: k => data.get(k) ?? null,
        setItem: (k,v) => data.set(k,String(v)),
        removeItem: k => data.delete(k)
      }});
      localStorage.setItem('scratch-settings', JSON.stringify({theme: {mode: 'light'}, smartTypography: false}));
      localStorage.setItem('scratch-session', JSON.stringify({documents: [{id:'verify', name:'Formatting checks', path:null, content, diskContent:content, modified:0, view:{}}], activeDocumentId:'verify', settingsOpen:false}));
    }""", {"content": MARKDOWN})
    page.add_style_tag(content=CSS)
    page.add_script_tag(content=JS, type='module')
    editor = page.locator('.tiptap').first
    editor.locator('blockquote').wait_for(timeout=15000)

    # Light defaults: all distinct formatted elements are truly black.
    assert editor.locator('h1').evaluate('(el)=>getComputedStyle(el).color') == 'rgb(0, 0, 0)'
    assert editor.locator('h4').evaluate('(el)=>getComputedStyle(el).color') == 'rgb(0, 0, 0)'
    assert editor.locator('p').first.evaluate('(el)=>getComputedStyle(el).color') == 'rgb(0, 0, 0)'
    quote = editor.locator('blockquote')
    assert quote.evaluate('(el)=>getComputedStyle(el).fontStyle') == 'normal', 'Quotation must not be italicized'
    assert quote.evaluate('(el)=>getComputedStyle(el).fontWeight') == '400'
    assert quote.evaluate('(el)=>getComputedStyle(el.querySelector("p"), "::before").content') == 'none'
    assert quote.evaluate('(el)=>getComputedStyle(el.querySelector("p"), "::after").content') == 'none'
    assert quote.locator('em').evaluate('(el)=>getComputedStyle(el).fontStyle') == 'italic'
    assert quote.locator('em').evaluate('(el)=>getComputedStyle(el).color') == 'rgb(0, 0, 0)'
    assert quote.evaluate('(el)=>getComputedStyle(el).borderLeftWidth') != '0px'
    print('PASS: quote is roman, explicit emphasis italic, marks absent, gray rule retained')

    # Settings only: choose a heading color, and an italic color.
    page.locator('button[title^="Settings"]').click()
    page.get_by_text('Customize colors', exact=True).click()
    assert page.get_by_text('Surfaces', exact=True).count() == 1
    assert page.get_by_text('Text', exact=True).count() == 1
    assert page.get_by_text('UI', exact=True).count() == 1
    for label, color in [('Heading 2', 'AA1122'), ('Italic', '3366CC'), ('Bold', '118833')]:
        row = page.get_by_text(label, exact=True).locator('..')
        row.get_by_role('button', name='Pick color').click()
        row.locator('input[type=text]').fill(color)
        row.get_by_role('button', name='Pick color').click()
    settings = page.evaluate('JSON.parse(localStorage.getItem("scratch-settings"))')
    assert settings['customColorsLight']['heading-2'] == '#aa1122', settings
    assert settings['customColorsLight']['italic'] == '#3366cc', settings
    assert settings['customColorsLight']['bold'] == '#118833', settings
    page.get_by_role('button', name='Back to document').click()
    assert editor.locator('h2').evaluate('(el)=>getComputedStyle(el).color') == 'rgb(170, 17, 34)'
    assert quote.locator('em').evaluate('(el)=>getComputedStyle(el).color') == 'rgb(51, 102, 204)'
    assert quote.locator('strong').evaluate('(el)=>getComputedStyle(el).color') == 'rgb(17, 136, 51)'
    assert quote.evaluate('(el)=>getComputedStyle(el).fontStyle') == 'normal'
    print('PASS: per-category picker updates heading, bold, and italic display colors')

    # No display color leaks into Markdown; no mutation or dirty flag.
    assert page.evaluate('JSON.parse(localStorage.getItem("scratch-session")).documents[0].content') == MARKDOWN
    assert page.locator('.tiptap').first.evaluate('(el)=>el.innerText.includes("Quoted italic and bold.")')

    # Dark mode defaults independently, independent light preferences preserved.
    page.locator('button[title^="Settings"]').click()
    page.get_by_role('button', name='Dark', exact=True).click()
    page.get_by_role('button', name='Back to document').click()
    assert editor.locator('h1').evaluate('(el)=>getComputedStyle(el).color') == 'rgb(255, 255, 255)'
    assert editor.locator('h2').evaluate('(el)=>getComputedStyle(el).color') == 'rgb(255, 255, 255)'
    assert quote.locator('em').evaluate('(el)=>getComputedStyle(el).color') == 'rgb(255, 255, 255)'
    assert quote.locator('strong').evaluate('(el)=>getComputedStyle(el).color') == 'rgb(255, 255, 255)'
    assert editor.locator('p').first.evaluate('(el)=>getComputedStyle(el).color') == 'rgb(255, 255, 255)'
    assert quote.evaluate('(el)=>getComputedStyle(el).fontStyle') == 'normal'
    assert page.evaluate('JSON.parse(localStorage.getItem("scratch-settings")).customColorsLight["heading-2"]') == '#aa1122'

    # Override a different color in dark mode; neither theme overwrites the other.
    page.locator('button[title^="Settings"]').click()
    page.get_by_text('Customize colors', exact=True).click()
    dark_row = page.get_by_text('Heading 1', exact=True).locator('..')
    dark_row.get_by_role('button', name='Pick color').click()
    dark_row.locator('input[type=text]').fill('C63344')
    dark_row.get_by_role('button', name='Pick color').click()
    page.get_by_role('button', name='Back to document').click()
    assert editor.locator('h1').evaluate('(el)=>getComputedStyle(el).color') == 'rgb(198, 51, 68)'
    page.locator('button[title^="Settings"]').click()
    page.get_by_role('button', name='Light', exact=True).click()
    page.get_by_role('button', name='Back to document').click()
    assert editor.locator('h1').evaluate('(el)=>getComputedStyle(el).color') == 'rgb(0, 0, 0)'
    assert editor.locator('h2').evaluate('(el)=>getComputedStyle(el).color') == 'rgb(170, 17, 34)'

    # Source mode must contain Markdown markers, not color attributes or styles.
    page.keyboard.press('Control+Shift+m')
    source = page.get_by_role('textbox', name='Markdown source')
    source.wait_for(timeout=10000)
    raw = source.input_value()
    assert '> Quoted *italic* and **bold**.' in raw, raw
    assert 'style=' not in raw and 'color:' not in raw and '<span' not in raw, raw
    assert not errors, errors
    print('PASS: dark defaults and overrides independent of light; Markdown source unmodified; no page errors')
    browser.close()
print('ALL COLOR / QUOTE BROWSER CHECKS PASSED')
