// Equivalence harness: builds two TipTap editors with the app's Markdown
// extensions, one with the stock tokenizers/serializer/word count ("original")
// and one with the optimized versions ("fast"), and exposes comparison helpers.
import { Editor, Extension, mergeAttributes, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { TextSelection } from "@tiptap/pm/state";
import { lowlight } from "@app/components/editor/lowlight";
import { Frontmatter } from "@app/components/editor/Frontmatter";
import { Wikilink } from "@app/components/editor/Wikilink";
import { ScratchBlockMath } from "@app/components/editor/MathExtensions";
import { FastOrderedList, FastTaskList, listSourcePrefix, isOrderedListItem, isTaskListItem } from "@app/components/editor/markdown-tokenizers";
import { MarkdownEscape } from "@app/components/editor/MarkdownEscape";
import { Underline } from "@app/components/editor/Underline";
import { serializeDocumentMarkdown, escapedJSON } from "@app/components/editor/markdown-serialize";
import { IncrementalLowlightPlugin } from "@app/components/editor/lowlight-plugin";
import { countWords, countDocumentWords, countSelectedWords } from "@app/lib/word-count";

function extensions(kind: "original" | "fast") {
  const fast = kind === "fast";
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, codeBlock: false, underline: false, ...(fast ? { link: false, orderedList: false } : {}) }),
    ...(fast ? [FastOrderedList] : []),
    (fast
      ? CodeBlockLowlight.extend({
          addProseMirrorPlugins() {
            const inherited = (this.parent?.() ?? []).filter((plugin) => !String((plugin as unknown as { key?: string }).key).startsWith("lowlight$"));
            return [...inherited, IncrementalLowlightPlugin({ name: this.name, lowlight: this.options.lowlight, defaultLanguage: this.options.defaultLanguage })];
          },
        })
      : CodeBlockLowlight
    ).configure({ lowlight, defaultLanguage: null }),
    Link.configure({ openOnClick: false, HTMLAttributes: { class: "underline cursor-pointer" } }),
    Image.extend({ renderHTML({ HTMLAttributes }) { return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)]; } }).configure({ inline: false, allowBase64: true }),
    fast ? FastTaskList : TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false, HTMLAttributes: { class: "not-prose" } } }),
    Frontmatter,
    Markdown.configure({}),
    MarkdownEscape,
    Underline,
    Wikilink,
    ScratchBlockMath.configure({ katexOptions: { throwOnError: false, displayMode: true } }),
    Extension.create({ name: "noop" }),
  ];
}

const editors = {
  original: new Editor({ element: document.getElementById("a")!, extensions: extensions("original"), content: "" }),
  fast: new Editor({ element: document.getElementById("b")!, extensions: extensions("fast"), content: "" }),
};

type Kind = keyof typeof editors;
const manager = (kind: Kind) => editors[kind].storage.markdown.manager;

function parseJson(kind: Kind, md: string): string {
  return JSON.stringify(manager(kind).parse(md));
}

function decorationsToString(set: { find: () => Array<{ from: number; to: number }> } | null | undefined): string {
  if (!set) return "";
  return set.find().map((d) => `${d.from}-${d.to}:${(d as unknown as { type: { attrs: { class: string } } }).type.attrs.class}`).sort().join("|");
}
function groundTruthHighlight(kind: Kind): string {
  const editor = editors[kind];
  const plugin = IncrementalLowlightPlugin({ name: "codeBlock", lowlight, defaultLanguage: null });
  const set = (plugin.spec.state as { init: (config: unknown, state: unknown) => unknown }).init(undefined, editor.state);
  return decorationsToString(set as never);
}
function setDiff(a: string, b: string): string {
  const A = new Set(a.split("|")), B = new Set(b.split("|"));
  return `only-left: ${[...A].filter((x) => !B.has(x)).join(",")} only-right: ${[...B].filter((x) => !A.has(x)).join(",")}`;
}
function highlightClasses(kind: Kind): string {
  // Collect all decoration class strings from the lowlight plugin state.
  const editor = editors[kind];
  const plugins = editor.state.plugins.filter((p) => String((p as unknown as { key?: string }).key).startsWith("lowlight$"));
  const out: string[] = [];
  for (const plugin of plugins) {
    const set = plugin.getState(editor.state);
    if (!set) continue;
    for (const d of set.find()) out.push(`${d.from}-${d.to}:${(d as unknown as { type: { attrs: { class: string } } }).type.attrs.class}`);
  }
  return out.sort().join("|");
}

