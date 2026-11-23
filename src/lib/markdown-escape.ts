// Backslash-escaping of prose for Markdown output, so that what is written to
// the file reads back as the same text. TipTap's serializer writes text nodes
// verbatim, which lost a character or changed the formatting whenever prose
// contained something Markdown treats as syntax: "5 * 3" came back in italics,
// a line beginning "1986. " came back as a numbered list, "C:\Users" lost its
// backslashes once anything followed them, and so on. These are pure string
// functions; markdown-serialize.ts applies them to the document.

export interface EscapeContext {
  /** The text begins a line of output: the start of a paragraph, or right after a hard break. */
  lineStart?: boolean;
  /** Inside a table cell, where an unescaped pipe would end the cell. */
  inTableCell?: boolean;
  /** The end of a heading, where a trailing run of "#" would be dropped as a closing sequence. */
  headingEnd?: boolean;
}

// Characters that are syntax wherever they appear: emphasis, code spans,
// links, strikethrough, and the escape character itself.
const ALWAYS = new Set(["\\", "*", "`", "[", "]", "~"]);
const WORD = /[\p{L}\p{N}]/u;
// What can follow "<" to begin an HTML tag, comment, or autolink.
const TAG_START = /[A-Za-z/!?]/;

/** Escape the characters that are syntax anywhere in a line. */
function escapeInline(line: string, inTableCell: boolean): string {
  let out = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ALWAYS.has(ch)) out += "\\" + ch;
    // An underscore between two word characters cannot open or close
    // emphasis, so snake_case stays readable.
    else if (ch === "_") out += WORD.test(line[i - 1] ?? "") && WORD.test(line[i + 1] ?? "") ? "_" : "\\_";
    else if (ch === "<") out += TAG_START.test(line[i + 1] ?? "") ? "\\<" : "<";
    // "$$" opens a math block; a lone dollar sign is just money.
    else if (ch === "$") out += line[i - 1] === "$" || line[i + 1] === "$" ? "\\$" : "$";
    else if (ch === "|" && inTableCell) out += "\\|";
    else out += ch;
  }
  return out;
}

const INDENT = /^( {0,3})([\s\S]*)$/;
const HEADING = /^#{1,6}(?:[ \t]|$)/;
const BULLET = /^[-+](?:[ \t]|$)/;
const ORDERED = /^\d{1,9}[.)](?:[ \t]|$)/;
// A line of only hyphens (or equals signs) is a horizontal rule or a setext
// heading underline for the line above it.
const RULE = /^(?:(?:-[ \t]*)+|=+[ \t]*)$/;

/** Escape what would turn a line into a heading, quote, list item or rule. */
function escapeLineStart(line: string): string {
  const [, indent, rest] = INDENT.exec(line) as RegExpExecArray;
  if (HEADING.test(rest) || rest[0] === ">" || BULLET.test(rest) || RULE.test(rest)) return indent + "\\" + rest;
  if (ORDERED.test(rest)) {
    const at = rest.search(/[.)]/);
    return indent + rest.slice(0, at) + "\\" + rest.slice(at);
  }
  return line;
}

const CLOSING_HASHES = /^([\s\S]*?(?:^|[ \t]))(#+)([ \t]*)$/;

/**
 * Escape `text` for output as Markdown prose. Newlines inside the text are
 * kept; every line after the first is a line start.
 */
export function escapeMarkdownText(text: string, context: EscapeContext = {}): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let line = escapeInline(lines[i], context.inTableCell === true);
    if (i > 0 || context.lineStart) line = escapeLineStart(line);
    lines[i] = line;
  }
  if (context.headingEnd) {
    const last = lines.length - 1;
    const match = CLOSING_HASHES.exec(lines[last]);
    if (match) lines[last] = match[1] + "\\" + match[2] + match[3];
  }
  return lines.join("\n");
}
