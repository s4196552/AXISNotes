# Build Prompt: AXIS, a Local-First Personal Knowledge Base

> Paste everything below this line into a coding agent (Claude Code, OpenAI Codex, or another agent) at the root of an empty project folder. The prompt doesn't depend on a particular agent. If you use two agents on the same project, both should follow `docs/DECISIONS.md` and the phase gates.

---

## Role and working rules

You are a senior full-stack engineer building **AXIS**, a local-first personal knowledge base for the desktop. You build it in **phases**. Follow these rules:

1. **Work one phase at a time.** At the end of each phase, stop. Summarize what you built, show how to run it, list any deviations from this spec, and wait for me to approve before you start the next phase.
2. **Files are the source of truth.** Notes live as plain files on disk in a user-chosen folder (the _vault_). The app must never lock content inside a database. Anything in `.axis/` (indexes, caches) must be rebuildable from the files.
3. **Ask before big decisions.** Before you add a major dependency that is not listed here, change the storage format, or add a paid service, stop and ask me.
4. **Check licenses.** Before you adopt any library, check its license and flag anything that is not MIT, Apache-2.0, BSD or ISC (for example GPL, or a license that needs a commercial key).
5. **Test as you go.** Write unit tests for parsers, the indexer, sync rules and formulas. Write at least one end-to-end smoke test per phase. Each phase's acceptance criteria must pass before you stop.
6. **Keep a decision log.** Record architectural choices and why you made them in `docs/DECISIONS.md`.
7. **Build the local desktop app first.** Every phase in the current scope runs entirely on the user's machine inside Tauri, with no AXIS backend, accounts or servers. The only network calls are to AI providers the user has configured, and web clipper traffic over localhost. Online sync and collaboration are **deferred** (see Section H). For now, only keep the data model sync-friendly (stable file IDs, modification timestamps); do not build any backend code.

8. **Work as two agents.** Development uses two agents: Claude Code as lead/orchestrator and OpenAI Codex as builder and reviewer. Follow the roles, task board, worktree and cross-review rules in `AGENTS.md`. Setup options (MCP bridge, VS Code, computer use for UI QA) are in `ORCHESTRATION.md`.

## Product summary

AXIS is a desktop note-taking and data-management app that works mostly with Markdown files. It works fully offline. It can also sync _selected_ folders to an online account for backup, sharing and real-time collaboration. For example, a user can share their school notes but keep their medical records local only. It also supports spreadsheet-style grids, an infinite freeform canvas and whiteboard, handwriting-to-text, and AI-assisted diagrams.

## Tech stack (defaults; flag it if you have a strong reason to change one)

| Concern                                | Choice                                                                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop shell                          | **Tauri 2** (Rust backend) + **React + TypeScript** + Vite                                                                                                  |
| Markdown editor                        | **CodeMirror 6** with Obsidian-style live preview (rendered while editing, raw syntax shown on the active line)                                             |
| Markdown parsing                       | `unified` / `remark` with custom plugins for wikilinks, tags, block IDs and embeds                                                                          |
| Local index and search                 | **SQLite + FTS5**, accessed from the Rust side (`rusqlite`), stored in `<vault>/.axis/index.db`                                                             |
| File watching                          | Rust `notify` crate, so edits made outside the app are picked up                                                                                            |
| Freeform canvas / whiteboard           | **Excalidraw** (MIT), embedded, with infinite canvas                                                                                                        |
| Grid (Excel-like)                      | A virtualized grid component + a formula engine. **Check licenses**: HyperFormula is GPLv3 or commercial. Propose an alternative or ask me.                 |
| Graph view                             | `sigma.js` + `graphology` (WebGL, handles large vaults)                                                                                                     |
| Diagrams                               | **Mermaid** for rendering; AI generates Mermaid or Excalidraw JSON                                                                                          |
| AI                                     | A **multi-provider layer** in Rust (see _AI providers_ below). The app calls each provider directly using the user's own API key.                           |
| API key storage                        | The OS keychain via the `keyring` crate (Windows Credential Manager, macOS Keychain, Linux Secret Service). Never store keys in plain text or in the vault. |
| Backend (**deferred**)                 | **Supabase**: Postgres, Auth, Storage, Row-Level Security                                                                                                   |
| Real-time collaboration (**deferred**) | **Yjs** CRDTs + a **Hocuspocus** WebSocket server, persisted to Postgres                                                                                    |
| State                                  | Zustand (UI state); the file system and index for everything else                                                                                           |

## AI providers

AXIS is not tied to one AI vendor. The user brings their own API keys and chooses a provider.

