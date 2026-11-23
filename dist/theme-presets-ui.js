/* PicoMarQ Saved Themes controls: Save Theme, Load Theme (1.2.6) and
 * Restore Default Theme (1.2.7).
 * Kept as a self-contained enhancement so the offline Windows distribution
 * could reuse the verified 1.2.4 renderer bundle without recompiling it.
 * The same file is shipped by Vite from public/ during normal source builds.
 */
(() => {
  'use strict';
  const SECTION_ID = 'picomarq-saved-themes';
  let queued = false;

  function createControls() {
    const section = document.createElement('section');
    section.id = SECTION_ID;
    section.setAttribute('aria-label', 'Saved Themes');
    section.innerHTML = `
      <h2 class="text-xl font-medium mb-3">Saved Themes</h2>
      <div class="rounded-[10px] border border-border p-4 space-y-3">
        <p class="text-xs text-text-muted">Save Theme and Load Theme use JSON files. By default, files are stored in the Themes folder beside PicoMarQ.exe. Restore Default Theme returns colors, typography, and User Interface settings to their defaults.</p>
        <div class="flex flex-wrap gap-2">
          <button type="button" data-theme-action="save" class="inline-flex items-center justify-center whitespace-nowrap font-medium cursor-pointer transition-colors h-9 px-4 bg-accent text-text-inverse hover:bg-accent/90 rounded-md">Save Theme…</button>
          <button type="button" data-theme-action="load" class="inline-flex items-center justify-center whitespace-nowrap font-medium cursor-pointer transition-colors h-9 px-4 border border-border bg-transparent hover:bg-bg-muted text-text rounded-md">Load Theme…</button>
          <button type="button" data-theme-action="restore" class="inline-flex items-center justify-center whitespace-nowrap font-medium cursor-pointer transition-colors h-9 px-4 border border-border bg-transparent hover:bg-bg-muted text-text rounded-md">Restore Default Theme…</button>
        </div>
        <p data-theme-status role="status" aria-live="polite" class="text-xs text-text-muted" hidden></p>
      </div>`;
    const status = section.querySelector('[data-theme-status]');
    const buttons = Array.from(section.querySelectorAll('[data-theme-action]'));
    for (const button of buttons) {
      button.addEventListener('click', async () => {
        if (!window.desktop?.invoke) {
          status.textContent = 'Theme files require the desktop edition of PicoMarQ.';
          status.hidden = false;
          return;
        }
        buttons.forEach(b => { b.disabled = true; b.style.opacity = '0.6'; });
        status.hidden = true;
        const action = button.dataset.themeAction;
        try {
          const result = action === 'restore'
            // Light or Dark stays as it is on screen.
            ? await window.desktop.invoke('restore_default_theme', { mode: document.documentElement.classList.contains('dark') ? 'dark' : 'light' })
            : await window.desktop.invoke(action === 'load' ? 'load_theme' : 'save_theme');
          if (result) {
            const name = String(result.path || '').split(/[\\/]/).pop();
            status.textContent = action === 'restore'
              ? 'Restored the default theme.'
              : `${action === 'load' ? 'Loaded' : 'Saved'} theme: ${name}${result.fontFallback ? '. Font not installed; using Sans.' : ''}`;
            status.style.color = 'var(--color-text-muted)';
            status.hidden = false;
          }
        } catch (error) {
          status.textContent = `Could not ${action === 'restore' ? 'restore the default' : action} theme: ${error?.message || String(error)}`;
          status.style.color = 'var(--color-text)';
          status.hidden = false;
        } finally {
          buttons.forEach(b => { b.disabled = false; b.style.opacity = ''; });
        }
      });
    }
    return section;
  }

  function attach() {
    if (document.getElementById(SECTION_ID)) return;
    const headings = document.querySelectorAll('h2');
    let startup = null;
    let interfaceSection = null;
    for (const heading of headings) {
      if (heading.textContent.trim() === 'Startup') startup = heading.closest('section');
      if (heading.textContent.trim() === 'User Interface') interfaceSection = heading.closest('section');
    }
    // Only enhance the actual Appearance screen, not unrelated content.
    if (!startup || !interfaceSection || startup.parentElement !== interfaceSection.parentElement) return;
    const wrapper = startup.parentElement;
    const divider = document.createElement('div');
    divider.className = 'border-t border-border border-dashed';
    const existingDivider = startup.previousElementSibling;
    const insertBefore = existingDivider?.classList.contains('border-dashed') ? existingDivider : startup;
    wrapper.insertBefore(divider, insertBefore);
    wrapper.insertBefore(createControls(), insertBefore);
  }
  function queueAttach() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; attach(); });
  }
  new MutationObserver(queueAttach).observe(document.documentElement, { childList: true, subtree: true });
  queueAttach();
})();
