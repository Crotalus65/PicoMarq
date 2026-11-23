import { Extension, InputRule } from "@tiptap/core";

/**
 * As-you-type smart typography for the formatted view: curly quotes, em
 * dashes and ellipses. Each rule is undone by Backspace like any TipTap
 * input rule, and rules never fire inside code blocks or inline code (TipTap
 * skips those) or inside an unfinished $$ formula.
 *
 * The rules consult `enabled()` on every keystroke so the Settings toggle
 * takes effect immediately without recreating the editor.
 */
export interface SmartTypographyOptions {
  enabled: () => boolean;
}

function replacementRule(find: RegExp, replace: string, enabled: () => boolean): InputRule {
  return new InputRule({
    find,
    handler: ({ state, range, match }) => {
      if (!enabled()) return null;
      // Leave an unfinished $$ formula alone; a single $ is just a dollar sign.
      const $end = state.doc.resolve(range.to);
      const beforeCursor = $end.parent.textBetween(0, $end.parentOffset, undefined, " ");
      if ((beforeCursor.match(/\$\$/g) || []).length % 2 === 1) return null;
      // Same replacement logic as TipTap's textInputRule: when the pattern has
      // a capture group, only that group is replaced.
      let insert = replace;
      let start = range.from;
      const end = range.to;
      if (match[1]) {
        const offset = match[0].lastIndexOf(match[1]);
        insert += match[0].slice(offset + match[1].length);
        start += offset;
        const cutOff = start - end;
        if (cutOff > 0) {
          insert = match[0].slice(offset - cutOff, offset) + insert;
          start = end;
        }
      }
      state.tr.insertText(insert, start, end);
    },
  });
}

export const SmartTypography = Extension.create<SmartTypographyOptions>({
  name: "smartTypography",
  // TipTap runs input rules from the highest-priority extension down, so a
  // low priority lets StarterKit's rules (e.g. "---" → horizontal rule, which
  // already understands the em dash) take precedence over these.
  priority: 50,

  addOptions() {
    return { enabled: () => true };
  },

  addInputRules() {
    const enabled = () => this.options.enabled();
    const opening = "[\\s([{<\\u2018\\u201C'\"\\u2014\\u2013\\u00A0]";
    return [
      replacementRule(new RegExp(`(?:^|${opening})(")$`), "“", enabled),
      replacementRule(/"$/, "”", enabled),
      replacementRule(new RegExp(`(?:^|${opening})(')$`), "‘", enabled),
      replacementRule(/'$/, "’", enabled),
      // A third hyphen gives the two back, so "---" still makes a horizontal
      // rule; only a pair of hyphens not preceded by another becomes a dash.
      replacementRule(/—-$/, "---", enabled),
      replacementRule(/(?:^|[^-])(--)$/, "—", enabled),
      replacementRule(/\.\.\.$/, "…", enabled),
    ];
  },
});
