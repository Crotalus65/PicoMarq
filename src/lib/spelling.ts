// Spell checking for text the user did not type.
//
// After a change it did not see typed (a paste, text from the Markdown source
// view), Chromium rechecks only about 128 characters around the cursor; it
// checks a whole document again only after more than about 1,000 characters
// have changed.
// Switching spell checking off and on for the editor makes Chromium forget
// that the document was already checked, so its next idle pass (about a
// second later) checks the whole document again. Underlines elsewhere in the
// document disappear until then.
//
// This works only together with the UnrestrictSpellingAndGrammarForTesting
// switch in desktop/main.cjs; without it, Chromium ignores spell checking
// being turned back on.
//
// Chromium follows through only if, when its idle pass runs, the caret is in
// the editor, in text that is displayed and has spell checking on. Otherwise
// it gives up, and the underlines stay away until the caret next moves. So
// the switching waits until the editor is on screen and holds the caret.
//
// And the idle pass has to get its turn: see drawFrames below.
//
// There is a second way to a whole-document check, which leaves the
// underlines in place while it runs: see recheckSpellingQuietly below.

const pending = new WeakMap<HTMLElement, number>();
const scheduled = new WeakMap<HTMLElement, number>();
const waiting = new WeakSet<HTMLElement>();
const hidden = new WeakMap<HTMLElement, IntersectionObserver>();
const quiet = new WeakMap<HTMLElement, number>();
let lastSwitching = 0;
let framesUntil = 0;
let drawingFrames = false;

/**
 * Keep the window drawing frames for a while.
 *
 * Chromium checks a whole document as idle work, a second after the
 * switching and then piece by piece. In a window that stands still that
 * work sometimes does not get its turn: with text selected (as it is after
 * a right-click on a word, or after Undo) there is not even a blinking
 * caret, no frame is drawn, and about four rechecks in ten then waited,
 * with every red line outside the caret's paragraph missing, until the
 * mouse moved. A trace showed that the whole-document check had not
 * started; two frames drawn by hand started it. A frame costs next to
 * nothing when nothing has changed.
 */
function drawFrames(milliseconds: number): void {
  framesUntil = Math.max(framesUntil, performance.now() + milliseconds);
  if (drawingFrames) return;
  drawingFrames = true;
  const frame = () => {
    if (performance.now() < framesUntil) requestAnimationFrame(frame);
    else drawingFrames = false;
  };
  requestAnimationFrame(frame);
}

// Chromium runs its background checks only on the editable text that holds
// the caret, and only while the caret is at a place where spell checking is
// on. With the caret somewhere else (the Find box) or inside an element with
// spellcheck="false", a recheck asked for now would clear every underline
// and bring none back.
function caretAllowsChecking(editor: HTMLElement): boolean {
  const node = document.getSelection()?.focusNode;
  const element = node instanceof Element ? node : node?.parentElement;
  if (!element || !editor.contains(element)) return false;
  const off = element.closest('[spellcheck="false"]');
  return off === null || off === editor || !editor.contains(off);
}

/**
 * The wrapper around the first letter of an ignored word (IgnoredSpelling.ts)
 * is such an element, and the caret is "inside" it when it stands right after
 * that letter, or before it at the start of a paragraph. The same place can
 * be named from outside the wrapper, where spell checking is on: the caret
 * does not move on screen and the editor reads the same position. Returns
 * false if the selection ends inside a wrapper where that is not possible.
 */