// Deterministic pseudo-random edits applied to both editors identically.
let seed = 1;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

function applyEdit(kind: Kind, step: number) {
  const editor = editors[kind];
  const size = editor.state.doc.content.size;
  const kindOfEdit = step % 13;
  let tr = editor.state.tr;
  const pos = Math.max(1, Math.min(size - 1, Math.floor(rand() * size)));
  const $pos = editor.state.doc.resolve(pos);
  const inText = $pos.parent.isTextblock;
  const blockStart = $pos.depth >= 1 ? $pos.before(1) : 0;
  const block = $pos.depth >= 1 ? $pos.node(1) : null;
  if (kindOfEdit === 0 && inText) tr = tr.insertText(" edited" + step, pos);
  else if (kindOfEdit === 1 && inText && $pos.parentOffset > 2) tr = tr.delete(pos - 2, pos);
  else if (kindOfEdit === 2 && inText) tr = tr.split(pos);
  else if (kindOfEdit === 3) { const para = editor.schema.nodes.paragraph.create(null, editor.schema.text("new paragraph " + step)); tr = tr.insert(blockStart, para); }
  else if (kindOfEdit === 4 && inText) { const from = pos, to = Math.min(size - 1, pos + 3); tr = tr.addMark(from, to, editor.schema.marks.bold.create()); }
  else if (kindOfEdit === 5) { const code = editor.schema.nodes.codeBlock.create({ language: step % 2 ? "python" : null }, editor.schema.text("def f" + step + "():\n    return " + step + "\nimport os")); tr = tr.insert(blockStart, code); }
  else if (kindOfEdit === 6 && block && block.type.name === "codeBlock") tr = tr.setBlockType(blockStart + 1, blockStart + 1, editor.schema.nodes.paragraph);
  else if (kindOfEdit === 7 && block && block.type.name === "paragraph" && inText) tr = tr.setBlockType(pos, pos, editor.schema.nodes.codeBlock, { language: "js" });
  else if (kindOfEdit === 8 && block && block.type.name === "codeBlock") tr = tr.setNodeMarkup(blockStart, undefined, { language: step % 3 === 0 ? "python" : step % 3 === 1 ? "js" : null });
  else if (kindOfEdit === 9) { const to = Math.min(size - 1, pos + 40); if (to > pos) tr = tr.delete(pos, to); }
  else if (kindOfEdit === 10 && blockStart > 0) { try { if (editor.state.doc.resolve(blockStart).nodeBefore) tr = tr.join(blockStart); } catch { /* not joinable */ } }
  else if (kindOfEdit === 11 && block) { const range = editor.state.doc.resolve(blockStart + 1).blockRange(); const wrapping = range && (window as unknown as { pmFindWrapping?: unknown }).pmFindWrapping; void wrapping; if (range) { try { tr = tr.wrap(range, [{ type: editor.schema.nodes.blockquote }]); } catch { /* cannot wrap */ } } }
  else if (kindOfEdit === 12) { editor.commands.undo(); return; }
  else tr = tr.insertText("x", pos);
  if (tr.docChanged) tr = tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size - 1))));
  editor.view.dispatch(tr);
}

function load(kind: Kind, md: string) {
  const editor = editors[kind];
  editor.commands.setContent(manager(kind).parse(md));
}

// A parsed document keeps adjacent text nodes apart (one per Markdown token),
// while the same text typed or re-parsed from escaped output may be one
// node; the two are the same document, so join them before comparing.
function joinedText(node: JSONContent): JSONContent {
  if (!node.content) return node;
  const content: JSONContent[] = [];
  for (const child of node.content.map(joinedText)) {
    const previous = content[content.length - 1];
    if (previous && previous.type === "text" && child.type === "text" && JSON.stringify(previous.marks ?? []) === JSON.stringify(child.marks ?? [])) {
      previous.text = (previous.text ?? "") + (child.text ?? "");
    } else {
      content.push({ ...child });
    }
  }
  return { ...node, content };
}

