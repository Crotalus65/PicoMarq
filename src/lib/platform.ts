/**
 * Platform detection utilities for cross-platform shortcut labels.
 * On macOS: ⌘, ⌥, ⇧
 * On Windows/Linux: Ctrl, Alt, Shift
 */

export const isMac =
  typeof navigator !== "undefined" &&
  (window.desktop?.platform === "darwin" || /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));

export const isWindows =
  typeof navigator !== "undefined" && (window.desktop?.platform === "win32" || /Windows/.test(navigator.userAgent));

/** Modifier key symbol/label */
export const mod = isMac ? "⌘" : "Ctrl";
export const alt = isMac ? "⌥" : "Alt";
export const shift = isMac ? "⇧" : "Shift";

/**
 * Build a shortcut label string.
 * e.g. shortcut("B") => "⌘B" on Mac, "Ctrl+B" on Windows
 */
export function shortcut(...parts: string[]): string {
  if (isMac) {
    return parts.join("");
  }
  return parts.join("+");
}