export function keepCaretOutOfIgnoredWords(editor: HTMLElement): boolean {
  const selection = document.getSelection();
  const node = selection?.focusNode;
  if (!selection || !node) return true;
  const element = node instanceof Element ? node : node.parentElement;
  const wrapper = element?.closest("[data-ignored-spelling]");
  if (!wrapper || !wrapper.parentNode || !editor.contains(wrapper)) return true;
  const before = document.createRange();
  before.selectNodeContents(wrapper);
  before.setEnd(node, selection.focusOffset);
  const after = document.createRange();
  after.selectNodeContents(wrapper);
  after.setStart(node, selection.focusOffset);
  const atEnd = after.toString() === "";
  if (!atEnd && before.toString() !== "") return false;
  // Preferably in the text next to the wrapper, where the arrow keys carry
  // on as usual; failing that (nothing beside it), between the nodes.
  const text = atEnd ? firstText(wrapper.nextSibling) : lastText(wrapper.previousSibling);
  const index = Array.prototype.indexOf.call(wrapper.parentNode.childNodes, wrapper);
  const target: Node = text ?? wrapper.parentNode;
  const offset = text ? (atEnd ? 0 : text.length) : (atEnd ? index + 1 : index);
  if (selection.isCollapsed || !selection.anchorNode) selection.collapse(target, offset);
  else selection.setBaseAndExtent(selection.anchorNode, selection.anchorOffset, target, offset);
  return true;
}

function firstText(node: Node | null): Text | null {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  return document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
}

function lastText(node: Node | null): Text | null {
  if (!node) return null;
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  return document.createTreeWalker(node, NodeFilter.SHOW_TEXT).lastChild() as Text | null;
}

/** Recheck as soon as the caret is in the editor, at a place that allows checking. */
function recheckWhenCaretAllows(editor: HTMLElement): void {
  if (waiting.has(editor)) return;
  waiting.add(editor);
  const retry = () => {
    if (editor.isConnected && !caretAllowsChecking(editor)) return;
    document.removeEventListener("selectionchange", retry);
    waiting.delete(editor);
    if (editor.isConnected) recheckSpelling(editor);
  };
  document.addEventListener("selectionchange", retry);
}

/**
 * Recheck once the editor is on screen again. While it is hidden (Settings
 * or the Markdown source view is open) Chromium would drop every underline
 * and, finding the caret in text that is not displayed, stop checking: the
 * underlines would stay away until the caret is moved.
 */
function recheckWhenShown(editor: HTMLElement): void {
  if (hidden.has(editor)) return;
  // The callback must not hold on to the editor: an observer that is
  // observing is kept alive, and would keep a closed document's editor too.
  const observer = new IntersectionObserver((entries) => {
    const shown = entries.find(entry => entry.isIntersecting);
    if (!shown) return;
    observer.disconnect();
    hidden.delete(shown.target as HTMLElement);
    recheckSpelling(shown.target as HTMLElement);
  });
  hidden.set(editor, observer);
  observer.observe(editor);
}

/** Drop a recheck that recheckSpellingSoon has scheduled, or that waits for the editor to be shown. */
export function cancelSpellingRecheck(editor: HTMLElement | null | undefined): void {
  if (!editor) return;
  hidden.get(editor)?.disconnect();
  hidden.delete(editor);
  const timer = scheduled.get(editor);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  scheduled.delete(editor);
}

export function recheckSpelling(editor: HTMLElement | null | undefined): void {
  if (!editor) return;
  // This recheck covers whatever a scheduled one was for.
  cancelSpellingRecheck(editor);
  const previous = pending.get(editor);
  if (previous !== undefined) window.clearTimeout(previous);
  // After the paste or new content is in the document.
  pending.set(editor, window.setTimeout(() => {
    pending.delete(editor);
    if (!editor.isConnected || editor.getAttribute("spellcheck") !== "true") return;
    if (editor.getClientRects().length === 0) { recheckWhenShown(editor); return; }
    keepCaretOutOfIgnoredWords(editor);
    if (!caretAllowsChecking(editor)) { recheckWhenCaretAllows(editor); return; }
    cancelQuietRecheck(editor);
    lastSwitching = performance.now();
    editor.setAttribute("spellcheck", "false");
    editor.setAttribute("spellcheck", "true");
    // Two seconds for a short document; a 2 MB one takes Chromium up to ten.
    drawFrames(2000 + (editor.textContent?.length ?? 0) / 250);
  }, 0));
}

/**
 * The same recheck, once editing has paused. For underlines that were lost
 * where Chromium will not look again by itself (see IgnoredSpelling.ts);
 * waiting keeps the other underlines from blinking in the middle of typing.
 */