const api = {
  parseJson,
  // Compare parse output of both editors for a document.
  compareParse(md: string) { const a = parseJson("original", md); const b = parseJson("fast", md); return { same: a === b, a: a.slice(0, 400), b: b.slice(0, 400), len: a.length }; },
  // Load a document, apply N edits, and compare serializer + word count + highlighting after every edit.
  compareEdits(md: string, edits: number) {
    seed = md.length + edits;
    load("fast", md);
    load("original", md);
    const problems: string[] = [];
    const staleOriginal: string[] = [];
    let cacheHits = 0;
    for (let step = 0; step <= edits; step++) {
      if (step > 0) { const s = seed; applyEdit("original", step); seed = s; applyEdit("fast", step); }
      const fastEditor = editors.fast;
      const full = manager("fast").serialize(escapedJSON(fastEditor.state.doc));
      const incremental = serializeDocumentMarkdown(manager("fast"), fastEditor.state.doc);
      if (full !== incremental) problems.push(`serialize step ${step}: full ${full.length} vs incremental ${incremental.length}\n--full--\n${full.slice(0, 300)}\n--inc--\n${incremental.slice(0, 300)}`);
      const doc = fastEditor.state.doc;
      const slow = countWords(doc.textBetween(0, doc.content.size, "\n", "\n"));
      const quick = countDocumentWords(doc);
      if (slow !== quick) problems.push(`wordcount step ${step}: ${slow} vs ${quick}`);
      // Selected words (the status bar's "x of n words"): everything, and
      // ranges picked with their own sequence so the edits stay the same.
      let pick = (doc.content.size * 31 + step * 17 + 7) >>> 0;
      const next = (limit: number) => { pick = (pick * 1103515245 + 12345) & 0x7fffffff; return pick % limit; };
      const size = doc.content.size;
      const ranges: Array<[number, number]> = [[0, size], [1, Math.max(1, size - 1)]];
      for (let i = 0; i < 12; i++) { const a = next(size + 1), b = next(size + 1); ranges.push([Math.min(a, b), Math.max(a, b)]); }
      for (const [from, to] of ranges) {
        const expected = doc.textBetween(from, to, "", () => "") === "" ? null : countWords(doc.textBetween(from, to, "\n", "\n"));
        const selected = countSelectedWords(doc, [{ $from: doc.resolve(from), $to: doc.resolve(to) }]);
        if (selected !== expected) problems.push(`selected words step ${step}, range ${from}-${to}: ${selected} vs ${expected}`);
      }
      if (slow > 0 && countSelectedWords(doc, [{ $from: doc.resolve(0), $to: doc.resolve(size) }]) !== quick) problems.push(`selecting everything at step ${step} does not give the document count`);
      const origDoc = editors.original.state.doc;
      if (JSON.stringify(origDoc.toJSON()) !== JSON.stringify(doc.toJSON())) problems.push(`doc divergence at step ${step}`);
      const h1 = highlightClasses("original"), h2 = highlightClasses("fast"), truth = groundTruthHighlight("fast");
      if (h2 !== truth) problems.push(`FAST highlight differs from ground truth at step ${step} (edit kind ${step % 13}): ${setDiff(truth, h2)}`);
      if (h1 !== truth) staleOriginal.push(`step ${step} (edit kind ${step % 13}): ${setDiff(truth, h1)}`);
      cacheHits++;
    }
    return { problems, staleOriginal, steps: cacheHits, docSize: editors.fast.state.doc.content.size };
  },
  listPrefix(src: string, kind: "ordered" | "task") { return listSourcePrefix(src, kind === "ordered" ? isOrderedListItem : isTaskListItem, kind === "task"); },
  // Round trip through the fast editor: parse -> serialize -> parse -> serialize.
  // `lossless` means the Markdown PicoMarQ writes reads back as the same document;
  // `stable` means writing that document again gives the same Markdown.
  roundTrip(md: string) {
    load("fast", md);
    const first = JSON.stringify(joinedText(editors.fast.getJSON()));
    const written = serializeDocumentMarkdown(manager("fast"), editors.fast.state.doc);
    load("fast", written);
    const second = JSON.stringify(joinedText(editors.fast.getJSON()));
    const rewritten = serializeDocumentMarkdown(manager("fast"), editors.fast.state.doc);
    return { lossless: first === second, stable: written === rewritten, written, rewritten, first: first.slice(0, 600), second: second.slice(0, 600) };
  },
  // Text of the document after loading `md`, block by block, without the
  // empty paragraph TipTap appends after a final non-paragraph block.
  textOf(md: string) {
    load("fast", md);
    const out: string[] = [];
    editors.fast.state.doc.forEach((block) => out.push(block.textBetween(0, block.content.size, "\n", (node) => node.type.name === "hardBreak" ? "\n" : "")));
    if (out.length > 1 && out[out.length - 1] === "") out.pop();
    return out;
  },
};
(window as unknown as { api: typeof api }).api = api;
(window as unknown as { ready: boolean }).ready = true;
