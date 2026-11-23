// Measure source offsets using the textarea's actual font and wrapping width.
// Logical newline counts cannot locate a match inside a wrapped paragraph.

export interface TextareaMeasurer {
  /** Vertical offset of the line containing `offset`, relative to the first line. */
  top: (offset: number) => number;
  /** Remove the hidden mirror element; the measurer must not be used afterwards. */
  dispose: () => void;
}

/**
 * Build a hidden mirror of the textarea once so several offsets can be
 * measured without re-laying out the text for each one.
 */
export function createTextareaMeasurer(textarea: HTMLTextAreaElement): TextareaMeasurer {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');
  mirror.setAttribute('aria-hidden', 'true');
  for (const property of [
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
    'line-height', 'letter-spacing', 'word-spacing', 'tab-size', 'text-indent',
    'text-align', 'direction', 'padding-top', 'padding-right', 'padding-bottom',
    'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width',
    'border-left-width', 'border-style', 'white-space', 'overflow-wrap', 'word-break',
  ]) mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: 'fixed', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none',
    boxSizing: 'border-box', height: 'auto', overflow: 'visible',
    // clientWidth excludes the vertical scrollbar, unlike the outer rectangle.
    width: `${textarea.clientWidth + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0)}px`,
  });
  const length = textarea.value.length;
  mirror.textContent = textarea.value + '​';
  document.body.appendChild(mirror);
  const range = document.createRange();
  const text = mirror.firstChild!;
  range.setStart(text, 0);
  range.collapse(true);
  const firstLineTop = range.getBoundingClientRect().top;
  return {
    top(offset) {
      range.setStart(text, Math.min(Math.max(offset, 0), length));
      range.collapse(true);
      return Math.max(0, range.getBoundingClientRect().top - firstLineTop);
    },
    dispose() { mirror.remove(); },
  };
}

export function textareaOffsetTops(textarea: HTMLTextAreaElement, offsets: number[]): number[] {
  if (!offsets.length) return [];
  const measurer = createTextareaMeasurer(textarea);
  try {
    return offsets.map(offset => measurer.top(offset));
  } finally { measurer.dispose(); }
}

/**
 * Largest index in [0, count) for which `test` holds, assuming `test` is true
 * for a prefix of the indexes and false afterwards; 0 when it never holds.
 * Equivalent to scanning every index and keeping the last match, but with
 * O(log n) evaluations, so expensive tests (layout measurements) stay cheap.
 */
export function lastIndexWhere(count: number, test: (index: number) => boolean): number {
  let low = 0;
  let high = count - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (test(middle)) { found = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return found;
}
