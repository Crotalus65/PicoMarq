import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { escapeMarkdownText } from "../../lib/markdown-escape";

/** The part of TipTap's MarkdownManager this module relies on. */
export interface MarkdownRenderer {
  renderNodeToMarkdown: (node: JSONContent, parentNode?: JSONContent, index?: number, level?: number) => string;
}

// Markdown of each top-level block, keyed by the immutable ProseMirror node.
// After an edit only the blocks on the path to the change are new objects, so
// the rest of the document is reused instead of being re-serialized.
const blockMarkdown = new WeakMap<ProseMirrorNode, string>();

// Mirrors MarkdownManager.isEmptyOutput: output made only of whitespace and
// the "&nbsp;" placeholders empty paragraphs render to counts as empty.
const EMPTY_OUTPUT = /^(?:\s|&nbsp;)*$/;

/**
 * The inline content of a text block as JSON, with prose escaped so that the
 * Markdown reads back as the same text. Code spans are left alone, like code
 * blocks. Tracks where each text node sits: at the start of an output line
 * (where "# " or "1. " would become a heading or list), in a table cell
 * (where "|" would end the cell), or at the end of a heading (where a
 * trailing "#" would be dropped).
 */
function escapedInlineContent(block: ProseMirrorNode, inTableCell: boolean): JSONContent[] {
  // Adjacent text nodes with the same marks render as one run of text, and a
  // parsed document holds many of them ("$", "$" for an escaped "$$"), so
  // they are joined first: escaping looks at neighbouring characters.
  const children: ProseMirrorNode[] = [];
  block.forEach((child) => {
    const previous = children[children.length - 1];
    if (previous && previous.isText && child.isText && previous.sameMarkup(child)) {
      children[children.length - 1] = block.type.schema.text((previous.text ?? "") + (child.text ?? ""), previous.marks);
    } else {
      children.push(child);
    }
  });
  // Nothing can start a block inside a heading or a table cell, so
  // "# 1. Introduction" and "| 1. x |" are written as they are.
  const heading = block.type.name === "heading";
  const blocksCanStart = !heading && !inTableCell;
  const content: JSONContent[] = [];
  const last = children.length - 1;
  let lineStart = blocksCanStart;
  children.forEach((child, index) => {
    const json = child.toJSON() as JSONContent;
    if (child.isText && child.text) {
      if (child.marks.some((mark) => mark.type.spec.code)) {
        lineStart = false;
      } else {
        json.text = escapeMarkdownText(child.text, {
          lineStart,
          inTableCell,
          headingEnd: heading && index === last && child.marks.length === 0,
        });
        lineStart = blocksCanStart && child.text.endsWith("\n");
      }
    } else {
      lineStart = blocksCanStart && child.type.name === "hardBreak";
    }
    content.push(json);
  });
  return content;
}

/**
 * What `node.toJSON()` returns, except that prose is escaped for Markdown
 * output. Nodes whose content is code (code blocks, front matter) are copied
 * as they are.
 */
export function escapedJSON(node: ProseMirrorNode, inTableCell = false): JSONContent {
  const json: JSONContent = { type: node.type.name };
  for (const _ in node.attrs) { json.attrs = node.attrs; break; }
  if (node.marks.length) json.marks = node.marks.map((mark) => mark.toJSON());
  if (node.isText) {
    json.text = node.text;
    return json;
  }
  if (!node.content.size) return json;
  if (node.type.spec.code) {
    json.content = node.content.toJSON() as JSONContent[];
    return json;
  }
  const role = node.type.spec.tableRole;
  const cell = inTableCell || role === "cell" || role === "header_cell";
  if (node.isTextblock) {
    json.content = escapedInlineContent(node, cell);
  } else {
    const content: JSONContent[] = [];
    node.forEach((child) => content.push(escapedJSON(child, cell)));
    json.content = content;
  }
  return json;
}

/**
 * Serialize a document to Markdown with the same result as
 * `manager.serialize(escapedJSON(doc))`, re-rendering only changed blocks.
 *
 * The document renderer joins its children with a blank line and no block
 * renderer depends on its position among siblings, so each block can be
 * rendered on its own exactly as the full serializer would render it.
 */
export function serializeDocumentMarkdown(manager: MarkdownRenderer, doc: ProseMirrorNode): string {
  // What Node.toJSON() would produce for the parent, minus the content the
  // renderers never read.
  const parent: JSONContent = { type: doc.type.name };
  for (const _ in doc.attrs) { parent.attrs = doc.attrs; break; }
  const parts: string[] = [];
  doc.forEach((block, _offset, index) => {
    let markdown = blockMarkdown.get(block);
    if (markdown === undefined) {
      markdown = manager.renderNodeToMarkdown(escapedJSON(block), parent, index, 0);
      blockMarkdown.set(block, markdown);
    }
    parts.push(markdown);
  });
  const result = parts.join("\n\n");
  return EMPTY_OUTPUT.test(result) ? "" : result;
}
