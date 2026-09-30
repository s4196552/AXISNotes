# AXIS: Design Brief

This brief lists every screen, panel, dialog and interaction that AXIS needs a design for. It describes **what each surface has to do**, not how it should look.

**Out of scope on purpose:** the current colors, themes, fonts, icon set, logo, spacing and other visual assets. The visual language is open. The only visual requirements are the capabilities listed in [§14 Theming requirements](#14-theming-requirements).

---

## 1. Product in one paragraph

AXIS is a local-first desktop knowledge base (Windows, macOS, Linux). Notes are plain Markdown files in a folder the user picks (the _vault_). Besides notes, it has spreadsheet-style **grids** (`.axgrid`) and an infinite **canvas/whiteboard** (`.axcanvas`). It links notes Obsidian-style (`[[wikilinks]]`, backlinks, block references, graph view). It has optional AI features that use the user's own API keys (Ask AI, grammar fixes, handwriting-to-text, diagram maker). Everything works offline.

**Primary users:** students, researchers and knowledge workers, many of them coming from Obsidian or Notion. Many use a pen or stylus.

## 2. Design principles

1. **The content is the product.** Chrome stays quiet, and the editor/grid/canvas gets the most space.
2. **Keyboard first, mouse friendly, pen capable.** Every action can be reached from the command palette. Common actions have shortcuts. Canvas and handwriting surfaces work well with a stylus.
3. **Files are visible.** Users should always know which file they are in and where it lives. Nothing looks like it is locked in a database.
4. **AI is explicit.** Every AI action shows which provider and model it will use, and asks before it sends anything. Users review AI output before it is applied.
5. **Privacy is visible.** Folder AI rules ("local models only", "never") show in the file tree and in the UI of any blocked action.
6. **Scale.** Layouts must hold up with 10,000+ notes, deep folder trees, long tag lists and large grids.

## 3. App shell and layout

```
┌───────────────────────────────────────────────────────────────────┐
│ Title bar / tab or breadcrumb area                    [actions]   │
├──────┬──────────────┬─────────────────────────────┬───────────────┤
│ Rail │ Left sidebar │ Main view                   │ Right sidebar │
│      │ Files        │ Note editor / Grid / Canvas │ Properties    │
│      │ Search       │ Graph / Tasks / Time report │ Backlinks     │
│      │ Tags         │                             │ Mentions      │
│      │ Calendar     │                             │ Outline       │
├──────┴──────────────┴─────────────────────────────┴───────────────┤
│ Status bar: save state · word count · timer · AI activity · sync* │
└───────────────────────────────────────────────────────────────────┘
```

- **Left sidebar** switches between *Files*, *Search* and *Tags*, and holds the *Calendar* for daily notes. It can be resized and collapsed.
- **Right sidebar** holds context for the active file: *Properties*, *Backlinks*, *Unlinked mentions* and the *Outline*. It can be resized and collapsed.
- **Main view** shows one document at a time: a note, grid, canvas, the graph, the tasks view or the time report. (Tabs or split panes are optional; design them only if it costs little.)
- **Status bar:** save state (saved / saving / conflict), the running timer, AI request in progress, and word count.
- **Minimum window:** about 900×600. Below about 1100px wide, both sidebars become overlays.
- _\*Sync is deferred (see §13). Leave room for a sync indicator but do not design it yet._

## 4. Vault entry

### 4.1 Welcome screen (no vault open)
- Actions: **Open folder as vault**, **Create new vault** (name + location), **Recent vaults** list (with remove-from-list).
- Phase 6: **Import Obsidian vault** entry point.
- States: first run, an error such as "folder not found", and loading.

### 4.2 Onboarding (Phase 6, new)
- A short first-run flow: pick or create a vault → an optional sample notes vault → optional AI provider setup (skippable) → a key shortcuts cheat sheet.
- It must be skippable at every step and must be possible to reopen from Settings.

## 5. Files and navigation

### 5.1 File tree
- Nested folders without a depth limit, holding notes (`.md`), grids, canvases and other files, each type clearly marked.
- **Per-item custom icon (icon or emoji) and color** for folders and notes.
- **AI rule badge** on folders marked *AI: local only* or *AI: never* (inherited by children; show when a rule is inherited).
- Actions: new note/folder/grid/canvas, rename inline, drag-and-drop move, delete (goes to the OS trash, with confirmation), reveal in the OS, set icon/color, set AI rule.
- Context menu and keyboard navigation (arrows, Enter, F2 to rename, Delete).
- States: an empty vault, an item being renamed, a drop target highlight, an invalid drop, and a file changed outside the app.

### 5.2 Command palette (Ctrl/Cmd+P)
- Fuzzy search over all commands, showing each command's shortcut and recent commands first.

### 5.3 Quick switcher (Ctrl/Cmd+O)
- Fuzzy search of notes by title and path. Highlight the matched characters. Offer "Create note *X*" when nothing matches.

### 5.4 Shared picker component
The palette, the switcher, template choice, the icon picker and link autocomplete all use one list-picker pattern: an input, a result list, a highlighted row, a secondary line (path or shortcut) and an empty state. Design it once.

## 6. Markdown editor

### 6.1 Live preview
- Markdown is rendered while you edit (Obsidian-style). The **active line shows raw syntax**; other lines are rendered.
- Elements that need a rendered style: headings H1–H6, bold/italic/strike/highlight, inline code and code blocks, block quotes, **callouts** (several types), tables, lists and task checkboxes, horizontal rules, images, math (optional), **wikilinks** (resolved vs. unresolved), **tags**, **block IDs** (`^id`, subdued), and **Mermaid diagrams** (rendered, with an error state).
- Configurable editor width (readable vs. full).

### 6.2 Page styles
Each note can use a background style: **Plain, Lined, Dotted, Math Grid (graph paper), Cornell** (cue column + notes + summary area). All of them must work in light and dark.

### 6.3 Inline pop-ups
- **`[[` link autocomplete:** note titles, then headings (`#`) and blocks (`#^`) of the chosen note.
- **`/` command menu:** headings, table, template, embed, diagram, callout, page style, handwriting, etc., with groups and a filter.
- **`:` emoji/icon picker:** a searchable grid.
- **Link hover preview:** a small read-only preview of the linked note.
- **Spelling quick-fix menu:** suggestions, *Add to dictionary* and *Ignore*.
- Trigger characters can be changed by the user, so menus must not depend on a specific character.

### 6.4 Embeds and block references
- `![[Note]]` and `![[Note#^block]]` render as an **embedded block that can be edited in place**. It needs a clear frame, the source note name/link, and an editing state. Editing the embed writes to the source file.
- Actions: **Copy link to block** and **Copy embed of block**.

### 6.5 Outliner mode
- Collapsible bullets and headings with **fold toggles**, **drag handles** to reorder, and Tab/Shift-Tab to indent. Collapsed items show a count of hidden children.
- An **outline view** toggle for the whole note.

### 6.6 Document banners
- **Changed on disk** (reload / keep mine), **Save failed**, **Conflict**, **File deleted outside the app**, and **Read-only / unsupported file**.

## 7. Knowledge panels

### 7.1 Properties panel (frontmatter)
- A typed editor for each property: **text, number, date, checkbox, list, link, formula**.
- Formula properties (`total: =price * qty`) show the computed value, and a formula or error state.
- Add, remove, rename and change the type of a property. There is also a raw YAML fallback.
- **Time log** entries appear here too (see §9.4).

### 7.2 Backlinks and unlinked mentions
- **Backlinks:** grouped by source note, each with a context snippet in which the link is highlighted.
- **Unlinked mentions:** the same layout, plus a one-click **"Link it"** action on each mention and on each group.
- Empty states for both.

### 7.3 Tags pane
- A tree of nested tags (`#work/projects/alpha`) with counts. It can be collapsed. Clicking a tag runs a search (a parent tag includes its children).

### 7.4 Search
- A query input that supports operators: `tag:`, `path:`, `prop:status=done`, and `"quoted phrases"`. Show operator hints or syntax help.
- Results are grouped by file, with highlighted snippets. Grid cell matches show the cell address.
- States: typing (instant, under 100 ms), no results, and an invalid query.

### 7.5 Graph view
- **Global** and **local** (neighbors of the current note, with a depth control).
- Filters: tag, folder, orphans, and attachments on or off. **Colored groups** defined by queries.
- Zoom, pan, hover to highlight neighbors, and click to open. A legend for the groups.
- Must stay readable with thousands of nodes (label density rules).

## 8. Daily notes and templates

- **Calendar navigator:** a month grid in which days that have a note are marked, today is emphasized, and there are next/previous month controls. Clicking a day opens or creates that day's note.
- **Templates:** a picker for built-in templates (Plain, Cornell, Math Grid, Lined, Dotted) and user templates (from `Templates/`).
- **Template prompt dialog:** when a template asks for values (`{{prompt:...}}`), show a small form before inserting.

## 9. Other formats and structured data

### 9.1 Grid (`.axgrid`)
- A virtualized spreadsheet: column and row headers, cell selection and ranges, and a **formula bar** that shows the address and the raw formula.
- Cell states: a value, a formula result, a **formula error** (with the reason on hover), and editing.
- Column resize, add/insert/delete rows and columns, and basic formats (number, currency, percent, date, text alignment).

### 9.2 Canvas (`.axcanvas`)
- An infinite Excalidraw-based whiteboard. AXIS adds:
  - **Note cards:** live, scrollable previews of vault notes, with open/edit actions and a missing-note state.
  - An **Insert note card** picker and link/image cards.
  - **Pen input** and a **Convert to text** action on a selection of strokes.
  - Grid snapping on or off.
- The toolbar must fit alongside Excalidraw's own toolbar without clashing.

### 9.3 Tasks view
- All `- [ ]` tasks in the vault, with due date, priority and source note.
- Group or sort by due date, note, tag or priority. Filters: open/done, overdue, and date range.
- Checking a box updates the source file. Clicking a task jumps to its line.

### 9.4 Time tracking
- **Timer controls** on any note or task: start, stop, and the running duration, which also shows in the status bar.
- **Manual entry** dialog: date, start/end or duration, and a note.
- **Time report** view: totals per note, tag, project and date range, with a table and a simple chart, plus an export action.

## 10. AI features

All AI surfaces share these patterns:
- A **provider/model chip** that shows exactly where the request goes. It can be changed per request.
- A **pre-flight preview** for large requests: the estimated input tokens, the token cap, and what content will be sent.
- **Streaming output** with **Cancel**.
- **Errors:** no provider configured, unsupported model/parameter (retried automatically, then an error), a folder rule that blocks the request (*AI: never* / *local only*), a network error, and the token cap exceeded.
- A **Quick / Balanced / Deep** option for reasoning effort, where the model supports it.

### 10.1 Ask AI panel
- A chat-style panel about the current note or selection. It shows the context being sent and provides insert, copy and new-note actions on answers.

### 10.2 Fix grammar and clarity
- Runs on a selection or the whole note. The result appears as a **diff review** (per-change accept/reject, accept all, discard).

### 10.3 Handwriting to text
- A **handwriting pad** (in a dialog, or as an inline note block) with pen, eraser, undo, clear and stroke width.
- **Convert** sends the handwriting to a vision-capable model. The output is editable text in which **low-confidence words are underlined**. Clicking one opens a quick-fix dropdown (alternatives, accept, ignore).
- Only available when the selected model supports vision. Otherwise show why, and link to settings.

### 10.4 Diagram maker
- Input: a prompt, **or** "from selection/outline", **or** "from linked notes" (the last two need no AI).
- Output type: **Mermaid** (inserted into the note) or **Excalidraw elements** (placed on a canvas).
- A preview before inserting, a regenerate action, and an error state for output that fails validation (retried once automatically).

## 11. Settings

A modal or a full page with a section list:

| Section            | Contents                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Appearance**     | Light/dark/system, theme picker (user theme files), accent color, fonts, editor width, custom CSS snippets (list with on/off toggles) |
| **Editor**         | Default page style, outliner behavior, live preview options                                                                          |
| **Spelling**       | Offline spellcheck on/off, language dictionaries, personal dictionary (list, remove)                                                 |
| **Daily notes**    | Folder, date format, template, open on startup                                                                                       |
| **Templates**      | Templates folder, list of available templates                                                                                        |
| **Quick commands** | Add/remove/remap commands and **trigger characters**, keyboard shortcut remapping with conflict warnings                             |
| **AI providers**   | Provider list (OpenAI, Anthropic, Gemini, OpenRouter, Ollama, LM Studio, custom OpenAI-compatible). Add/remove a provider, key entry (masked, stored in the OS keychain; the key is never shown again), base URL, **Test connection** (success/failure detail), refresh model list |
| **AI models**      | Default model per task (*Handwriting, Diagrams, Text fixes, Chat/other*), shown with capability badges (vision, JSON, context size). Fallback order (drag to reorder). Per-request token cap |
| **AI privacy**     | Folder rules overview, **request log** (metadata only: time, provider, model, tokens, status; filter and clear)                    |
| **Web clipper**    | Pairing status, pair/unpair, show the pairing token/code, local port (Phase 6)                                                       |
| **About**          | Version, vault path, rebuild index, open the `.axis` folder                                                                         |

## 12. Web clipper (Phase 6, browser extension)

- **Extension popup:** the clip mode (**full page → Markdown**, **selection**, **screenshot**, **URL only**), the target folder, a title field, tags and a **Clip** button.
- **Pairing flow:** the extension and the desktop app exchange a code or token. Show paired, unpaired and app-not-running states.
- **Offline queue:** a list of pending clips while the app is closed, with counts, retry and delete.
- **In the app:** a notification when a clip arrives, and an optional "Inbox" folder view.

## 13. Deferred: do not design yet

Sync, accounts, sharing, invites, presence and live cursors (Phases 7–8). Only reserve space: a status bar slot for sync state, a place in the file tree context menu (*Sync: Off / Backup only / Shared*), and a place on file tree rows for a sync badge.

## 14. Theming requirements

These are capabilities, not a visual style:
- Every color, font, radius and spacing value comes from **CSS variables (design tokens)**, so user themes can override them.
- Light and dark modes are both first-class. Every surface in this document needs both.
- The accent color can be changed by the user and must still meet contrast rules on both backgrounds.
- Page styles (§6.2) and the canvas must stay usable under any theme.
- Designs must use tokens, not hard-coded values. Deliver the token list together with the designs.

## 15. Accessibility and input

- Meets WCAG 2.2 AA contrast, has visible focus rings everywhere, and supports full keyboard operation.
- Screen reader labels on every icon-only button. Tree, list and grid roles for the file tree, pickers and grid.
- Respects reduced-motion and OS text scaling.
- Pen: hit targets and pressure-based strokes on canvas and pad surfaces. Palm rejection is left to the OS.
- Hover-only information must also be reachable by keyboard focus.

## 16. States checklist (for every surface)

Empty · loading · populated · very large (thousands of items) · error · offline · permission or privacy blocked · light · dark · narrow window.

## 17. Deliverables expected from design

1. The app shell layout, with sidebar behavior at the breakpoints.
2. The shared components: picker, context menu, dialog, banner, toast, tabs, tree row, property row, provider/model chip, diff review.
3. Each screen and panel in §4–§12, in light and dark.
4. The token list (§14).
5. Interaction notes for drag-and-drop, embeds edited in place, the outliner, and the handwriting quick fixes.
