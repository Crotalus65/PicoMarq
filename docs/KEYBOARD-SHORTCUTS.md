# PicoMarQ keyboard shortcuts

Version 1.2.3. Windows keys are shown; on a Mac, read Cmd for Ctrl and Option for Alt.

PicoMarQ has two views: the **formatted view** (the normal writing view, with the icon toolbar) and the **Markdown source view** (the raw text of your file). Shortcuts in the first two sections work in both views unless noted.

## Files and the window

| Keys | What it does |
| --- | --- |
| Ctrl+N | New document in another window |
| Ctrl+O | Open files in separate windows (several can be selected at once) |
| Ctrl+S | Save (asks for a filename the first time) |
| F12 | Save As |
| Ctrl+W | Close the current document; leave a blank at the same position if it is the last window (asks about unsaved changes) |
| Ctrl+P | Print |
| Alt+F4 | Close the current window |
| Ctrl+Shift+Q | Exit all windows (asks about every unsaved document) |
| Ctrl+Shift+M | Switch between the formatted view and the Markdown source view |
| Ctrl+, | Settings |
| Esc | Leave Settings |
| Alt+F, Alt+E, Alt+V, Alt+H | Open the File, Edit, View, or Help menu |

Open Recent, Revert to Saved, and Apply Smart Typography have no shortcut; they are in the File and Edit menus.

File > Close Window and Ctrl+W close one of several windows, or replace the last
document with a blank at the same size and position. The app stays open, and the
explicitly closed document is removed from the next session.

The title-bar X and Alt+F4 close the native window. Closing the final window this
way exits and preserves its saved document for restoration, the same as File >
Exit, when Settings > Startup is set to Restore previous session.

## Editing, finding, and zoom

| Keys | What it does |
| --- | --- |
| Ctrl+Z | Undo |
| Ctrl+Y | Redo (Ctrl+Shift+Z also redoes in the formatted view) |
| Ctrl+X, Ctrl+C, Ctrl+V | Cut, copy, paste |
| Ctrl+A | Select all |
| Ctrl+F | Find (opens the Find bar, or moves the cursor back into it if it is already open) |
| Ctrl+H | Find and Replace |
| Ctrl+= or Ctrl+Shift+= or Ctrl+Numpad + | Zoom in (text only; menus and icons keep their size) |
| Ctrl+- or Ctrl+Shift+- or Ctrl+Numpad - | Zoom out |
| Ctrl+0 | Back to actual size |
| Ctrl+mouse wheel | Zoom in and out |

## Formatting (formatted view only)

| Keys | What it does |
| --- | --- |
| Ctrl+B | Bold |
| Ctrl+I | Italic |
| Ctrl+U | Underline (saved as `<u>…</u>`, since Markdown has no underline of its own) |
| Ctrl+Shift+S | Strikethrough |
| Ctrl+E | Inline code (replaces any other formatting on the selection) |
| Ctrl+K | Add a link to the selected text, or edit the link under the cursor |
| Ctrl+Alt+1 through Ctrl+Alt+6 | Heading 1 through Heading 6 (press again to go back to normal text) |
| Ctrl+Alt+0 | Normal paragraph |
| Ctrl+Shift+B | Blockquote |
| Ctrl+Shift+8 | Bullet list |
| Ctrl+Shift+7 | Numbered list |
| Ctrl+Shift+9 | Task list (checkboxes) |
| Ctrl+Alt+C | Code block |
| Shift+Enter or Ctrl+Enter | Line break inside a paragraph (without starting a new paragraph) |
| Backspace, right after an automatic change | Undoes the change and gives you back what you typed (a heading made from "# ", a curly quote, an em dash, and so on) |

Ctrl+K works only while the cursor is in the document, not in the Find bar or Settings.

### Inside lists, tables, and code blocks

| Where | Keys | What it does |
| --- | --- | --- |
| List item | Enter | New item; Enter on an empty item ends the list |
| List item | Tab | Indent the item one level |
| List item | Shift+Tab | Outdent the item one level |
| List item | Backspace at the start of the item | Lift the item out of the list |
| Table | Tab | Next cell (in the last cell, adds a new row) |
| Table | Shift+Tab | Previous cell |
| Table | Backspace or Delete with every cell selected | Delete the table |
| Code block | Enter three times at the end | Leave the code block |
| Code block | Down arrow on the last line | Leave the code block |
| Code block | Backspace in an empty block | Remove the block |
| Math block (selected) | Enter or Space | Open the formula editor |

Outside lists and tables, Tab moves the keyboard focus out of the document to the toolbar; it does not insert a tab character.

## Typing shortcuts (formatted view)

These are not key combinations but things the editor does as you type. Every one of them can be undone with Backspace immediately afterward.

**At the start of a line**, followed by a space:

| You type | You get |
| --- | --- |
| # through ###### | Heading 1 through Heading 6 |
| -, *, or + | Bullet list |
| 1. | Numbered list |
| > | Blockquote |
| [ ] or [x] | Task list item (unchecked or checked) |

Also at the start of a line: three hyphens (---) make a horizontal rule, three backticks or three tildes followed by Enter start a code block, and a formula written between double dollar signs (\$\$ … \$\$) on a line of its own becomes a math block.

**Anywhere in a line:**

| You type | You get |
| --- | --- |
| \*\*bold\*\* or \_\_bold\_\_ | **bold** |
| \*italic\* or \_italic\_ | *italic* |
| \~\~struck\~\~ | ~~struck~~ |
| text between single backticks | inline code |
| \[text\](address) | a link |
| a web address followed by a space | a link |

**Smart typography** (Settings > Typography, on by default; works in both views):

| You type | You get |
| --- | --- |
| Two hyphens (--) | An em dash (—). A third hyphen gives the three hyphens back, so a horizontal rule can still be typed. |
| Three periods (...) | An ellipsis (…) |
| " and ' | Curly quotes and apostrophes, opening or closing as the position requires |

Edit > Apply Smart Typography converts a whole document at once, in a single undo step.

## Find bar, link editor, formula editor

| Where | Keys | What it does |
| --- | --- | --- |
| Find field | Enter | Next match |
| Find field | Shift+Enter | Previous match |
| Replace field | Enter | Replace this match |
| Replace field | Ctrl+Enter | Replace all |
| Find bar | Esc | Close the Find bar |
| Link editor | Enter | Apply the link |
| Link editor | Esc | Cancel |
| Formula editor | Ctrl+Enter | Apply the formula |
| Formula editor | Esc | Cancel |
| Menu button (File, Edit, View, Help) focused | Down arrow | Open that menu |
| Menu button focused | Left or Right arrow | Move to the next menu |

## Mouse

| Action | What it does |
| --- | --- |
| Ctrl+click on a link | Open it in your browser (a plain click just places the cursor) |
| Ctrl+mouse wheel | Zoom |
| Right-click | Spelling suggestions for the word under the pointer, Ignore All (in this document, until it is closed), Add to Dictionary, Bold, Italic, Cut, Copy, Paste, and table commands when the cursor is in a table (in source view, Bold and Italic wrap the selection in Markdown markers) |
| Double-click a page-edge handle | Return Page Width to Full (Settings > User Interface > Page Width, Custom) |

## Markdown source view

The file and editing shortcuts above all work. The formatting shortcuts do not (Ctrl+B does nothing here); write the Markdown instead. Smart typography still converts as you type, and Edit > Apply Smart Typography converts the whole file. The Find magnifier is not shown in this view; use Ctrl+F. Undo and redo in this view are the text box's own and are separate from the formatted view's history.