export function recheckSpellingSoon(editor: HTMLElement | null | undefined, delay = 1000): void {
  if (!editor) return;
  cancelSpellingRecheck(editor);
  scheduled.set(editor, window.setTimeout(() => {
    scheduled.delete(editor);
    recheckSpelling(editor);
  }, delay));
}

/** Editing goes on: move a scheduled recheck further away. */
export function postponeSpellingRecheck(editor: HTMLElement | null | undefined, delay = 1000): void {
  if (editor && scheduled.has(editor)) recheckSpellingSoon(editor, delay);
}

// The quiet whole-document check.
//
// Chromium checks a whole document again by itself, without being asked,
// once the length of its text has changed by more than 1,024 characters
// since the last whole check. That check replaces the underlines piece by
// piece: nothing disappears first. The editor asks for it by changing the
// length of the text Chromium counts, without touching the document: an
// invisible piece of filler inside the editor element (put there by
// QuietRecheck.ts) is filled or emptied. Chromium notices at its next idle
// pass, which is started here by switching spell checking on for an element
// that holds nothing.
//
// If Chromium cannot check now (the caret is elsewhere, the editor is
// hidden), nothing is lost: the changed length still counts at its next
// pass, which the next caret movement in the document starts.

const FILLER_LENGTH = 1100;
// Milliseconds after a recheck by switching in which a change is sure to be
// in time for that recheck's own pass over the document.
const SWITCHING_COVERS = 800;
// The filler is never empty. An empty element that cannot be edited, at the
// end of the document, is a place of its own for Chromium's caret: Ctrl+End
// went behind it instead of to the end of the last line, and Chromium does
// not scroll to a caret there. With text in it, the caret passes it by.
const FILLER_SHORT = "\u00A0";
const FILLER_LONG = "\u00A0".repeat(1 + FILLER_LENGTH);
let poke: HTMLElement | null = null;

/** The filler element for one editor. It takes no room, cannot be selected, and is not read aloud. */
export function createSpellingFiller(): HTMLElement {
  const filler = document.createElement("span");
  filler.setAttribute("data-spelling-filler", "");
  filler.setAttribute("aria-hidden", "true");
  filler.setAttribute("spellcheck", "false");
  // No clipping here: Chromium leaves text out of its count when a box of no size clips it.
  filler.style.cssText = "position:absolute;font-size:0;line-height:0;white-space:pre;user-select:none;pointer-events:none";
  filler.textContent = FILLER_SHORT;
  return filler;
}

function cancelQuietRecheck(editor: HTMLElement): void {
  const timer = quiet.get(editor);
  if (timer === undefined) return;
  window.clearTimeout(timer);
  quiet.delete(editor);
}

/**
 * Have the whole document checked again without any underline blinking,
 * shortly after editing pauses. For changes that are not typed (formatting,
 * Undo, a paragraph split or joined), which leave text without underlines
 * where Chromium does not look again by itself.
 */
export function recheckSpellingQuietly(editor: HTMLElement | null | undefined, delay = 300): void {
  if (!editor) return;
  cancelQuietRecheck(editor);
  const asked = performance.now();
  quiet.set(editor, window.setTimeout(() => {
    quiet.delete(editor);
    if (!editor.isConnected || editor.getAttribute("spellcheck") !== "true") return;
    // A recheck by switching covers this change if it is still to come, or
    // if its whole-document pass had not started yet when the change was
    // made: that pass starts a second after the switching at the earliest.
    // A change made later than that is not covered by it.
    if (pending.has(editor) || asked - lastSwitching < SWITCHING_COVERS) return;
    const filler = editor.querySelector<HTMLElement>(":scope > [data-spelling-filler]");
    if (!filler) return;
    filler.textContent = filler.textContent === FILLER_SHORT ? FILLER_LONG : FILLER_SHORT;
    if (!poke) {
      poke = document.createElement("span");
      poke.hidden = true;
      document.body.appendChild(poke);
    }
    poke.setAttribute("spellcheck", "false");
    poke.setAttribute("spellcheck", "true");
    drawFrames(2000 + (editor.textContent?.length ?? 0) / 250);
  }, delay));
}

