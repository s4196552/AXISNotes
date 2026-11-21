# Proposal: HTML and interactive study blocks in notes

Status: **approved by the human on 2026-11-22** ("Do these": typed study blocks, option b,
and sandboxed `.html` pages, option c). The task split in §9 was consolidated when it was
built: **T-267** is all three study blocks, **T-268** makes the Flash cards, Practice test
and Mind map skills write them, and **T-269** is `![[Page.html]]` embeds. The optional and
deferred rows (embeds of study blocks, indexing links in blocks, the HTML subset) are not
built and keep their open questions. Open questions 2–4 were settled with the defaults noted
in `.agents/handoffs/T-267.md`.
Date: 2026-11-21. Author: Claude Code (investigation for the request "Look into
implementing HTML in markdown notes for features like flashcards, mindmap, tests, etc.").

## 1. Summary and recommendation

The goal is interactive study material inside notes: flash cards, mind maps and practice
tests. Literal HTML is one way to get there, but it is not the best fit for AXISNotes.

**Recommended approach: option (b) plus a narrow use of option (c).**

1. **Typed fenced blocks (option b, the main feature).** ` ```flashcards `, ` ```quiz `
   and ` ```mindmap ` blocks. Their bodies are small line-based plain-text formats that
   read well as text. Built-in widgets render them in the live preview, the same way
   ` ```mermaid ` and ` ```heatmap ` blocks are rendered today. A note's content is only its
   Markdown. Widgets build their DOM from text nodes and never interpret HTML. Results
   go to the existing comprehension heatmap. They do not go to a scheduler, because
   scheduling belongs to AXIS Deck.
2. **Inline embeds of vault HTML pages (option c, for arbitrary HTML).** `![[Quiz.html]]`
   in a note shows an existing vault `.html` page inline. It uses the sandboxed
   `axispage://` frame that already shows AI-made pages (T-190). It is file-backed. It
   does not use `srcdoc`, so the page keeps its own strict CSP and null origin. Arbitrary
   or scripted HTML therefore stays in `.html` files, which already work. The new part is
   that a note can show one inline.
3. **Do not render raw HTML in the app's own DOM (option a)** for now. If the human wants
   the common presentational tags that Obsidian users write (`<details>`, `<kbd>`,
   `<mark>`, `<sub>`/`<sup>`, `<u>`, `<br>`), this could be a separate, later task with a
   tight allowlist (§5.3). It cannot provide flash cards, quizzes or mind maps, because a
   sanitizer must remove the scripts and handlers they need.

Why: (b) is the only option that keeps notes plain Markdown, never runs note-supplied
code in the privileged app window, and gives AI a format it can generate _and the app can
validate_. It also reuses two proven patterns: the lazy-loaded heatmap card and the
sandboxed page frame. (c) already exists for full pages, so embedding costs little.
(a) puts the most risk in the most privileged place for the least gain.

## 2. What exists today (findings)

### 2.1 Raw HTML in notes is never interpreted

| Place                                                                    | What happens to `<div>…</div>` / `<script>` in a note                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor live preview (`src/features/editor/livePreview.ts`)               | Shown as **source**. Lezer parses it as `HTMLBlock` / `HTMLTag`, and no decoration replaces those nodes. Editing helpers skip it explicitly (`listAutoformat.ts:46`, `inlineMarks.ts:22`, `symbolAutoformat.ts:14`, `inlineCodeLanguage.ts:49`, `bionic.ts:38`).                                                                                                                                                     |
| Tables (`tables.ts:73`)                                                  | Only `<br>` becomes a line break. The comment there is explicit: "never interpret arbitrary HTML". Everything else is a text node.                                                                                                                                                                                                                                                                                   |
| Embeds (`embeds.ts:180`)                                                 | A nested `EditorView` with `livePreview`, `tables` and `toggles` (no Mermaid or heatmap), so HTML shows as source. Fenced widget blocks also show as source in embeds today.                                                                                                                                                                                                                                         |
| Canvas note cards (`canvas/NoteCard.tsx`)                                | A text preview of the note, with no HTML interpretation.                                                                                                                                                                                                                                                                                                                                                             |
| AI answers (`ai/AnswerText.tsx:223`)                                     | `HTMLBlock` / `HTMLTag` come back as **source text** in inert React.                                                                                                                                                                                                                                                                                                                                                 |
| AI HTML answers (`ai/sidebarChatOutput.ts`)                              | Saved as a draft `.html` under `.axisnotes/drafts/` and shown in the sandboxed page frame. The comment is explicit: "never inject HTML into the app DOM".                                                                                                                                                                                                                                                            |
| Vault `.html` files (`drafts/WebFileView.tsx`, `src-tauri/src/pages.rs`) | Rendered in an `<iframe sandbox="allow-scripts allow-forms allow-modals">` (no `allow-same-origin`, no `allow-popups`) from `axispage://localhost/<path>`. The Rust response repeats the sandbox in its CSP, sets `default-src 'none'` with no `connect-src`, and serves only page/style/script/image/font types from the vault. Links are posted to the app and checked there. Tauri IPC refuses null-origin calls. |
| Reading view / export                                                    | None exists. Live preview is the only rendered view.                                                                                                                                                                                                                                                                                                                                                                 |

The only `innerHTML` uses on note-derived content are Mermaid SVG (`mermaidBlocks.ts:136`)
and the diagram maker. Both come from Mermaid run with `securityLevel: "strict"`, which
sanitizes with DOMPurify.

### 2.2 The app window's security context

- The main window's CSP (`tauri.conf.json`) is `default-src 'self'` with
  `style-src 'self' 'unsafe-inline'` and `img-src … https:`. Inline `<script>` and `on*=`
  handlers are blocked by CSP, which is a useful second layer. Inline **styles** are
  allowed, and so are **remote images**.
- The top-level page holds the Tauri invoke key, so any script running there can call
  every app command: read, write and delete vault files, run AI requests with the stored
  keys, change settings, and so on. API keys stay in Rust, but the commands that use them
  do not. **Any HTML-injection bug in the app DOM is a full compromise of the vault.**
- `frame-src` allows only YouTube, Vimeo and `axispage`.

### 2.3 Study features that overlap

- **Skills** (`src/features/skills/builtinSkills.ts`): `mindmap`, `test` (Practice test)
  and `flashcards` already exist. Each has a _Markdown_ format and an _HTML_ format:
  - Markdown: a Mermaid `mindmap` block; tests and decks as **folded callouts**
    (`> [!question]- Front`), which Obsidian folds natively.
  - HTML: one self-contained page saved next to the note and shown in the sandboxed frame.
    Test and flash-card pages report `{axisnotesStudy: {kind, items:[{source, correct}]}}`
    through `postMessage`.
- **Comprehension heatmap** (`src/features/comprehension/**`): `studyResults.ts` validates
  study messages, resolves `path#Heading` sources against notes AI may read and records
  them. `heatmapBlock.ts` is the template to follow: a ` ```heatmap ` fence becomes a
  React card that is **imported the first time a note has one**, edited as source when the
  cursor enters, with only the Markdown saved.
- **Mermaid blocks** (`src/features/diagrams/mermaidBlocks.ts`): lazy library load, render
  cache and an error state. Mermaid is pinned to 11.17.2 for license reasons (DECISIONS:795).
- **Graph tree layout** (`src/features/graph/treeModel.ts`, `TreeView.tsx`): an existing
  SVG tree layout (`buildTree`, `layoutTree`) that a mind map can reuse.
- **Canvas** (`src/features/canvas/**`): Excalidraw with note cards. It has no mind-map or
  flash-card code.
- **AXIS Deck** (`docs/SUITE.md` on `agent/codex/T-042`): Deck owns cards, content
  snapshots, FSRS scheduling and append-only review history. Creating cards from a note
  captures a snapshot and a durable source reference. **Note-side flash cards must not
  schedule, store due dates or keep review history.**
- **Indexer** (`src-tauri/src/index/parse.rs`, `tasks.rs`): fenced blocks are skipped. As
  a result, `- [x]` lines inside a ` ```quiz ` block will not show up in the task view (good). It
  also means `[[links]]` and `#tags` inside a block are not indexed (a trade-off, see §8).

## 3. Options compared

| Criterion                       | (a) Sanitized raw HTML inline                                                                                                                                                                                                                       | (b) Typed fenced blocks                                                                                                                                                                                         | (c) Sandboxed iframe                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Interactive study features?** | **No.** Flip, score and fold need script, which the sanitizer removes. Only `<details>` gives a crude "reveal".                                                                                                                                     | **Yes.** Built-in widgets give the behaviour; the note holds only data.                                                                                                                                         | **Yes.** Any HTML/JS works, as AI pages do today.                                                                                                                       |
| **XSS / IPC risk**              | **Highest.** The HTML enters the privileged DOM. One sanitizer gap or mXSS (mutation XSS) = full command access. CSP blocks inline script, but `style` and remote `img` are allowed (UI spoofing, tracking pixels). DOM clobbering via `id`/`name`. | **Lowest.** The parser turns text into a typed model; widgets build text nodes and React elements only. No note-supplied markup or code runs.                                                                   | **Low, if file-backed.** Null origin (no `allow-same-origin`), and Tauri IPC rejects it. The page has its own `default-src 'none'` CSP. `srcdoc` is weaker (see below). |
| **Obsidian / other editors**    | Obsidian renders a sanitized HTML subset, so simple tags look the same. Other editors vary. Raw HTML is the hardest to read as text.                                                                                                                | Unknown fence languages show as **code blocks** in Obsidian, GitHub and VS Code. The bodies are readable text, but answers are visible (no folding).                                                            | `![[x.html]]` shows a link in Obsidian, and the `.html` file opens in any browser.                                                                                      |
| **Editing UX in CodeMirror**    | HTML must be replaced by a widget when the cursor is outside and shown as source when inside. Mixed Markdown and HTML is hard to edit.                                                                                                              | The proven pattern: the widget is shown outside the block and the source inside it. "Edit source" and a double-click open the source. Widgets can write small changes back (as the heatmap's unit picker does). | The embed widget is a frame. Editing means opening the `.html` file (or its source) in a tab. The frame cannot be edited inline.                                        |
| **Performance / lazy load**     | Needs a sanitizer in the main bundle or a lazy chunk. It runs on every change to an HTML node.                                                                                                                                                      | Detecting a block costs one `CodeInfo` string check (already done for Mermaid and heatmap). The widget and parser load **on first use**. CM6 draws widgets only in the viewport.                                | Each frame is a separate document (heavy). It needs viewport-gated mounting, a frame cap and click-to-load. Sizing to the page's height needs a message from the page.  |
| **AI generation**               | Hard to validate. The model writes HTML, and a sanitizer silently strips what it wanted.                                                                                                                                                            | **Easiest to validate.** Parse the output; on error, retry once with the parser's message, as the diagram maker does. Formats are short and few-shot friendly.                                                  | Already works (HTML skill formats). It cannot be validated beyond "is HTML".                                                                                            |
| **Dependency / license**        | DOMPurify 3.4.16 (MPL-2.0 OR Apache-2.0; take Apache-2.0) is already in the tree under Mermaid. It would become a direct dependency. rehype-sanitize (MIT) needs the unified/hast pipeline, which the app doesn't use.                              | None. The parsers are in-house, and the mind map reuses `graph/treeModel.ts`.                                                                                                                                   | None. It reuses `pages.rs` and `PAGE_SANDBOX`.                                                                                                                          |

**On `srcdoc` for inline ` ```html ` blocks:** a `srcdoc` frame has an opaque origin when
sandboxed, but it **inherits the embedding document's CSP**. It is not served through
`pages.rs`, so it does not get the page policy. Under the app's CSP, its inline scripts
would be blocked, so interactive HTML would not run there unless the app CSP were
loosened, and it must not be. Whether Tauri's init scripts reach a `srcdoc` child frame
has not been verified (T-190 verified this only for `axispage` frames). Supporting inline
HTML bodies safely would mean serving them through `axispage` at a block address, which
means changing `pages.rs`. That Rust module refuses to serve notes today, by design. This
is not recommended now (open question Q5).

## 4. Proposed syntax

The general rules apply to all three blocks:

- The fence language is the block type: `flashcards`, `quiz` or `mindmap` (case-insensitive).
  `~~~` fences work too, for bodies that contain a triple backtick.
- An optional **header** comes first: `key: value` lines (`title`, `shuffle`, `reverse`),
  ended by the first blank line. Unknown keys are kept and ignored.
- Text in cards, questions, options and nodes supports **inline Markdown only**: bold,
  italic, code, `$math$`, `[[wikilinks]]` and links. It is rendered by a safe inline
  renderer that builds elements (in the style of `AnswerText`). **Raw HTML is shown as
  text.**
- A body that doesn't parse renders an error card with the line number and an "Edit source"
  button, in the style of Mermaid's error state. The text is never lost or rewritten.

### 4.1 Flash cards

````markdown
```flashcards
title: Cell biology

Q: What does the mitochondrion make?
A: ATP, the cell's energy currency.

Q: Which organelle holds the cell's DNA?
A: The **nucleus**, inside a double membrane.
   See [[Cell structure#Nucleus]].

Q: Where are proteins assembled?
A: On ribosomes.
```
````

- A card is a `Q:` line followed by an `A:` line. Continuation lines are indented, and a
  blank line ends a card. `reverse: true` in the header also quizzes A→Q.
- `::` is avoided on purpose, because AXIS already uses `key:: value` inline properties.
- **Widget:** one card at a time, flipped with a click, Space or Enter. It has Previous
  (←), Next (→), Shuffle, **Again** / **Got it**, progress ("7 of 20 · 5 known") and Start
  over. Sorting state lasts **for the session only**, held in memory per block. Nothing
  is written to the note, and no due dates are kept.
- When every card is sorted, results go to the comprehension heatmap through
  `recordStudy({kind: "flashcards", items})`, called in process. The source is the
  containing note and the heading above the block.
- **Deck boundary:** a later "Send to Deck…" action, once Deck exists, creates Deck cards
  from a _snapshot_ of the block with a source reference. Deck then owns scheduling and
  history. The block itself never schedules (§6).

### 4.2 Practice test (quiz)

````markdown
```quiz
title: Photosynthesis check
shuffle: true

Q: Where does the light-dependent stage happen?
- [ ] The stroma
- [x] The thylakoid membranes
- [ ] The nucleus
> Chlorophyll in the thylakoid membranes absorbs the light.

Q: Oxygen is a by-product of photosynthesis.
- [x] True
- [ ] False
> Water is split in the light-dependent stage, releasing oxygen.

Q: Name the green pigment that absorbs light.
= chlorophyll
= chlorophyll a
> It absorbs mostly red and blue light.
```
````

- `Q:` starts a question. Each `- [ ]` / `- [x]` line is an option, and an `[x]` marks a
  correct one. More than one `[x]` makes it "select all that apply". Each `=` line is an
  accepted short answer, compared case-insensitively with whitespace trimmed. `>` adds
  the explanation.
- The answers are visible in the source and in other editors. In AXIS the widget hides
  them until the learner answers (open question Q2).
- **Widget:** one card per question. It shows right or wrong, the correct answer and the
  explanation, then a final score with the questions missed and a "Try again" button that
  shuffles. It works from the keyboard. Results go to the heatmap as `kind: "test"`.

### 4.3 Mind map

````markdown
```mindmap
title: Photosynthesis

- Light-dependent stage
  - Thylakoid membranes
  - Water split, O₂ released
  - Makes ATP and NADPH
- Calvin cycle
  - Stroma
  - Fixes CO₂ with RuBisCO
- Limiting factors
  - Light, CO₂, temperature
```
````

- The body is an ordinary nested Markdown list, so it reads well as text, works as an
  outline and can be pasted to or from a note's list. The root is `title`, or a single
  top-level item when there is no title.
- **Widget:** an SVG tree laid out with `graph/treeModel.ts`. Each branch has its own
  colour. A click folds or unfolds a node. It has Expand all / Collapse all and pan/zoom
  for large maps. Fold state is view-only, not saved. Inline Markdown works in labels.
- A one-way "Copy as Mermaid mindmap" action is a nice extra. The existing ` ```mermaid
mindmap ` blocks keep working unchanged.

### 4.4 Embedding an HTML page

```markdown
![[Photosynthesis - Practice test.html]]
![[Lessons/Lesson 3.html|600]]
```

- The page appears inline in a frame with the same sandbox, protocol and link handling as
  `WebFileView`. A size suffix sets the height. Otherwise the injected page script reports
  its height, which the app validates and clamps.
- The frame does not load until it is in view, and a user setting can make it
  click-to-load. At most N frames are live per note (proposal: 4). The rest show a
  placeholder.
- Study pages embedded this way report results through the existing `useStudyResults` path.

## 5. Security rules

### 5.1 For all study blocks (b)

1. **Data, not markup.** Parsers turn the body into a typed model of strings. Widgets
   build DOM only with `textContent`, `createElement` and React. **No `innerHTML`, no
   `dangerouslySetInnerHTML` and no `eval`/`Function`** anywhere in study-block code.
   A lint rule enforces this for `src/features/studyBlocks/**`.
2. Inline Markdown in cards uses one safe renderer that recognises only bold, italic,
   code, math, wikilinks and links. Everything else, including `<tags>`, stays text.
   KaTeX runs in its default safe mode (`trust: false`). Links go through the existing
   web-link and vault-link handlers, never `href="javascript:"`.
3. Results reporting is in-process and goes through `recordStudy`, which keeps its
   existing checks: sources resolve only to notes in the vault and are capped at 300
   items, so a block can only report on its own note.
4. Write-backs from a widget (for example "Add card") are minimal document changes
   through CodeMirror transactions with a `userEvent`, as the heatmap unit picker does.
   They are undoable, are never made in read-only views and never touch files outside the
   note.
5. Size caps: a block over 200 KB or 1,000 items renders a "too large" card with the
   source available.

### 5.2 For embedded pages (c)

1. Reuse `PAGE_SANDBOX` (`allow-scripts allow-forms allow-modals`). **Never add
   `allow-same-origin`, `allow-popups` or `allow-top-navigation`.** One shared frame
   component is used by both `WebFileView` and the embed, so the two can't drift apart.
2. Load only `axispage://` URLs built by `backend.pageUrl(path)` for a vault path. Do not
   use `srcdoc`, `data:` or `blob:` frames for note content.
3. Leave `pages.rs` unchanged: no network (`default-src 'none'`, no `connect-src`), GET
   only, vault-relative paths, type allowlist, 25 MB cap.
4. Messages from frames are accepted only when `e.source` is that frame's `contentWindow`.
   They are shape-validated (`parseStudyMessage`, `pageLink`, and a new height message
   with a numeric clamp). Link messages need the frame to have focus, as now.
5. AI rules: an embed shows a file. It doesn't send it anywhere, so embedding never
   changes what AI may read. Pages keep their `<meta name="ai-access">` mark.

### 5.3 If option (a) is ever approved (not recommended now)

- Use DOMPurify as a direct dependency (Apache-2.0 option), with a **tag allowlist**:
  `details summary kbd mark sub sup u br small abbr ruby rt`. Strip **all attributes**
  except `open` on `details` and `title` on `abbr`. There is no `style`, `class`, `id`,
  `name`, `href`, `src`, form, media, SVG or MathML. Rendering happens through
  `RETURN_DOM_FRAGMENT`, into a widget, only when the cursor is outside the node.
- Add fuzz tests against known mXSS payloads, plus a CSP regression test that the app CSP
  still has no `'unsafe-inline'` for scripts.

## 6. Relationship to AXIS Deck and the comprehension heatmap

- Study blocks are **practice tools**, not a scheduler. They keep no due dates, intervals,
  ease or FSRS state and no review log, either in the note or in `.axis/`.
- They feed the comprehension heatmap (per-note and per-heading results), which is a
  record of understanding, not a schedule. This is the same contract the HTML study pages
  use now.
- When Deck exists, "Send to Deck" follows SUITE.md: it captures a snapshot plus a
  source reference (note path, heading and card fingerprint), then hands the cards to
  Deck's supported mutation. Later edits to the block show "source changed" in Deck and
  never reset Deck's history. Durable per-card IDs would be needed then (open question Q3).

## 7. Files and modules involved

| Area                                         | Change                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/studyBlocks/` (new)            | `blockWidget.ts` (a shared fenced-block StateField and widget base, taken from the heatmap and Mermaid code), `inlineText.ts` (the safe inline renderer), `flashcards/`, `quiz/`, `mindmap/`, each with `model.ts` (parse and serialise, pure and tested) and a lazy `*Card.tsx` |
| `src/features/editor/Editor.tsx`             | Add `studyBlocks` to the extension list next to `mermaidBlocks` and `heatmapBlocks` (one line), behind the feature switch                                                                                                                                                        |
| `src/features/editor/embeds.ts`              | Add the study-block and Mermaid/heatmap extensions to embedded editors (optional, see Q6), and add an `.html` page embed widget                                                                                                                                                  |
| `src/features/drafts/WebFileView.tsx`        | Extract the sandboxed frame and its message handling into `PageFrame.tsx`, shared with the embed                                                                                                                                                                                 |
| `src/features/comprehension/studyResults.ts` | Export an in-process `recordBlockResults(notePath, heading, kind, items)` wrapper around `recordStudy`                                                                                                                                                                           |
| `src/features/skills/builtinSkills.ts`       | A new "Note blocks" output (or a revised Markdown format) for `flashcards`, `test` and `mindmap` that emits the blocks above. Validate by parsing, and retry once on error                                                                                                       |
| `src/features/graph/treeModel.ts`            | Reused as is by the mind-map widget (read-only use)                                                                                                                                                                                                                              |
| `src/features/editor/quickCommands.ts`       | `/` commands: "Flash cards", "Practice test", "Mind map" insert a starter block                                                                                                                                                                                                  |
| `src-tauri/src/pages.rs`                     | **No change** (optionally, inject a height-report script next to `LINK_SCRIPT` in T-271)                                                                                                                                                                                         |
| `docs/DECISIONS.md`                          | Record the block formats as a storage-format decision (the human's approval is needed, because it is a storage-format change in the sense of AXIS_BUILD_PROMPT rule 3). No new dependency for (b) or (c)                                                                         |

**Module rules (AGENTS.md, T-062 design):** the stable feature ID is `notes.study-blocks`
(with sub-IDs `.flashcards`, `.quiz`, `.mindmap`). It is enabled by default, on all
platforms. Detection costs one string compare per fenced block. Parsers and cards are
imported only when a note contains a block. When the feature is disabled, the extension
isn't added, nothing is imported or mounted, the blocks show as ordinary code blocks
(fully readable), and no shortcuts, `/` commands or timers are registered. Page-embed
frames are disposed when they scroll out of the CM viewport or the note closes, and late
messages from a removed frame are ignored. Measure first-render time, the size of the
initial JS chunk (it should not change) and typing latency in a note with 20 blocks, and
record a baseline before and after.

## 8. Trade-offs worth knowing

- **Links inside blocks are not indexed.** The indexer skips fenced code, so `[[Note]]`
  inside a card doesn't appear in backlinks or the graph. A fix is possible (index links
  in known study-block fences), but it is a Rust indexer change, listed as an optional
  task.
- **In Obsidian, answers are visible** (a plain code block), while the current callout
  format folds them natively. Callouts stay available. The skills could offer both
  (Q2).
- **Full-text search** still finds the block text, since content is indexed as text.

## 9. Proposed task split

New IDs continue from T-266. Every row is `todo` until the human approves.

| ID    | Phase | Task                                                                                                                                | Owner  | Status | Branch             | Files (ownership)                                                                                                                                                            |
| ----- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ | ------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-267 | 3     | Study-block base and ` ```flashcards ` block: parser, safe inline renderer, lazy card, heatmap results, `/` command, feature switch | claude | todo   | agent/claude/T-267 | `src/features/studyBlocks/{blockWidget,inlineText}.ts`, `src/features/studyBlocks/flashcards/**`, `Editor.tsx` (1 line), `comprehension/studyResults.ts`, `quickCommands.ts` |
| T-268 | 3     | ` ```quiz ` block (multiple choice, select-all, true/false, short answer; score and retry)                                          | claude | todo   | agent/claude/T-268 | `src/features/studyBlocks/quiz/**`                                                                                                                                           |
| T-269 | 3     | ` ```mindmap ` block (list body, SVG tree via `treeModel`, fold, pan/zoom, copy as Mermaid)                                         | claude | todo   | agent/claude/T-269 | `src/features/studyBlocks/mindmap/**`                                                                                                                                        |
| T-270 | 5     | Skills emit study blocks: "Note blocks" format for Flash cards, Practice test and Mind map; parse-validate and retry once           | claude | todo   | agent/claude/T-270 | `src/features/skills/builtinSkills.ts`, `skills.ts`, `skillDestination.ts`                                                                                                   |
| T-271 | 3     | `![[page.html]]` inline embed with a shared `PageFrame`, lazy and click-to-load, height messages, frame cap                         | claude | todo   | agent/claude/T-271 | `src/features/drafts/{WebFileView,PageFrame}.tsx`, `src/features/editor/embeds.ts`, `src-tauri/src/pages.rs` (height script only)                                            |
| T-272 | 3     | _(optional)_ Render study blocks, Mermaid and heatmaps inside note embeds                                                           | claude | todo   | agent/claude/T-272 | `src/features/editor/embeds.ts`                                                                                                                                              |
| T-273 | 3     | _(optional)_ Index `[[links]]` and `#tags` inside study-block fences                                                                | claude | todo   | agent/claude/T-273 | `src-tauri/src/index/parse.rs`, `src-tauri/src/index/tests.rs`                                                                                                               |
| T-274 | —     | _(deferred, needs a decision)_ Presentational HTML subset via DOMPurify (§5.3)                                                      | —      | todo   | —                  | `src/features/editor/htmlInline.ts`, `package.json`, `docs/DECISIONS.md`                                                                                                     |

T-267 comes first (it lays down the shared base). T-268, T-269 and T-271 are then
independent and can run in parallel. T-270 follows T-267 to T-269. "Send to Deck"
belongs to the Deck runtime phase, not to this list.

## 10. Open questions for the human

1. **Approve the approach:** typed study blocks (b) plus `.html` page embeds (c), with no
   raw HTML in the app DOM for now?
2. **Skill output for Markdown:** should Flash cards and Practice test write the new blocks
   by default, keep the current folded callouts (which hide answers in Obsidian), or offer
   both as separate formats?
3. **Card identity:** add optional per-card IDs now (for example `Q: … ^c-7f3a`, like
   block IDs) so "Send to Deck" can track cards later, or wait until Deck is built and
   use content fingerprints plus relinking?
4. **Heatmap and AI rules:** results from a learner's own blocks are local and AI-free.
   Should they still be filtered by the note's AI rule (as AI-made page results are
   today), or recorded for every note?
5. **Inline ` ```html ` blocks:** are they wanted at all? Doing them safely means serving
   block content through `axispage` (a change to `pages.rs`, which refuses notes today).
   `.html` files with `![[embeds]]` cover the need without that change.
6. **Embeds:** should `![[Note]]` embeds render these widgets (T-272), or keep showing
   source as they do for Mermaid today?
7. **Cloze cards** (`The {{c1::mitochondrion}} makes ATP`)? Their syntax collides with
   template `{{…}}` variables, so they would need their own marker. Defer?
8. **Presentational HTML (option a, T-274):** do you write `<details>`, `<kbd>` or `<mark>`
   in notes, often enough to justify a sanitizer in the main window?

## 11. Feasibility evidence

No prototype was built. The two mechanisms this proposal depends on are already in
production: lazy fenced-block React cards (T-261, `heatmapBlock.ts`) and sandboxed
vault-page frames with result reporting (T-190 and T-261, `WebFileView.tsx` and
`studyResults.ts`). The new work is parsers, widgets and a frame embed. It adds no new
security surface in the main window.
