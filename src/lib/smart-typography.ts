// Smart typography: straight quotes become curly quotes, two hyphens become an
// em dash, and three periods become an ellipsis. Pure functions shared by the
// as-you-type rules (formatted view and Markdown source view) and the
// Edit > Apply Smart Typography command.

/** Characters after which a quote opens rather than closes. */
const OPENING_CONTEXT = /[\s([{<‘“'"—– ]/;

export function isOpeningContext(previousCharacter: string): boolean {
  return previousCharacter === "" || OPENING_CONTEXT.test(previousCharacter);
}

export interface Conversion {
  text: string;
  /** Number of replacements made. */
  count: number;
}

/**
 * Convert a run of prose. `previousCharacter` is the character just before
 * `text` in the same paragraph (or "" at the start), which decides whether a
 * leading quote opens or closes.
 *
 * Exactly two hyphens become an em dash; runs of three or more are left alone
 * because they are Markdown syntax (horizontal rules, front-matter fences,
 * table separators).
 */
export function convertTypography(text: string, previousCharacter = ""): Conversion {
  let out = "";
  let prev = previousCharacter;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "-") {
      if (text[i + 1] === "-" && text[i + 2] !== "-" && prev !== "-") {
        out += "—";
        prev = "—";
        count++;
        i++;
        continue;
      }
    } else if (ch === ".") {
      if (text[i + 1] === "." && text[i + 2] === ".") {
        out += "…";
        prev = "…";
        count++;
        i += 2;
        continue;
      }
    } else if (ch === '"') {
      const quote = isOpeningContext(prev) ? "“" : "”";
      out += quote;
      prev = quote;
      count++;
      continue;
    } else if (ch === "'") {
      const quote = isOpeningContext(prev) ? "‘" : "’";
      out += quote;
      prev = quote;
      count++;
      continue;
    }
    out += ch;
    prev = ch;
  }
  return { text: out, count };
}

/** Whether the character at `index` follows an odd number of backslashes. */
function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  while (index - 1 - backslashes >= 0 && value[index - 1 - backslashes] === "\\") backslashes++;
  return backslashes % 2 === 1;
}

export interface Replacement {
  from: number;
  to: number;
  text: string;
}

/**
 * The replacement to make right after one character was typed into plain
 * text, with the caret now at `caret` (just after the typed character), or
 * null when nothing applies. Used by the Markdown source view.
 *
 * A third hyphen gives the two hyphens back ("—" + "-" → "---") so horizontal
 * rules, front-matter fences and table rows can still be typed. A character
 * preceded by a backslash is a Markdown escape (`\"`, `\-`, `\.`) and is left
 * alone, as is a pair whose first character is escaped.
 */
export function keystrokeReplacement(value: string, caret: number): Replacement | null {
  if (caret < 1 || caret > value.length) return null;
  const typed = value[caret - 1];
  const before = value.slice(Math.max(0, caret - 4), caret - 1);
  const prev = before.slice(-1);
  if (isEscaped(value, caret - 1)) return null;
  switch (typed) {
    case "-":
      if (prev === "—") return { from: caret - 2, to: caret, text: "---" };
      if (prev === "-" && before.slice(-2, -1) !== "-" && !isEscaped(value, caret - 2)) return { from: caret - 2, to: caret, text: "—" };
      return null;
    case ".":
      return before.endsWith("..") && !before.endsWith("...") && !isEscaped(value, caret - 3) ? { from: caret - 3, to: caret, text: "…" } : null;
    case '"':
      return { from: caret - 1, to: caret, text: isOpeningContext(prev) ? "“" : "”" };
    case "'":
      return { from: caret - 1, to: caret, text: isOpeningContext(prev) ? "‘" : "’" };
    default:
      return null;
  }
}

const FENCE_LINE = /^[ \t]{0,3}(?:`{3,}|~{3,})/gm;
const MATH_BLOCK_LINE = /^[ \t]*\$\$[ \t]*$/gm;
const REFERENCE_DEFINITION = /^[ \t]{0,3}\[[^\]]+\]:[ \t]/;
const TABLE_DELIMITER_ROW_SO_FAR = /^[ \t]*\|?[ \t|:-]*$/;

/**
 * Whether the caret in Markdown source sits where typography must not be
 * touched: front matter, fenced code, $$ math, HTML comments or tags, inline
 * code, link destinations, reference definitions, or a table separator row.
 */
export function insideProtectedMarkdown(value: string, caret: number): boolean {
  const before = value.slice(0, caret);
  if (/^---[ \t]*\r?\n/.test(before) && !/\r?\n---[ \t]*(?:\r?\n|$)/.test(before.slice(3))) return true;
  const fences = before.match(FENCE_LINE);
  if (fences && fences.length % 2 === 1) return true;
  const mathLines = before.match(MATH_BLOCK_LINE);
  if (mathLines && mathLines.length % 2 === 1) return true;
  const commentOpen = before.lastIndexOf("<!--");
  if (commentOpen !== -1 && before.indexOf("-->", commentOpen) === -1) return true;
  const line = before.slice(before.lastIndexOf("\n") + 1);
  if ((line.match(/`/g) || []).length % 2 === 1) return true;
  // Only $$ math is a feature of this editor; a single $ is an ordinary
  // dollar sign, so "$5 and 'overtime' at $10" still gets its apostrophe.
  if ((line.match(/\$\$/g) || []).length % 2 === 1) return true;
  const linkOpen = line.lastIndexOf("](");
  if (linkOpen !== -1 && line.indexOf(")", linkOpen) === -1) return true;
  const tagOpen = line.lastIndexOf("<");
  if (tagOpen !== -1 && /^<[A-Za-z/!]/.test(line.slice(tagOpen)) && line.indexOf(">", tagOpen) === -1) return true;
  if (REFERENCE_DEFINITION.test(line)) return true;
  if (line.includes("|") && TABLE_DELIMITER_ROW_SO_FAR.test(line) && /-/.test(line)) return true;
  return false;
}

