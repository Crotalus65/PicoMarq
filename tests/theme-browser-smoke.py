"""PicoMarQ renderer regression: Heading 4 and the Saved Themes controls
(Save Theme, Load Theme, Restore Default Theme), run in Chromium.
Does not invoke native Windows file dialogs; those are exercised manually.
"""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'dist/index.html').read_text()
CSS = (ROOT / 'dist/assets' / re.search(r'href="\./assets/([^"\s]+\.css)"', HTML).group(1)).read_text()
JS = (ROOT / 'dist/assets' / re.search(r'src="\./assets/([^"\s]+\.js)"', HTML).group(1)).read_text()
THEMES = (ROOT / 'dist/theme-presets-ui.js').read_text()
MD = '#### Heading four\n\n*Italic* and **bold**.\n'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1200, 'height': 1100})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.set_content('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>')
    page.evaluate('''({md}) => {
      const store = new Map();
      Object.defineProperty(window, 'localStorage', {configurable: true, value: {
        getItem: name => store.get(name) ?? null,
        setItem: (name, value) => store.set(name, String(value)),
        removeItem: name => store.delete(name)
      }});
      localStorage.setItem('scratch-settings', JSON.stringify({theme:{mode:'light'}}));
      localStorage.setItem('scratch-session', JSON.stringify({documents:[{
        id:'theme-test', name:'Theme check', path:null, content:md, diskContent:md, modified:0, view:{}
      }],activeDocumentId:'theme-test'}));
    }''', {'md': MD})
    page.add_style_tag(content=CSS)
    page.add_script_tag(content=JS, type='module')
    page.locator('.tiptap h4').wait_for(timeout=15000)
    h4 = page.locator('.tiptap h4')
    style = h4.evaluate('(el) => {const s=getComputedStyle(el);return {fontWeight:s.fontWeight,fontStyle:s.fontStyle,fontSize:s.fontSize};}')
    assert style['fontWeight'] == '600', style
    assert style['fontStyle'] == 'normal', style
    assert style['fontSize'] == '16.875px', style
    page.add_script_tag(content=THEMES)
    page.locator('button[title^="Settings"]').click()
    page.locator('#picomarq-saved-themes').wait_for(timeout=10000)
    labels = page.locator('#picomarq-saved-themes button').all_text_contents()
    assert labels == ['Save Theme…', 'Load Theme…', 'Restore Default Theme…'], labels
    # Check placement: after User Interface but before Startup.
    order = page.locator('section h2').all_text_contents()
    assert order.index('User Interface') < order.index('Saved Themes') < order.index('Startup'), order
    page.evaluate('''() => {window.desktop = {invoke: async (action, args) => {
      (window.themeCalls ||= []).push(action);
      if (action === 'restore_default_theme') { window.restoreArgs = args; return {restored: true}; }
      if (action === 'save_theme') return {path:'C:\\\\Portable\\\\Themes\\\\Academic.json'};
      if (action === 'load_theme') return {path:'C:\\\\Portable\\\\Themes\\\\Imported.json', fontFallback:true};
      throw new Error('Unexpected action');
    }}}''')
    page.get_by_role('button', name='Save Theme…').click()
    assert 'Saved theme: Academic.json' in page.locator('[data-theme-status]').inner_text()
    page.get_by_role('button', name='Load Theme…').click()
    assert 'Loaded theme: Imported.json' in page.locator('[data-theme-status]').inner_text()
    assert 'using Sans' in page.locator('[data-theme-status]').inner_text()
    page.get_by_role('button', name='Restore Default Theme…').click()
    assert page.locator('[data-theme-status]').inner_text() == 'Restored the default theme.'
    assert page.evaluate('window.restoreArgs') == {'mode': 'light'}
    assert page.evaluate('window.themeCalls') == ['save_theme', 'load_theme', 'restore_default_theme']
    # The externally attached controls survive React's theme re-renders.
    page.get_by_role('button', name='Dark', exact=True).click()
    assert page.locator('#picomarq-saved-themes').count() == 1
    page.get_by_role('button', name='Light', exact=True).click()
    assert page.locator('#picomarq-saved-themes').count() == 1
    assert page.evaluate('JSON.parse(localStorage.getItem("scratch-session")).documents[0].content') == MD
    page.evaluate("delete window.desktop")
    # 1.2.4's immediate valid-six-digit input still works.
    page.get_by_text('Customize colors', exact=True).click()
    row = page.get_by_text('Italic', exact=True).locator('..')
    row.get_by_role('button', name='Pick color').click()
    row.locator('input[type=text]').fill('D50000')
    assert page.evaluate('JSON.parse(localStorage.getItem("scratch-settings")).customColorsLight.italic') == '#d50000'
    assert not errors, errors
    print('PASS: Heading 4 bold, size unchanged; Saved Themes UI and actions, including Restore Default Theme; 1.2.4 picker and Markdown preserved')
    browser.close()
