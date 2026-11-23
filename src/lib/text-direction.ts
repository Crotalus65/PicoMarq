// Resolve the direction a `dir="auto"` element would get for some text, using
// the browser's own bidi resolution on a hidden probe element.
//
// Why not just put dir="auto" on the textarea? Chromium re-resolves the
// direction of a text control every time its value is set, and for a large
// value that costs seconds (about 2 s for 2 MB) on every React commit that
// touches the textarea. A probe span with the same text resolves instantly,
// and the result is identical: both follow the first strong directional
// character of the text and fall back to the surrounding direction.

const STRONG_RTL_PROBE = "א"; // Hebrew alef: a strong RTL character
const PREFIX_LENGTH = 1024;

function probeDirection(text: string): "ltr" | "rtl" {
  const probe = document.createElement("span");
  probe.dir = "auto";
  probe.style.cssText = "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;white-space:pre";
  probe.textContent = text;
  document.body.appendChild(probe);
  try {
    return getComputedStyle(probe).direction === "rtl" ? "rtl" : "ltr";
  } finally {
    probe.remove();
  }
}

/**
 * Direction `dir="auto"` would resolve to for `text`.
 *
 * Only the text up to the first strong character matters, so the first
 * kilobyte is probed first; the full text is only consulted when that prefix
 * holds no strong character at all (detected by checking whether appending a
 * strong RTL character changes the answer).
 */
export function resolveAutoDirection(text: string): "ltr" | "rtl" {
  if (typeof document === "undefined") return "ltr";
  if (text.length <= PREFIX_LENGTH) return probeDirection(text);
  const prefix = text.slice(0, PREFIX_LENGTH);
  const direction = probeDirection(prefix);
  if (probeDirection(prefix + STRONG_RTL_PROBE) === direction) return direction;
  return probeDirection(text);
}