/**
 * The same question as insideProtectedMarkdown, for many places in one text
 * (Replace All in the Markdown source view): the returned function must be
 * asked in ascending order. It reads the text once, where asking
 * insideProtectedMarkdown each time would read everything before each place.
 */
export function protectedMarkdownPlaces(value: string): (caret: number) => boolean {
  const opensFrontMatter = /^---[ \t]*\r?\n/.test(value);
  // What is known at the start of the current line.
  let lineStart = 0;
  let frontMatterOpen = false;
  let fences = 0;
  let mathLines = 0;
  let commentOpen = false;
  const passLine = (end: number) => {
    const line = value.slice(lineStart, end);
    if (lineStart === 0) frontMatterOpen = opensFrontMatter;
    else if (frontMatterOpen && /^---[ \t]*\r?$/.test(line)) frontMatterOpen = false;
    if (/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(line)) fences++;
    if (/^[ \t]*\$\$[ \t]*\r?$/.test(line)) mathLines++;
    const opened = line.lastIndexOf("<!--");
    if (opened !== -1) commentOpen = line.indexOf("-->", opened) === -1;
    else if (commentOpen && line.includes("-->")) commentOpen = false;
    lineStart = end + 1;
  };
  return (caret: number) => {
    for (let end = value.indexOf("\n", lineStart); end !== -1 && end < caret; end = value.indexOf("\n", lineStart)) passLine(end);
    const line = value.slice(lineStart, caret);
    if (frontMatterOpen && !/^---[ \t]*$/.test(line)) return true;
    if ((fences + (/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(line) ? 1 : 0)) % 2 === 1) return true;
    if ((mathLines + (/^[ \t]*\$\$[ \t]*$/.test(line) ? 1 : 0)) % 2 === 1) return true;
    const opened = line.lastIndexOf("<!--");
    if (opened !== -1 ? line.indexOf("-->", opened) === -1 : commentOpen && !line.includes("-->")) return true;
    if ((line.match(/`/g) || []).length % 2 === 1) return true;
    if ((line.match(/\$\$/g) || []).length % 2 === 1) return true;
    const linkOpen = line.lastIndexOf("](");
    if (linkOpen !== -1 && line.indexOf(")", linkOpen) === -1) return true;
    const tagOpen = line.lastIndexOf("<");
    if (tagOpen !== -1 && /^<[A-Za-z/!]/.test(line.slice(tagOpen)) && line.indexOf(">", tagOpen) === -1) return true;
    if (REFERENCE_DEFINITION.test(line)) return true;
    if (line.includes("|") && TABLE_DELIMITER_ROW_SO_FAR.test(line) && /-/.test(line)) return true;
    return false;
  };
}

// Inline spans inside a prose line that must be copied through unchanged,
// starting with a backslash escape and the character it protects.
const PROTECTED_INLINE =
  /\\.|(`+)[^`]*?\1|\$\$[^$]*\$\$|\]\([^)]*\)|<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|<[A-Za-z][A-Za-z0-9+.-]*:[^>\s]*>|\[\[[^\]]*\]\]/g;
const TABLE_DELIMITER_ROW = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

function convertProseLine(line: string): Conversion {
  let out = "";
  let count = 0;
  let last = 0;
  let prev = "";
  PROTECTED_INLINE.lastIndex = 0;
  for (let match = PROTECTED_INLINE.exec(line); match; match = PROTECTED_INLINE.exec(line)) {
    const prose = convertTypography(line.slice(last, match.index), prev);
    out += prose.text + match[0];
    count += prose.count;
    prev = match[0].slice(-1);
    last = match.index + match[0].length;
    if (match[0].length === 0) PROTECTED_INLINE.lastIndex++;
  }
  const tail = convertTypography(line.slice(last), prev);
  return { text: out + tail.text, count: count + tail.count };
}

/**
 * Apply smart typography to a whole Markdown document, leaving front matter,
 * fenced code, $$ math, HTML, inline code, link destinations, reference
 * definitions, table separator rows and backslash escapes exactly as they are.
 */
export function convertMarkdownTypography(markdown: string): Conversion {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let count = 0;
  let state: "prose" | "frontmatter" | "fence" | "math" | "comment" = "prose";
  let fence = "";
  lines.forEach((line, index) => {
    if (state === "frontmatter") {
      out.push(line);
      if (/^---[ \t]*\r?$/.test(line)) state = "prose";
      return;
    }
    if (state === "fence") {
      out.push(line);
      const closing = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*\r?$/);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length) state = "prose";
      return;
    }
    if (state === "math") {
      out.push(line);
      if (/^[ \t]*\$\$[ \t]*\r?$/.test(line)) state = "prose";
      return;
    }
    if (state === "comment") {
      out.push(line);
      if (line.includes("-->")) state = "prose";
      return;
    }
    if (index === 0 && /^---[ \t]*\r?$/.test(line)) {
      out.push(line);
      state = "frontmatter";
      return;
    }
    const opening = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (opening) {
      out.push(line);
      fence = opening[1];
      state = "fence";
      return;
    }
    if (/^[ \t]*\$\$[ \t]*\r?$/.test(line)) {
      out.push(line);
      state = "math";
      return;
    }
    if (REFERENCE_DEFINITION.test(line) || TABLE_DELIMITER_ROW.test(line)) {
      out.push(line);
      return;
    }
    const commentStart = line.indexOf("<!--");
    if (commentStart !== -1 && line.indexOf("-->", commentStart) === -1) {
      const converted = convertProseLine(line.slice(0, commentStart));
      out.push(converted.text + line.slice(commentStart));
      count += converted.count;
      state = "comment";
      return;
    }
    const converted = convertProseLine(line);
    out.push(converted.text);
    count += converted.count;
  });
  return { text: out.join("\n"), count };
}
