// What Find looks for.
//
// Capital and small letters count as the same. And what the keyboard gives
// finds what Smart Typography makes of it: a straight apostrophe or
// quotation mark also finds the curly ones, two hyphens also find an em
// dash, three periods also find an ellipsis. It works one way only: a curly
// quote, an em dash or an ellipsis in the Find box (pasted there) finds
// itself and nothing else, so an exact search stays possible, and an em dash
// never matches the hyphens of a table line or of code.
//
// The rules follow convertTypography in smart-typography.ts: exactly two
// hyphens are a dash (a longer run is Markdown syntax and is looked for as
// it is), and periods count in threes from the left.

export interface Found {
  from: number;
  to: number;
}

const SYNTAX = /[\\^$.*+?()[\]{}|]/g;

/** The pattern for a Find query, or null for an empty query. */
export function findPattern(query: string): RegExp | null {
  if (!query) return null;
  let source = "";
  for (let i = 0; i < query.length;) {
    const ch = query[i];
    if (ch === "'") {
      source += "['‘’]";
      i++;
    } else if (ch === '"') {
      source += '["“”]';
      i++;
    } else if (ch === "-") {
      let run = 1;
      while (query[i + run] === "-") run++;
      source += run === 2 ? "(?:--|—)" : "-".repeat(run);
      i += run;
    } else if (ch === ".") {
      let run = 1;
      while (query[i + run] === ".") run++;
      source += "(?:\\.\\.\\.|…)".repeat(Math.floor(run / 3)) + "\\.".repeat(run % 3);
      i += run;
    } else {
      const character = String.fromCodePoint(query.codePointAt(i) as number);
      source += character.replace(SYNTAX, "\\$&");
      i += character.length;
    }
  }
  return new RegExp(source, "giu");
}

/**
 * The matches in one text, in order and without overlaps. At most `limit`
 * of them are listed; all of them are counted.
 */
export function findInText(text: string, pattern: RegExp, limit = Infinity): { matches: Found[]; total: number } {
  const matches: Found[] = [];
  let total = 0;
  pattern.lastIndex = 0;
  for (let match; (match = pattern.exec(text));) {
    if (match[0].length === 0) { pattern.lastIndex++; continue; }
    total++;
    if (matches.length < limit) matches.push({ from: match.index, to: match.index + match[0].length });
  }
  return { matches, total };
}