- **Supported providers**:
  - **OpenAI** (ChatGPT / GPT models)
  - **Anthropic** (Claude)
  - **Google** (Gemini)
  - **OpenRouter**
  - **Ollama** and **LM Studio**, for local and offline models
  - **Any OpenAI-compatible endpoint** (custom base URL), which also covers Mistral, Groq, DeepSeek, Azure OpenAI and similar services.
- **OpenAI / ChatGPT is a first-class provider** (verified against OpenAI's API changelog, September 2026):
  - **Use the Responses API** for OpenAI. The Assistants API was shut down on Aug 26, 2026, so do not use it. Keep Chat Completions only for third-party OpenAI-compatible endpoints.
  - **Current models and suggested defaults**, shipped in `ai-models.json`:

    | Model ID                                         | Use in AXIS                                                 | Notes                                                                                                                                                                             |
    | ------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `gpt-6-astra`                                    | Smart diagram maker, hard reasoning, "ask my vault"         | Flagship (released Sep 3, 2026). Text and image input. **Does not support** custom `temperature`/`top_p`, `logprobs`, or reasoning effort `none`, so the adapter must omit these. |
    | `gpt-6-sol`                                      | Handwriting-to-text (vision), general default               | Released Sep 22, 2026. Text and image input, up to 272K input tokens. $2 input / $10 output per 1M tokens.                                                                        |
    | `gpt-6-luna`                                     | Spelling and grammar quick fixes, tag and title suggestions | Released Sep 22, 2026. Cheap and fast: $0.10 input / $0.50 output per 1M tokens.                                                                                                  |
    | `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst` | Optional: turn a canvas sketch into an image                | Released Sep 8, 2026. Flare is faster; Sunburst is more detailed.                                                                                                                 |

  - Use the Responses API's **reasoning effort** setting. Map it to a simple "Quick / Balanced / Deep" option in the UI.
  - The adapter must **fail gracefully when a model or parameter is unsupported**: drop that parameter and retry once, then show a clear error. OpenAI changes models often, so `list_models` must refresh from the API and the table above is only the fallback.
- **Defaults for other providers** (also in `ai-models.json`, and editable):
  - Anthropic: `claude-opus-5-5` for diagrams, `claude-sonnet-5` for vision and general use, `claude-haiku-4-5-20251001` for quick fixes.
  - Gemini: fetch the model list at runtime and choose the defaults from it.
- **Architecture**: one Rust `AiProvider` trait with methods `complete`, `stream`, `vision` (image in, text out) and `list_models`. Write one adapter per API format: OpenAI-compatible, Anthropic Messages, and Gemini. Expose these to the frontend through Tauri commands, and stream tokens with Tauri events. API keys never reach the webview.
- **Capabilities**: each model records what it can do: vision, structured/JSON output and context length. Features check these before they run. For example, handwriting-to-text is only offered when the selected model supports vision.
- **Settings UI**:
  - Add or remove providers, enter keys, and test the connection.
  - Pick a default model for each task (_handwriting_, _diagrams_, _text fixes_, _chat/other_).
  - Set an optional fallback order if a provider fails.
- **Model lists**: fetch them from each provider's API when possible, instead of hard-coding them. Where you must ship defaults, keep them in one editable config file.
- **Privacy**:
  - Show which provider and model a request goes to.
  - Folders can be marked **AI: local models only** or **AI: never**, and those rules are enforced in the Rust layer.
  - Log requests locally (metadata only, no content) so the user can audit them.
- **Cost guardrails**: an optional per-request token cap. Show the estimated number of input tokens before large requests.

## On-disk vault format

```
MyVault/
├── .axis/
│   ├── index.db            # rebuildable search/link index
│   ├── config.json         # themes, hotkeys, quick commands, folder icons
│   └── sync.json           # per-folder/file sync rules
├── Daily/2026-09-26.md
├── Templates/Cornell.md
├── School/Biology.md
├── Budget.axgrid           # grid: JSON { columns, rows, cells, formulas, formats }
└── Brainstorm.axcanvas     # canvas: Excalidraw JSON + AXIS card references
```

- **Notes**: `.md` with YAML frontmatter for properties (`status`, `date`, `author`, `priority`, `source`, `tags`, custom fields).
- **Links**: `[[Note Name]]`, `[[Note Name|alias]]`, `[[Note#Heading]]`, block refs `[[Note#^block-id]]`, embeds `![[Note]]` / `![[Note#^block-id]]`. This syntax is Obsidian-compatible on purpose, so existing vaults can be opened.
- **Block IDs**: `^block-id` at the end of a paragraph or bullet. Generate them automatically when a user copies a block reference.
- **Tags**: `#research`, nested `#work/projects/alpha`. A search for a parent tag matches its child tags.
- **Renames**: renaming a note or folder updates every link that points to it.

## Feature spec

### A. Note structure and organization

- **Formats**: (1) Plaintext/Markdown, (2) Grid (Excel-like), (3) Freeform (Excalidraw-like, infinite canvas, where each cell/card can hold text, notes, images or links, with grid snapping for spreadsheet-like flexibility).
- **Page styles / templates**: Plain, Math Grid (graph-paper background), Cornell (cue column + notes + summary), Lined, Dotted, plus user templates from `Templates/`. Templates support variables such as `{{date}}`, `{{title}}` and `{{cursor}}`, plus prompts (ask the user for a value when the template is inserted).
- **Folders**: nested without limit. Each folder can have a custom icon (from the icon picker or an emoji) and a color.
- **Tags and nested tags**, with a tag pane.
- **Properties / metadata**: a typed property editor over the frontmatter (text, number, date, checkbox, list, link, formula).
- **Internal links**, **backlinks** pane, **unlinked mentions** (with one-click "link it").
- **Graph view**: global and local (neighbors of the current note), with filters by tag or folder, colored groups and zoom/pan.
- **Daily notes**: created automatically from a template on first open each day, plus a calendar navigator.
- **Outliner mode**: nested bullets and headings that can be collapsed, dragged to rearrange, and indented or outdented with Tab/Shift-Tab. The result is still plain Markdown lists.
- **Block references and block embeds**: embeds render live and can be edited in place.
- **Canvas / whiteboard**: arrange notes (as live cards), images, links and text spatially. Pen/stylus drawing is supported.

### B. Quick commands (customizable)

- `/` opens the general command palette inside the editor: headings, tables, templates, embeds, diagrams, callouts, page styles.
- `:` opens the icon/emoji picker (`:rocket`).
- Users can add, remove and remap commands and trigger characters in Settings. Store them in `.axis/config.json`.
- A global command palette (Ctrl/Cmd+P) and quick switcher (Ctrl/Cmd+O).

### C. Customizability

- **Themes**: light and dark built in, plus user themes as CSS variable files. Custom CSS snippets.
- **Folder and note icons**, accent colors, fonts, editor width.
- **Assets**: a bundled icon set (for example Lucide) and a full emoji set, searchable.

### D. Retrieval and discovery

- **Full-text search** across note content, properties, tags and grid cell text, not only titles. Support operators (`tag:`, `path:`, `prop:status=done`, quoted phrases). Highlight matches.
- **Search index**: incremental FTS5 index, updated by the file watcher. Target: under 100 ms per query on a 10,000-note vault.
- **Web clipper**: a browser extension (Chrome/Firefox) that saves a full page (converted to Markdown), a selection, a screenshot or a URL. It sends clips to the desktop app through a localhost endpoint the app exposes, protected by a pairing token. If the app is closed, the extension keeps clips in its own storage and delivers them the next time the app runs. (A cloud inbox comes later, together with sync.)

### E. Planning, tasks and structured data

- **Tasks**: `- [ ]` checkboxes with due dates and priority, plus a task view that pulls tasks from the whole vault.
- **Time tracking**: a start/stop timer on any task or note, and manual entries. Store entries in the note's frontmatter (`time_log`). Provide a report view (per note, tag, project and date range).
- **Formulas**: (1) in grids (spreadsheet formulas such as `SUM` and `IF`, and cell references), (2) as computed properties in frontmatter (for example `total: =price * qty`), evaluated in the property panel and in query views.

### F. Handwriting to text (pen input)

- On the canvas or a handwriting block, users write with a stylus. A "Convert to text" action renders the strokes as an image and sends it to the user's selected vision-capable model (GPT, Claude, Gemini, or a local vision model through Ollama), and the result is inserted as editable text.
- Detect **misspellings** and **unclear handwriting**. Low-confidence words are underlined and offer **quick fixes** (a dropdown of alternatives, plus accept or ignore).
- Regular typed notes also get a local spellchecker (Hunspell dictionaries) with quick fixes that works offline. An optional AI "fix grammar/clarity" action is also available.

### G. Smart diagram maker

- From a selection or a prompt (for example "flowchart of mitosis"), generate a diagram with the selected AI model as **Mermaid** (in the note) or as **Excalidraw elements** (on a canvas). Validate the output against a schema and retry once if it is invalid; this matters because models differ in how reliably they return JSON. The user can then edit it by hand.
- It can also build a diagram from structure: turn an outline or a set of linked notes into a mind map or flowchart without using AI.

### H. Sync, sharing and collaboration (hosted): **DEFERRED, do not build yet**

> This section describes where AXIS is heading, so that choices made now don't block it later. Do not write backend, auth or sync code until I explicitly start the online phases.

- **Accounts**: Supabase Auth (email + OAuth).
- **Selective sync**: in the file tree, right-click → _Sync: Off / Backup only / Shared_. The rule is inherited by subfolders and can be overridden per folder or file. Store the rules in `.axis/sync.json`. Anything marked **Off never leaves the device**, and it is also never sent to AI features unless the user explicitly allows it per request.
- **Automatic**: background sync on file change, with offline queueing and resume.
- **Conflicts**: Markdown notes open in collaboration use Yjs (no conflicts). For offline edits made on two devices, do a 3-way merge. If the merge fails, create a `Note (conflict YYYY-MM-DD).md` file and show a banner.
- **Sharing**: share a folder or note by invite (viewer, commenter or editor) or by a public read-only link.
- **Real-time collaboration**: live cursors, presence and co-editing in Markdown, grids and canvases (Yjs bindings for CodeMirror and for Excalidraw).
- **Security**: TLS everywhere and RLS on every table. Design the schema so that end-to-end encryption for "Backup only" folders can be added later; note it as a stretch goal.

## Phases and acceptance criteria

**Phase 0: Foundation**
Scaffold Tauri + React + TS, lint/format, CI and tests. Open or create a vault, show the file tree (create, rename, move, delete to the OS trash), and add a Markdown editor with live preview and autosave. Watch for external file changes.
_Done when:_ I can open a folder, create nested folders and notes, edit and save them, and see changes I make in another editor appear in the app.

**Phase 1: Core knowledge features**
Frontmatter property editor, tags and nested tags, wikilinks with autocomplete, backlinks, unlinked mentions, FTS search with operators, `/` and `:` quick commands, templates (Plain, Cornell, Math Grid, Lined), daily notes, folder icons, themes, command palette and quick switcher. Renaming a note updates its links.
_Done when:_ all of these work on a generated 5,000-note test vault and search responds in under 100 ms.

**Phase 2: Advanced structure**
Outliner mode, block IDs, block references and embeds (editable in place), and graph view (global and local).
_Done when:_ I can reference and embed a single bullet from another note, and editing the embed updates the source file.

**Phase 3: Other formats and structured data**
The `.axgrid` grid with formulas, `.axcanvas` infinite canvas and whiteboard (Excalidraw) with note cards and pen input, tasks view, time tracking and computed properties.
_Done when:_ a grid with formulas saves and reloads identically, and a canvas can hold live note cards and freehand drawings.

**Phase 4: Multi-provider AI layer**
The Rust `AiProvider` trait and adapters (OpenAI-compatible, Anthropic, Gemini, plus Ollama and LM Studio through the OpenAI-compatible adapter), API key storage in the OS keychain, provider settings UI with a connection test, per-task default models, streaming, capability checks, per-folder AI privacy rules and the local request log.
_Done when:_

- The same test prompt works with OpenAI, Claude, Gemini and a local Ollama model (use recorded HTTP fixtures in CI; live calls only when keys are available).
- No API key is ever reachable from the webview or written to disk in plain text.
- A folder marked "AI: never" is blocked from every provider.

**Phase 5: AI features**
Handwriting-to-text with low-confidence quick fixes, local Hunspell spellcheck, the AI "fix grammar/clarity" action, and the smart diagram maker (Mermaid and Excalidraw output, validated against a schema). All of these go through the provider layer.
_Done when:_

- Handwritten text converts to editable text with uncertain words flagged, using at least two different vision-capable providers.
- A prompt produces an editable diagram.

**Phase 6: Web clipper and polish**

- Browser extension with localhost pairing and offline queueing.
- Obsidian vault import.
- Onboarding and a settings UI polish pass.
- Performance pass.
- Installers: Windows `.msi`, macOS `.dmg` and Linux AppImage.

_This completes the local desktop app._

**Later (deferred until I say so): online phases**

- **Phase 7: Sync and sharing.** Supabase, auth, per-folder sync rules, background sync, conflict handling, share links and invites. _Done when_ a "Shared" folder appears on a second machine, and a folder marked "Off" produces zero sync traffic (verified by a test).
- **Phase 8: Real-time collaboration.** Hocuspocus, Yjs bindings for the editor, grid and canvas, presence and roles.
- Once the backend exists, add optional hosted AI access (a proxy with managed keys) for users who don't want to bring their own keys. This goes through the same `AiProvider` trait.

## Open items to raise with me when relevant

- Formula engine choice, once you have checked licenses.
- Default model suggestions for each provider and task. Fetch the current model list instead of hard-coding it where possible.
- Pricing and storage quotas (only once the online phases begin).
- Whether to support importing existing Obsidian or Notion vaults (a Markdown importer is cheap, so recommend it).
- Mobile apps are **out of scope** for now, but keep the core logic (parsers, indexer, sync engine) in a platform-independent package so a mobile client can reuse it later.

**Start with Phase 0.** First, show me the project structure and the list of dependencies (with licenses) you plan to use. Then build it.
