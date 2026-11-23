// Change only the characters that differ when the editor rewrites text.
//
// ProseMirror updates a piece of text by assigning the whole new string to
// its text node. Chromium keeps its spelling marks per text node, and drops
// all of them when the node's text is replaced as a whole. So one character
// changed by something other than typing (Smart Typography putting in a
// curly apostrophe, Undo, Replace) cost a paragraph its red lines, and in a
// paragraph of more than about 1,000 characters Chromium brings back only
// those within about 500 characters of the caret.
//
// With only the changed stretch replaced, Chromium keeps the marks before it
// and moves the ones after it along. The resulting text is the same.
//
// This applies to text nodes inside an editor only; everywhere else the
// assignment works as it always did.

const inherited = Object.getOwnPropertyDescriptor(Node.prototype, "nodeValue");

if (inherited?.get && inherited.set) {
  const read = inherited.get;
  const write = inherited.set;
  Object.defineProperty(Text.prototype, "nodeValue", {
    configurable: true,
    enumerable: true,
    get(this: Text) {
      return read.call(this);
    },
    set(this: Text, value: string | null) {
      const next = value ?? "";
      const old = this.data;
      if (old === next || !this.isConnected || !this.parentElement?.closest(".ProseMirror")) {
        write.call(this, value);
        return;
      }
      const most = Math.min(old.length, next.length);
      let start = 0;
      while (start < most && old.charCodeAt(start) === next.charCodeAt(start)) start++;
      let end = 0;
      while (end < most - start && old.charCodeAt(old.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) end++;
      this.replaceData(start, old.length - start - end, next.slice(start, next.length - end));
    },
  });
}

export {};
