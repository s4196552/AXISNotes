# Decision Log

Newest first. Each entry: date, decision, why, and (for dependencies) license.

## 2026-10-29: Marks close as you type; Ctrl+B, Ctrl+I and formatting commands (T-139)

- **Typing `` ` `` or `*` inserts its closer, with the cursor between** (`src/features/editor/inlineMarks.ts`). A second mark in an empty pair grows it (`**|**`, ` ``|`` `), and ` ` ``` alone on a line becomes a code block with the cursor after the opening fence, where the language goes. Typing the mark at its closer steps over the whole closer, so `**bold**` typed in full comes out right. With text selected, `` ` `` or `*` wraps it and keeps it selected.
- **It gets out of the way of ordinary text:** no pairing touching a letter or digit (`2*3`, `don`t`), after a backslash, or in code, frontmatter, raw HTML, comments or math. A space in an empty `_`pair drops the closer, so`_ `still starts a bullet and`2 * 3`stays as typed; Enter on a line holding only`***` keeps a rule. Backspace in an empty pair removes one mark from each side. Only for one plain cursor, never during IME composition.
- **Bold (Ctrl+B), Italic (Ctrl+I), Strikethrough (Ctrl+Shift+S) and Insert inline code (Ctrl+E)** are app commands, so they're remappable and in the palette; Bold, Italic and Strikethrough are also in the command menu under Text style. They wrap a selection or unwrap it when the marks are already there, and leave an empty cursor between an empty pair. Their shortcuts only act with focus in a note editor (`onlyIn: ".cm-editor"`), so the grid keeps its own Ctrl+B, and they edit the focused editor (an embed or canvas card too). `***x***` counts as both bold and italic, so each toggles separately.
- `_` and `~` are not paired as you type: `snake_case` and `~` for "about" are too common.

## 2026-10-29: Fold arrow styles (T-138)

- **Settings → Appearance → Fold arrows** picks how the arrows that fold headings and toggle lists look: Triangle (the default, as before), Chevron, Arrow, Circled chevron, Plus and minus, or Boxed plus and minus. It is saved as `appearance.foldArrow` in the vault's config; an unknown value falls back to Triangle.
- **The icons are inline SVGs used as CSS masks** (`FOLD_ARROWS` in `src/app/appearance.ts`), filled with the text colour, so they follow every theme and a change applies at once without redrawing the editor. Each style gives its closed icon, an optional open icon (plus → minus) and how far it turns when opened (90° for arrows, none for plus/minus). The widget no longer holds a `▸` character; its `aria-label` and `aria-expanded` are unchanged. No dependency added.

## 2026-10-29: A lone `1` stays text; digits pick headings in the command menu (T-137)

- **Typing `1` on an empty line no longer inserts `1. `.** It turned a plain `1` into a list the user didn't ask for, and broke the command menu opened with Ctrl+/ on an empty line, where `1` should find Heading 1. A numbered list still starts as soon as `.` follows a number (`1.` → `1. `), so this supersedes only the `1` rule of the T-071 entry below; its `1. ` follow-ups (`10`, `1:30`, `1/2`) are gone with it.
- **In the command menu, `1` to `6` on their own list Heading N, then Toggle heading N** (with their Turn into rows on a line with text), so Enter makes that heading. CodeMirror matches a one-character query only against a label's first letter, so a digit matched nothing before. Other numbers and longer queries filter as before; a disabled heading command stays hidden.

## 2026-10-22: Updates run the installer directly again (T-123)

- **The update window from T-119 is gone.** On the human's machine every update after 0.3.20 failed with the installer's "Error opening file for writing: …\AXISNotes\axisnotes.exe": the installed exe and the update window's temp copy both refused writes (Windows error 5, not 32 "in use"), with no process holding them, while `uninstall.exe` beside it and fresh copies of the same exe were writable. Bitdefender's behaviour monitor (ATC) is running there; an unsigned app copying itself to `%TEMP%`, running the copy and that starting an installer is a dropper pattern. Bitdefender's own logs weren't readable, so this is the likely cause rather than a proven one. 0.3.19 → 0.3.20 (installer started directly) had worked.
- **Human decision:** go back to the installer's own passive window (`/P /UPDATE /R`), which keeps the AXISNotes artwork (header, sidebar, icon) from T-119.
- `updates_install` also clears the staging folder first (old installers, the update window's leftovers); files it can't remove are left.
- A copy of 0.3.20–0.3.22 still runs its own update window when updating _from_ those versions; a machine where that was blocked needs the new installer run by hand once.

## 2026-10-21: AXISNotes's own update window and branded installer (T-119)

- **Updates install in our own window**, not the NSIS installer's passive progress window. The app can't show it itself (the installer replaces its files), so `updates_install` copies the running executable to `%TEMP%\AXISNotes-update\AXISNotes-updater.exe`, writes a job file (installer, app to reopen, versions, notes) and starts the copy with `--axis-updater <job>`, then quits. In that mode `run()` builds only the update window (the same embedded pages, `window.__AXIS_UPDATER__` set, its own WebView2 data folder), which runs the verified installer with `/S /UPDATE` and then reopens the app. The copy has a different name from `axisnotes.exe`, which the installer closes if still running. If the window can't start, the old passive installer (`/P /UPDATE /R`) runs instead. A failed install says so and offers Open AXISNotes or Close.
- **Always the dark palette** in the update window: it shows before any vault (so any theme) is open, and the pearl logo is drawn for dark backgrounds.
- **Installer artwork** (`src-tauri/installer/{sidebar,header}.bmp`, plus the app icon) for fresh installs, made by `scripts/installer-art.py` from the app icon and the dark theme tokens. That script uses **Pillow** (HPND/MIT-CMU licence), a development tool only; nothing from it ships in the app.
- The first update to show the new window is the one after the version that adds it: an update is installed by the version already running.

## 2026-10-20: Import from Notion, Obsidian, Evernote and Markdown (T-103)

- **One "Import notes" dialog, one entry per app**, each saying in a sentence how to get the export out: Notion ("Markdown & CSV" `.zip`, or the unzipped folder), Obsidian (vault folder), Evernote (`.enex`, or a folder of them, one folder per notebook) and Markdown or HTML (a folder or `.zip`, which covers Bear, Logseq, Roam, Typora, Joplin and Simplenote). It replaces the Obsidian-only dialog and the `import_obsidian` command with `inspect_import(kind, source)` and `import_notes(kind, source, target, options)`.
- **Always a new folder.** The default is `Imported/<App> <YYYY-MM-DD>`, and if that folder (or file) exists the import goes to `… 2`, `… 3`. Importing into the vault root is no longer offered. Inside the folder, names are made unique per folder, ignoring case. Nothing in the vault is overwritten: a file that somehow exists is skipped and listed. This supersedes T-032's "skip what exists, or import into the root".
- **The work is in Rust** (`src-tauri/src/import/`). A preview lists counts and warnings before anything is written. The import reports `import://progress` events (at most ten a second) for a progress bar, then rescans the index once.
- **Notion**:
  - The 32-hex-character IDs are dropped from file and folder names. A page, its folder of subpages and its database keep one name, and pages left with the same title become `Untitled`, `Untitled 2`.
  - Relative Markdown links, and `notion.so` addresses whose ID is in the export, become wikilinks with the full vault path (`[[Imported/Notion 2026-10-20/Home/Plan|Plan]]`). The full path can't resolve to a same-named note elsewhere, and renames still update it. Links to attachments keep Markdown syntax with a corrected relative path, which also works in other editors. Links to files missing from the export are left as written and counted in the summary.
  - Databases: the full table (`_all.csv`) wins over the view CSV, and links to the view are redirected to it. Tables become `.axgrid` grids with a bold header row, or optionally Markdown tables whose first column links to the row pages. A row page's leading `Property: value` lines become YAML frontmatter, but only for names that are columns of its database, so ordinary text with a colon stays. `Tags` becomes a list.
  - The opening `# Title` that only repeats the page name is dropped, because AXISNotes shows the file name as the title.
  - Multi-part exports (a zip of `Part-N.zip`) are read part by part through a temporary copy of each inner zip. Entries are read straight from the zip, never unpacked under their long names, which can exceed Windows' path limit.
- **Markdown/HTML**: `.md`, `.markdown` and `.txt` become notes, and HTML pages are converted to Markdown. Relative links to notes become wikilinks, and a zip's single wrapping folder is unwrapped. Logseq's `logseq/` folder (settings, backups) is left out, and so is `__MACOSX`. Names are cleaned only where Windows can't store them.
- **Evernote**: each note keeps its title, and created/updated dates, tags, source URL and author become frontmatter. ENML becomes Markdown: `div` lines, bold and italic (including Evernote's `style` spans), to-dos (`- [ ]`), lists, tables, code and quotes. Attachments go to `Attachments/` beside the notes and are embedded where the note shows them. They're matched by MD5, as `<en-media hash>` requires, and an attachment the text doesn't show gets a link at the end.
- **Obsidian** is unchanged in kind: notes are copied byte for byte, JSON Canvas files are converted, and template and daily-note settings are offered. It now also gets the new folder, progress and summary.
- **No new dependencies.** HTML/ENML and the ENEX wrapper are read by a small forgiving tokenizer (`import/html.rs`). quick-xml (MIT) was already in the lockfile, but its strict parsing rejects HTML and its API changes between releases. CSV parsing and MD5 (used only to match Evernote hashes) are a few dozen lines each, and both are tested against RFC vectors. Zip reading reuses the `zip` crate (MIT) already used for packs.
- **Deferred:** OneNote, Apple Notes, Google Keep (Takeout JSON), Roam/Logseq JSON and EDN exports, Joplin `.jex` and Bear `.textbundle` (TextBundle needs its `text.md` renamed after the bundle), and Evernote note-to-note links (`evernote:///` addresses carry no IDs that are in the export). Each needs its own parser and fixtures.

## 2026-10-20: Home and folder dashboards (T-100)

- **Layouts live in the vault config, not in a new file format:** `.axisnotes/config.json` → `dashboards`, keyed by folder path (`""` is the vault's Home). Each holds `enabled` and an ordered list of widgets (`calendar`, `tasks`, `schedule`, `links` with pinned paths, `recent`). A per-folder file would have been a new storage format, which needs the human's approval (AXIS_BUILD_PROMPT.md), and path keys already work for folder icons and colours. Saved layouts are checked on read; unknown widgets and malformed links are dropped, so a hand-edited config can't break the view.
- **Nothing is lost by turning a dashboard off.** Removing a folder's dashboard (or trashing the folder) sets `enabled: false` and keeps the widgets, so adding it back restores the layout. Renaming or moving a folder re-keys dashboards inside it and updates pinned links anywhere. A pinned link whose file is gone stays as a "Missing" card that can be relinked or removed, never silently rebound. Home always exists and can't be removed; until it is first edited it shows the default widgets, with fixed IDs so the first edit finds its widget.
- **Dashboards open in tabs** as a `dashboard` view whose path is the folder. No note is active while one shows (`activePath` is null), so note panels don't treat a folder as a note. Restored tabs are checked against folders as well as files.
- **The day schedule is derived; Notes has no calendar storage** (AXIS Calendar is a separate, unbuilt suite app). It shows lines in today's daily note that start with a time (`- 09:00 Standup`, `- [ ] 2-3pm Lecture`, `07:30 Run`), plus tasks anywhere in scope that are due today and start with a time. Accepted times: `9:00`, `09.30`, `9am`, `2:30 pm` and ranges (`14:00–15:30`, `2-3pm`, where the end's am/pm also applies to the start unless that would put the start after the end). Headings, frontmatter and code blocks are skipped. Timed tasks can be ticked off in place, through the same revision-checked edit as the Tasks view.
- **Today's tasks** are open tasks due today or earlier, every task in today's daily note, and tasks due today that are already done (so a tick doesn't make the row vanish). A folder dashboard scopes tasks, the schedule, recent files and the link picker to that folder; the calendar always shows the vault's daily notes.

## 2026-10-19: Icon and image packs (T-091)

- **Packs live in the vault, hidden:** `.axisnotes/packs/icons/<Pack>/` and `.axisnotes/packs/images/<Pack>/`, so they travel with the vault (sync, backup, another computer) without showing in the file tree. The user chose this over a visible `Packs/` folder and over app-wide packs (which would leave notes pointing outside their vault). Icons and covers refer to pack files by vault path (`image:.axisnotes/packs/…`, `[[.axisnotes/packs/…]]`) instead of copying them into `attachments/`. Covers that use a pack image don't show in Obsidian, which ignores dot-folders.
- **Upload from a folder or a `.zip`** (the user asked for both). Importing flattens the pack: images only, an icon pack with SVGs keeps only those (packs often repeat each icon as PNGs in several sizes), and the shallowest copy of a repeated name wins. Limits: 25 MB per image (larger ones are skipped), 10,000 images and 500 MB per pack, 100,000 zip entries. Only a zip entry's base name is used, so entries can't escape the pack folder; sizes are re-checked while reading. Files are copied into a hidden staging folder and renamed into place, so a failed import leaves nothing behind. Removing a pack moves it to the OS trash.
- **One-colour icon packs** (all SVGs, naming no colour but black or `currentColor`) are marked at import (`.pack.json`) and drawn with a CSS mask: in the text colour by default (saved as `color: currentColor`), or any colour picked. Other packs show their own colours.
- **Asset scope:** the open vault's `.axisnotes/packs` is added to the asset-protocol scope by name, because scope globs skip dot-folders on macOS and Linux.
- **Dependency:** `zip` 7.4 (MIT), with `typed-path` (MIT OR Apache-2.0) and `zopfli` (Apache-2.0); `flate2` and `crc32fast` were already in the tree. 7.x rather than the newest 9.x, which needs a newer Rust.

## 2026-10-19: Notion-style command menu: Turn into, toggles and descriptions (T-090)

- **Toggles are Obsidian foldable callouts:** `> [!toggle|h1]- Title` with the inside on the `> ` lines below. `|h1`–`|h6` (callout metadata) makes a toggle heading; without it the toggle is a toggle list. `+` is open and `-` closed, so the open/closed state is saved in the note and Obsidian folds the same block. The user chose this over plain headings with folding (no distinct block, state not saved) and HTML `<details>` (HTML in notes, awkward to edit).
- **Toggles are drawn in two parts:** a state field hides a closed toggle's inside (hiding across line breaks must come from a state field) and makes it atomic for the cursor; a view plugin draws the arrow, the heading size and the indent, showing the Markdown only on a focused title line like the rest of the live preview. Code fences are tracked while scanning rather than read from the syntax tree, which may not be parsed that far yet.
- **New blocks and Turn into, like Notion:** a block command (text, headings, lists, task, toggles, quote, callout, code) starts a new line under a line that has text, and replaces an empty line. While a query is typed on a line with text, each block command is followed by its "Turn into", which changes the current line and keeps its text.
- **Descriptions** sit under each command's label (an icon tile on the left, the Markdown hint on the right).

## 2026-10-18: Obsidian-style graph physics and a tree layout (T-086)

- **Live physics with d3-force instead of ForceAtlas2.** Obsidian's graph is a live simulation you can drag, with four sliders (centre, repel, link force, link distance); d3-force has exactly those forces, stops by itself when it cools (`alphaMin`), and pauses with `requestAnimationFrame` when the window is hidden. ForceAtlas2 has no link distance and no dragging story, so `graphology-layout-forceatlas2` is removed. Up to 120 ms of ticks run before the first frame so the graph doesn't open as a cloud; the rest animates. Graphs over 1,500 notes use a coarser Barnes–Hut (`theta` 1.2, `distanceMax` 600) and cool faster. The physics now runs on the main thread (ForceAtlas2 used a worker for big graphs); it only runs while the graph view is open and settling.
- **Dragging** pins the node to the pointer and keeps the simulation warm (`alphaTarget` 0.3) so neighbours follow. Sigma rescales the whole graph to fit while it settles; the first drag, pan or zoom (or the simulation ending) freezes that frame (`setCustomBBox`), otherwise the dragged node would drift away from the pointer. **Animate** scatters the nodes and re-fits.
- **Display and groups don't re-run the layout:** node size, link thickness, arrows, text fade and colour groups go through sigma's reducers and a refresh; force sliders reheat the existing simulation. Filter and theme changes rebuild the graph but reuse each note's last position, so nothing jumps.
- **Colour groups** use the filter syntax (`text`, `tag:x`, `path:x`); the first matching group wins, like Obsidian.
- **Tree layout** (Graph | Tree switch): a breadth-first spanning tree of a root note's links or backlinks, or the vault's folders, drawn as SVG (boxes and labels are easier to read and style than WebGL, and trees are capped at 1,500 notes). Each note appears once, at its shallowest level; further links to it are counted (`+n`), not drawn. Siblings are alphabetical because the Rust graph's edges are sorted, not in note order. Columns per level with headings, elbow connectors, the path to the hovered/focused (else open) note in the accent colour, collapsible subtrees, pan/zoom/fit, and ARIA tree keyboard navigation. Root: the chosen note, else the open note, else the most-linked note; right-click any node to re-root.
- **Settings are per device** (`localStorage` key `axisnotes.graph`, sanitized on load). The local graph in the sidebar keeps the default look and forces.
- Sigma now mounts with `allowInvalidContainer`, so a view opened while the window is minimized (zero size) draws once the resize observer sees room.

| Package                           | Version | License | Purpose                                                 |
| --------------------------------- | ------- | ------- | ------------------------------------------------------- |
| d3-force                          | 3.0     | ISC     | Graph physics (already in the lockfile through Mermaid) |
| @types/d3-force                   | 3.0     | MIT     | Types (dev)                                             |
| ~~graphology-layout-forceatlas2~~ | —       | MIT     | Removed: replaced by d3-force                           |

## 2026-10-13: Images, video and audio in notes, including from the web (T-075)

- **Embeds on a line of their own render inline**, in both Obsidian syntaxes:
  - `![[photo.png|300]]` (as before), `![[clip.mp4]]` and `![[talk.mp3]]` from the vault;
  - Markdown `![alt|300](path)`, with relative `../` paths and `%20`/`<…>` for spaces;
  - web images and video files, `![](https://…/pic.jpg)` and `![](https://…/clip.mp4)`;
  - YouTube and Vimeo links, `![](https://youtu.be/…)`, as their players. YouTube uses its privacy-enhanced `youtube-nocookie.com` player and keeps a `t=` start time.
  - Video and audio files opened from the file tree play in the app too.
- **Getting media in:**
  - Pasting a screenshot saves it as Obsidian does, `Pasted image 20261013211845.png`; a copied file keeps its own name. Text copied from Excel or Word, which also carries a picture of itself, still pastes as text.
  - Files dropped from Explorer/Finder onto a note are copied into the vault and embedded where they land. Files already in the vault are linked, not copied.
  - "Image, video or audio…" in the command menu opens the system file picker.
  - Dragging a file from the file tree into a note embeds it (a note becomes a `[[link]]`).
  - Names that clash with another file use the full path; names a wikilink can't hold (`#`, `|`, `[`, `]`, `^`) use `![](<path>)`.
- **Attachment folder** (Settings → Files & links), stored as `attachments.folder` in `.axisnotes/config.json`, uses Obsidian's forms: empty for the vault root, `./` next to the note, `./name` a folder next to the note, else a vault folder. The default is `Attachments`.
- **The page never names a file outside the vault for the backend to read.**
  - Rust catches the window's drop event and keeps the dropped paths; `import_dropped` imports only those.
  - `pick_attachments` runs the native picker itself.
  - Pasted bytes go to `save_attachment` as the raw IPC body (no base64), with names in percent-encoded headers.
  - Copies are atomic (a hidden temporary file, then a rename), and names count up (`clip 1.mp4`).
- **Network: an approved exception to "no network except AI".** The user asked for web media like Obsidian's (2026-10-13). A note that embeds web media loads it from those sites when shown; vault media never leaves the device. The CSP gains:
  - `img-src https:`;
  - `media-src 'self' asset: http://asset.localhost blob: https:`, which local video/audio also needs;
  - `frame-src https://www.youtube-nocookie.com https://player.vimeo.com`, and no other frames.
- **Players are sandboxed iframes** (`allow-scripts allow-same-origin allow-presentation`, no popups) with a `strict-origin-when-cross-origin` referrer, which YouTube needs to play. Tauri does inject its IPC bridge into them, but every call from their origin is refused. Checked on the real app (2026-10-13): app commands (`current_vault`, `list_tree`), core ones (`plugin:app|version`, `plugin:event|listen`, "allowed on: URL: local") and a raw request to the IPC endpoint (no invoke key) all fail from the YouTube frame, while the app's own calls work.

## 2026-10-12: Closing never loses an edit either (T-074)

- **Closing the window saves every open document first**, the same way installing an update does (`src/features/files/beforeExit.ts`: freeze the window, wait a moment for blur-committed edits, `saveAll()`).
  - The frontend listens for Tauri's close request, which keeps the window open (Tauri prevents the close while JS listens), and closes it with `destroy`. The capability adds `core:window:allow-destroy`.
- **If anything can't be saved, the window stays open** and the status bar names the notes: "Not closed, so no edits are lost. Unsaved changes in “Welcome” (changed on disk). Resolve it, or close again to quit without saving it."
  - Closing again within 15 s still saves everything it can, then quits without the rest. A failing disk or network folder must never trap the user in the app.
- **A note closed while its "changed on disk" or "moved or deleted" banner shows keeps the editor's version in a recovery file** (`Name (unsaved …).md`, T-073's mechanism). Before, switching notes dropped it silently. The file on disk is not touched, and a moved or deleted note is not brought back.
- **An embed whose source block changed keeps the edit and asks.** Its autosave no longer reloads the block over the edit. The embed header offers **Reload from source** or **Keep mine** (write this version over the changed block). If the block is gone, it offers **Discard my edit**. Until the user chooses, installing and closing name it as a conflict. This replaced T-073's `preserveEdits` switch.

## 2026-10-10: Installing an update saves everything first (T-073)

- **"Install and restart" (banner and Settings → Updates) saves every open document before it starts the installer**, because the installer closes the app at once (`app.exit(0)`) and an edit still inside the autosave delay would be lost.
  - Notes, grids, canvases and editable embeds register a `flush` with `src/features/files/unsavedWork.ts`. `saveAll()` calls them all, waits for the writes (including the final write of a document that just closed) and returns what is still not on disk. A flush that throws counts as unsaved.
  - **A closed document's failed final write goes into a recovery file.** A document that closes (e.g. switching notes) writes its last changes once, after any save already under way. If that write fails, the changes are written to a new file next to the original, `Name (unsaved 2026-10-10 14-03-22).md`, and the user is told.
    - Each document notes the vault it was loaded from. Its final write and any recovery file happen only while that vault is open: opening another vault switches the backend before the old editor unmounts. The recovery file is only ever created, never overwritten.
    - If it can't be created either, `saveAll` tries again and reports the file until it works, so installing is refused meanwhile.
    - This replaced retrying the original write, which could lose content (a later save "settled" it), raise false failures, or recreate a renamed or deleted file. A new, clearly named file has none of those problems. It follows the build prompt's `Note (conflict YYYY-MM-DD).md` convention.
  - While installing (`preserveEdits`), an embed whose source block changed keeps its edit and reports a conflict. It does not reload over the edit as its ordinary autosave does. This also applies to a save already under way when Install was clicked.
  - A document that keeps changing while it saves is saved again, up to three times.
  - Saves wait until no write is in flight, then re-check that the document still needs saving. Before, two saves queued behind one write both wrote, and the second's mtime check raised a false conflict.
- **If anything can't be saved, nothing is installed.** That covers an unresolved "changed on disk" conflict, a note moved or deleted elsewhere, or a failed write. The banner names each file and why ("Unsaved changes in “School/Biology” (changed on disk)"), so the user can resolve it and try again. Saving never forces past a conflict: the user decides which version wins.
- **The window is made `inert` while it saves and installs**, so no new edit can start after the save. It is restored if installing is refused or fails.
  - The global shortcut listener ignores every key while the window is inert, because shortcuts like Ctrl+Shift+B would otherwise still change a note.
  - The install buttons prevent `mousedown`, so pressing one doesn't blur an embed (which could reload over its edit) before `install()` has turned on `preserveEdits`.
- **`write_file` and `create_file` take an optional `vault_root`.** They refuse (`Io`) if it isn't the open vault. Closing writes and recovery files pass the vault their document was loaded from.
  - A frontend check alone can't order against a vault switch: `open_vault` is async, so the backend can switch while the store still names the old vault.
  - `updates_install` itself is unchanged; the guard runs before it is called.
- **A grid change is handed to the save directly** (`markDirty(serialize)`), and install waits one macrotask after freezing. A cell committed by install's blur is otherwise still unrendered React state when the save runs, and the old sheet would be written.

## 2026-10-10: Lists start as you type `-` or `1` (T-071)

- **Typing `-` at the start of a line inserts `- `**, so the line is a bullet straight away; no space is needed. Before existing text, it turns that line into a bullet. **Typing `1` on an empty line inserts `1. `**, and typing `.` after a number at a line's start inserts `. `.
- **The next keystroke can take it back, so ordinary text still comes out as typed:**
  - A space, or the `.` of `1.`, is absorbed, since the formatting already added it. That way `- `, `1. ` and `1.` habits don't leave double spaces.
  - `-` after an auto `- ` gives `--`, so `---` still makes a rule or frontmatter.
  - A digit, or `,` `:` `/` `)` `-`, after an auto `1. ` gives plain text (`10`, `2026`, `1:30`, `1/2`, `1,000`). A digit after an auto `1.` or `3. ` gives a decimal (`1.5`, `3.5`).
  - Backspace right after the formatting leaves only the character that was typed.
  - The state is forgotten as soon as the cursor moves or anything else changes.
- **Never in code, frontmatter or `$$` math**, never with several cursors, and never during IME composition, so Chinese, Japanese and Korean input methods are untouched. Only `1` starts a numbered list on its own; other numbers at a line's start are usually text.
- **Live preview shows the bullet on the line being edited too.** The raw `-` appears only while the cursor is on the dash itself. Before, the bullet only rendered once the cursor left the line. A bullet just started under a paragraph (`- ` with nothing after it) is paragraph text to the Markdown parser, so it gets a bullet while it's typed as well.
- Enter continuing a list, and Enter on an empty item ending it, come from CodeMirror's Markdown keymap, which was already active.

## 2026-10-10: Translucent theme effects: Clear, Blur, Frosted, Mica, Mica Alt (T-072)

- **An Effect slider replaces the "Blur behind the window" checkbox.** It has five stops, from most to least see-through: **Clear** (no effect), **Blur** (Tauri `blur`), **Frosted** (`acrylic`, the old blur and still the default), **Mica** (`mica`) and **Mica Alt** (`tabbed`). Clickable names sit under the slider, and the hint describes the chosen effect.
  - These are all the materials Windows offers a window, and they're all Tauri `setEffects` effects. macOS has many vibrancy materials, but see-through windows are Windows-only here for now (T-069).
  - Blur is documented to lag while dragging on newer Windows 11 builds, and the hint says so. Mica and Mica Alt are Windows 11 only.
- **Saved as `appearance.windowEffect`.** A 0.3.1 config with `windowBlur: false` migrates to Clear, and anything else gets Frosted, which is the same acrylic as before. The old key is left in place, as unknown keys always are.
- **Every effect except Clear needs Windows' "Transparency effects".** Measured on a machine with them off: Windows accepts all four materials but paints each as a solid fill. So while the setting is off:
  - the app sends no effect, and the window looks Clear;
  - the hint names the Windows setting;
  - the choice is still saved, and it applies the moment the setting is turned on (`prefers-reduced-transparency` is watched live).

## 2026-10-09: Translucent theme with an opacity setting (T-069)

- **Translucent (`axis:translucent`) makes the window itself see-through**, so the desktop shows behind the app. It follows the OS light/dark setting.
  - **Window opacity** (20–100%, default 80%) and **Blur behind the window** (default on) appear in Settings → Appearance while it's the theme. They're saved as `appearance.windowOpacity` and `appearance.windowBlur` in `.axisnotes/config.json`; older configs get the defaults.
  - The blur is Windows acrylic (`setEffects`), like Windows Terminal's acrylic. At 100% the window is solid and nothing is blurred.
- **The main window is created transparent** (`transparent: true` in `tauri.conf.json`). This is needed because WebView2 can't become see-through after the window exists.
  - Every other theme paints an opaque page, so they look the same as before.
  - `app.css` paints a solid light or dark page under the app until a theme takes over, so the page is never see-through by accident. It is not an inline `<style>` in `index.html`: Tauri hashes inline styles into the CSP, which disables `'unsafe-inline'` and blocks the styles CodeMirror injects (trailing spaces then vanish while typing).
  - The capability adds `core:window:allow-set-effects` (clearing effects uses it too).
- **Only the backdrop carries the opacity** (`--tl-alpha`, set on the document). Panes are faint tints over it, so nested surfaces (an editor inside a pane, buttons on a panel) don't stack up into opaque patches. Menus and dialogs stay nearly solid, for reading. Tokens stay plain `rgba()`, which the graph's colour parser can read.
- **Windows only for now.** macOS would need Tauri's private API, which isn't allowed in the App Store, and Linux depends on the compositor. Elsewhere the theme stays solid, and its settings are disabled with an explanation.

## 2026-10-09: Five more built-in themes, and theme tiles (T-067)

- **Darker, Minimal, Glass, High contrast and Retro** join Light, Dark and Match system:
  - **Darker:** near-black surfaces for OLED screens, with a soft violet accent.
  - **Minimal:** warm white and monochrome ink, with hairline dividers and quietly underlined links.
  - **Glass:** frosted, translucent floating panels over a soft wallpaper, like macOS. It follows the OS light/dark setting.
  - **High contrast:** black, white and yellow. Links are underlined and focus rings are strong. Body and muted text meet WCAG AAA.
  - **Retro:** cream paper, ink lines, hard offset shadows, monospace UI and serif note text, and a pinstriped title bar.
- **The new themes' saved ids are `axis:darker`, `axis:minimal`, `axis:glass`, `axis:contrast` and `axis:retro`.**
  - A user theme's id is its file name, and a colon can't be in a Windows file name. So a vault that already has its own `retro.css` keeps loading it.
  - CSS keeps short names (`data-theme="retro"`, via `themeCssName`).
  - Light, Dark and Match system keep their old ids.
- **Glass frosts a `::before` layer behind each pane and dialog**, never the pane itself:
  - `backdrop-filter` on the pane would make it the containing block of fixed-position menus (file tree, handwriting fixes), shifting and clipping them.
  - It uses no `isolation` either, because a stacking context per pane lets the next pane paint over a menu.
- **Themes stay CSS variables.**
  - New tokens cover what themes needed beyond colours: `--bg-elevated`, `--app-backdrop`, `--link`, `--heading`, `--scrim`, `--scrollbar`, `--radius-sm/-/md/lg` and `--shadow-pop/-modal`. Their defaults reproduce the old look, and feature CSS now uses them instead of fixed radii and shadows.
  - A few structural touches (floating glass panes, retro buttons) are scoped to their own `data-theme`.
  - User themes can override the new tokens too.
  - Fonts are system fonts only: no new dependencies or bundled font files.
- **Settings → Appearance → Theme is a grid of tiles.**
  - Each tile is a miniature of the app drawn with its own theme's tokens (`[data-theme-preview]`), so it looks right whatever theme is active.
  - The tiles are native radio buttons: arrow keys and screen readers work.
- **The graph follows theme changes.** `applyAppearance` fires `axisnotes:theme-changed`; `onThemeChange` also covers the OS switching light/dark. The graph rebuilds on either, because it reads colours once. Before, switching light/dark left the graph's old colours.
- **The OS dark-mode fallback only applies to Match system and user themes** (`:root:not([data-theme])`), so it can't leak into a named theme.

## 2026-10-07: Updates from a folder (T-066)

- **The user chose:** check on launch and ask before installing, with updates coming from a local folder for now (not GitHub Releases).
- **How it works:**
  - `scripts/publish-update.ps1 -Version X.Y.Z [-Notes …] [-Folder …]` sets the version, builds the NSIS installer and copies it into the updates folder next to a `latest.json` (`version`, `notes`, `pubDate`, and per platform a `file` and its `sha256`).
  - The default folder is `%USERPROFILE%\AXISNotes Updates`. Settings → Updates can point it anywhere, including a network share.
  - On launch, AXISNotes reads `latest.json`. If the version is newer (semver), a banner offers **Install and restart**. Nothing installs without that click. "Check for updates" is also in the command palette and in Settings.
  - Installing copies the installer to `%TEMP%\AXISNotes-update`, checks the copy's SHA-256 against the manifest and runs the copy with the NSIS flags `/P /UPDATE /R`: passive progress, update mode (shortcuts left as they are), relaunch when done. The app then quits so the installer can replace it.
- **Safety:**
  - The manifest's `file` must be a plain file name in the folder; paths are rejected.
  - The installer is started with an argument array, never a shell string.
  - The checksum is checked on the copy that runs, so a file changed after the check is never run.
  - The checksum proves the installer is the one the manifest names, not who made it. Anyone who can write to the updates folder can publish an update, so it should only be writable by you. Signed updates (Tauri's minisign updater) come with hosted releases.
  - Development builds refuse to install, so testing never overwrites the installed app.
  - Settings live in `updates.json` in the app's settings folder (device-local). With `AXIS_CONFIG_DIR` set (E2E tests), the default updates folder moves there too.
- **No network traffic:** AXISNotes only reads a folder. GitHub Releases with `tauri-plugin-updater` can be added later behind the same banner and settings.
- **Windows only for now:** macOS and Linux show the update but refuse to install.
- **The version now matters:** each published update needs a higher version. The script sets it in `package.json`, `tauri.conf.json` and `Cargo.toml`. This release is 0.2.0.
- **The first updater build has to be installed by hand.** 0.1.0 has no updater, so 0.2.0 is installed once with its installer. Later versions arrive through the banner.

| Package (Rust) | Version | License           | Purpose                                                 |
| -------------- | ------- | ----------------- | ------------------------------------------------------- |
| semver         | 1.0     | MIT OR Apache-2.0 | Comparing versions (already in the build through Tauri) |

## 2026-10-02: Hide/show side panels (T-064)

- **A button at the top right of the main area** hides both side panels, and brings them back. The same toggle is the command "Hide/show side panels" (`Ctrl+\`), and there are separate commands for the left and the right panel.
- **Per device:** which panels show is kept in local storage (`axisnotes.layout`), like zoom. It's about the screen you're on, not the vault.
- **Hidden left panel stays mounted** so the file tree and search keep their state. **The hidden right panel is unmounted** so its live graph does no work while it isn't visible.
- **Choosing a left-side view** (Files, Search, Tags, or Ctrl+Shift+F) shows the left panel again, so the result is never invisible.

## 2026-10-07: `[[/path]]` links are vault-absolute (T-065)

A wikilink target that starts with `/` names one exact note path from the vault root (`[[/Biology]]` is `Biology.md`, never `School/Biology.md`), with no name, suffix or alias matching. Without it, a root note can't be linked from a folder that has a note with the same name, because same-folder notes win.

- All three resolvers follow the rule: Rust `Index::resolve`, the graph `Resolver`, and the memory backend.
- `@@` and `((` write the shortest target that can't resolve elsewhere: the name; else the path; else `/path`.
- Obsidian also reads vault paths, so these links stay portable.
- Rename rewriting (Rust and memory) keeps a `/path` link absolute. When the new name and path would both resolve elsewhere, it falls back to `/path`.
- `@@` date links use `/Daily/…` only when another note could also match them, such as an archived copy.

## 2026-10-07: Command symbols: Ctrl+/, @@, ((, ::, :, $$, {{ (T-065)

The human chose the symbols after comparing what Notion, Obsidian, Roam, Logseq, Tana and Slack use.

- **Command menu: `Ctrl+/`** opens it at the cursor; typing after it filters it, as typing after `/` did.
  - It's an app command (`command-menu`), so it's remappable and listed in the palette. Outside a note it opens the palette.
  - CodeMirror's own `Mod-/` (toggle comment) is removed, so a remapped shortcut can't fall through to it.
  - A typed trigger is optional and **off by default**. Vaults that saved the old default `/` are moved to "" once on load (`migrateTriggers`, `quickCommands.triggerVersion: 2`). A trigger the user chose themselves (e.g. `;`) is kept.
- **`@@` dates and notes:**
  - Dates (today, tomorrow, yesterday, next weekday, in a week or two, or a typed `YYYY-MM-DD`) insert a link to that day's daily note, `[[2026-10-07]]`, using the daily-note format.
  - On a task line they insert the Tasks-format due date `📅 2026-10-07` instead.
  - Note names insert `[[Note]]`.
  - `@@` (not `@`) so email addresses and @-handles never open it.
- **`((` blocks across the vault:**
  - It searches the index for notes, then their paragraphs and list items (all words must match), and inserts the Obsidian-compatible `[[Note#^id]]`.
  - A block without an id gets one: in this note within the same edit; in another note with a fresh read and a conflict-checked write, as `[[Note#^` already did.
  - The block being typed in is never offered.
- **`::` inline properties:**
  - It works at the start of a line or list item and suggests keys already used in the vault (new Rust command `list_property_keys`, most used first). It inserts `key:: `.
  - The indexer now reads Dataview-style `key:: value` lines into a note's properties (frontmatter wins on a clash; code fences are skipped), so `prop:status=done` finds them too. `SCHEMA_VERSION` 3 makes existing indexes rebuild once. The index stays rebuildable from the files, and notes are not rewritten.
- **`:` emoji:** unchanged.
- **`$$` math:**
  - `$$…$$` renders with KaTeX when the cursor is elsewhere. It's display math on its own line(s) and inline math inside a sentence; code is skipped, and `\$$` is literal.
  - Typing the second `$` adds the closing `$$`.
  - KaTeX and its fonts are a lazy chunk (≈259 kB JS + 29 kB CSS), loaded on first use.
  - The dependency is pinned to the same version Mermaid already brings (0.16.x), so there's one copy.
- **`{{` template variables:** inside the templates folder it inserts the variable (`{{date}}`, `{{title}}`, `{{cursor}}`, `{{prompt:…}}`). In an ordinary note it inserts the value (today's date, the title) straight away.
- **All triggers are remappable** in Settings → Commands, and an empty field turns one off. Everything they write is plain Markdown that Obsidian and other editors read.
- **Menus are themed:** autocomplete popups now use the theme variables. They were CodeMirror's light default, which was unreadable in dark mode.

| Package | Version | License | Purpose                                               |
| ------- | ------- | ------- | ----------------------------------------------------- |
| katex   | 0.16.47 | MIT     | `$$` math rendering (lazy chunk, shared with Mermaid) |

## 2026-09-28: Zoom, text size, fonts and editor width (T-040)

- **Zoom for the whole app:**
  - Ctrl + = / Ctrl + − / Ctrl + 0 are "Zoom in", "Zoom out" and "Reset zoom" in the command list, so they can be remapped.
  - Ctrl + mouse wheel and the number-pad + also zoom, and so do the controls in Settings → Appearance.
  - Steps run from 50 % to 300 %.
  - The desktop app zooms the webview itself (`setZoom`, with the `core:webview:allow-set-webview-zoom` permission), so pointer positions on the canvas stay right. The browser preview uses CSS `zoom`.
  - Zoom is a per-device preference, kept in local storage (`axisnotes.zoom`).
  - Inside the canvas and the graph, which have their own zoom, the keys and wheel are left to them.
  - On the welcome screen, where command shortcuts aren't active, `installZoom` handles Ctrl + = / − / 0 itself (T-041).
- **Settings → Appearance** also has these, saved in the vault's config as `appearance: { noteFontSize, noteFont, uiFont, editorWidth }` and applied as CSS variables (`--note-font-size`, `--font-note`, `--font-ui`, `--editor-width`):
  - **Note text size:** 11–32 px, default 15. Headings grow with it.
  - **Note font** and **interface font:** any installed family, or the default. A font chosen on another computer stays selected, marked "(not installed)".
  - **Editor width:** narrow 640 px, medium 760 px (the default), wide 960 px, or full width.
- **Installed fonts** come from the `list_fonts` command, which uses `fontdb` to read the system font folders once and caches the result (0.14 s here). `fontdb` is pure Rust with no system libraries.
- The 5,000-note speed test now waits for background indexing (T-039) to finish before timing searches (6–51 ms). The 100 ms target applies to an indexed vault.

| Package (Rust) | Version | License                                                                              | Purpose                     |
| -------------- | ------- | ------------------------------------------------------------------------------------ | --------------------------- |
| fontdb         | 0.24    | MIT                                                                                  | Installed font families     |
| memmap2        | 0.9     | MIT OR Apache-2.0                                                                    | (fontdb) reading font files |
| slotmap        | 1.1     | **Zlib**, flagged: permissive, no copyleft; attribution in source distributions only | (fontdb) face storage       |
| tinyvec        | 1.13    | Zlib OR Apache-2.0 OR MIT                                                            | (fontdb) small vectors      |

## 2026-09-28: Big and messy folders open reliably (T-039)

- **The bug:** large real-world folders failed to open or froze the app. Reproduced with 20,000 notes, 40,000 files in `node_modules`, a 50 MB binary, a looping folder link, a broken folder link and a locked folder:
  - **One unreadable item failed the whole vault.** A broken link or a folder without permission made listing the tree fail with "cannot find the file specified".
  - **A folder link back up the tree looped** until the path grew too long, so opening hung for minutes.
  - **Opening waited for the index**, 24 s for 20,000 new notes, with nothing on screen.
- **Walking a vault (`vault::Walk`)**, shared by the file tree and the indexer:
  - It never fails: unreadable folders show as empty, and broken or unreadable items are skipped.
  - Folder links (Windows junctions, symlinks) are followed, so a vault can link to a shared folder elsewhere. A link is skipped when it points at a folder the walk is already inside (a loop) or at a target already followed through another link.
  - Only links are resolved to their real location, because resolving every folder cost seconds on Windows.
- **Opening no longer waits for the index:**
  - `Index::open_unsynced` opens the database at once, and a background thread with its own connection runs `sync_with_progress`, committing every 500 notes.
  - The database uses WAL with a 10 s busy timeout, so searches keep working meanwhile.
  - Progress goes out on `index://progress` and shows in the status bar ("Indexing notes… 4,000 of 20,000"). The note list refreshes when it finishes.
  - Opening another vault stops the old sync (a generation counter).
- **Measured on the test folder** (release build):
  - Tree: 0.31 s (6.4 MB).
  - First full index: 5.6 s, in the background.
  - Reopen with nothing changed: 0.3 s.
  - Previously: the tree failed, the index took 24 s in the foreground, and the loop hung.
- **Still open:**
  - Every external change reloads the whole tree (0.3 s at this size).
  - A single expanded folder with tens of thousands of files renders every row (the tree isn't virtualized).

## 2026-09-27: Renamed to AXISNotes (T-038)

- **Naming:** AXIS is the company, and this app is its product **AXISNotes**, written as one word with no space, like Microsoft and Microsoft Word.
  - User-facing text says AXISNotes: the window title, installer, Start menu, welcome screen, About ("AXISNotes by AXIS"), the extension (the "AXISNotes Web Clipper") and error messages.
  - The installer publisher is AXIS.
- **Internal names changed too, at the user's request, each with a migration so nothing is lost:**
  - **Bundle identifier:** `app.axis.desktop` → `app.axis.axisnotes`. The OS folders named after it hold AI settings, paired browsers, the request log and the webview's storage (recent vaults). `migrate::legacy_app_dirs` copies each old folder to its new name on startup, before any window opens, and only when the new folder doesn't exist yet. The old folders stay behind as a backup.
  - **Vault folder:** `.axis/` → `.axisnotes/`. `Vault::open` renames an existing `.axis/` when there's no `.axisnotes/` yet. Temporary files are now `.axisnotes-tmp`.
  - **Keychain service:** `AXIS` → `AXISNotes`. A key missing under the new name is looked up under the old one, moved across and deleted from the old entry. Deleting a key removes both.
  - **Program:** `axis.exe` → `axisnotes.exe` (the Cargo package `axisnotes`, library `axisnotes_lib`). The npm package is `axisnotes`.
- **Not renamed:**
  - The `.axgrid` and `.axcanvas` file extensions and the `axis:` link scheme inside canvas files. They're content formats in users' files, and "ax" works as the AXIS family prefix.
  - The test-only environment variables (`AXIS_OPEN_VAULT`, `AXIS_CLIPPER_PORT`, …) and the `axis.*` local-storage keys, which users never see.
- The build spec and older entries below still say "AXIS" and `.axis/`, which were correct when they were written.

## 2026-09-27: Phase 6 web clipper, import, polish and installers (T-030 – T-036)

- **Process change:** the user dropped Codex. Claude builds and verifies every task, and the cross-review rule in `AGENTS.md` no longer applies.

### Web clipper endpoint (T-030)

- **A tiny HTTP server on `127.0.0.1:38417`** (`tiny_http`, in its own thread), started with the app and switchable off in Settings → Web clipper. It is localhost only and never reachable from the network. `AXIS_CLIPPER_PORT` overrides the port (E2E).
- **Pairing, not open access:**
  - The app shows a 6-digit code. It is valid for 5 minutes and dies after 5 wrong tries.
  - The extension trades the code for a 256-bit random token.
  - Only the token's SHA-256 is stored, in `clipper.json` in the app config folder (not the vault).
  - Paired browsers are listed and can be revoked.
- **Web pages are refused:** any request with an `http(s)://` (or `null`) `Origin` gets a 403. Websites therefore can't pair or clip even though the endpoint is on localhost. The extension's requests carry an extension origin.
- **Clips become notes** in `Clippings/` (configurable):
  - Frontmatter: `source`, `clipped` (UTC), `clip` kind, `tags: [clipping, …]`.
  - Pages carry the extension's Markdown, selections become a blockquote with a link, links are a single Markdown link.
  - Screenshots go to `Clippings/attachments/*.png`, embedded with `![[…]]`.
  - Titles become safe file names, and a clash gets " 2", " 3" and so on.
  - A clip `id` is remembered (the last 500), so a retried delivery from the offline queue isn't saved twice.
  - With no vault open, the endpoint answers 503 and the extension keeps the clip.
- **Image embeds**: `![[photo.png]]` (with Obsidian's `|width`) renders in notes. Bare names resolve like Obsidian: the note's folder, then anywhere. Image files open in an image view instead of the text editor.
  - The images are served through Tauri's **asset protocol**. Its scope starts empty, and only the open vault's folder is allowed at runtime. The CSP allows `asset:` and `http://asset.localhost` for images only.

| Package (Rust)                                  | Version | License            | Purpose                    |
| ----------------------------------------------- | ------- | ------------------ | -------------------------- |
| tiny_http (+ ascii, chunked_transfer, httpdate) | 0.12    | MIT OR Apache-2.0  | Localhost clipper endpoint |
| base64                                          | 0.22    | MIT OR Apache-2.0  | Decode screenshots         |
| ring (direct; already used through rustls)      | 0.17    | Apache-2.0 AND ISC | Random tokens, SHA-256     |

### Browser extension (T-031)

- **One Manifest V3 extension for Chrome, Edge and Firefox** (`extension/`). It is plain JavaScript modules with no bundler. `pnpm build:extension` copies three vendored libraries and the icons in, and both are generated and gitignored. The background script is declared as both `service_worker` (Chromium) and `scripts` (Firefox 121+).
- **Clip kinds:**
  - **Page**: Mozilla Readability picks the article, and Turndown with the GFM plugin converts it to Markdown. Tables are kept, links and images are made absolute, and navigation and scripts are dropped.
  - **Selection** and **Link**: through the popup or the right-click menu.
  - **Screenshot**: `captureVisibleTab` of the visible tab.
  - Extraction runs in the page through `scripting.executeScript` with `activeTab`, so there are no always-on content scripts and no broad host access. The only host permission is `http://127.0.0.1/*`. Firefox asks for it when you pair.
- **Offline queue**: a clip that can't be delivered goes into `storage.local`. That happens when AXIS is closed, when no vault is open (503), or when the browser isn't paired yet. The queue holds up to 200 clips, with `unlimitedStorage` for screenshots. It is retried every minute, at browser start, after pairing, and from the popup's "Send now". Clips carry ids, so AXIS drops duplicates. Clips AXIS rejects as invalid are dropped, with the error shown.
- **The popup** shows the state (not running / not paired / no vault / connected), the pairing form, the queue count and a port setting.

| Package (dev; vendored into the extension) | Version | License    | Purpose               |
| ------------------------------------------ | ------- | ---------- | --------------------- |
| @mozilla/readability                       | 0.6.0   | Apache-2.0 | Find a page's article |
| turndown                                   | 7.2.4   | MIT        | HTML → Markdown       |
| turndown-plugin-gfm                        | 1.0.2   | MIT        | Tables, strikethrough |

### Obsidian import (T-032)

- **Copy, don't convert.** AXIS's Markdown is Obsidian's: wikilinks, embeds, block ids, nested tags, frontmatter and callouts. Notes and attachments are copied byte for byte into a folder of the vault (by default named after the Obsidian vault), or into the root. `[[Folder/Note]]` links keep working inside a subfolder because path links resolve by suffix.
- **Skipped**: `.obsidian/`, `.trash/`, dotfiles and `node_modules`. **Never overwritten**: a file that already exists is skipped and listed in the report. Importing a folder into itself (or the vault into itself) is refused. After a large import the index is rescanned, instead of relying on thousands of watcher events.
- **JSON Canvas → AXIS canvas**:
  - Note nodes become live note cards (`axis:` embeddables).
  - Text and link nodes become rounded cards with the text bound inside (as in Obsidian); links keep the URL as the card's link.
  - Groups become dashed frames with their label; other file nodes become a frame with `![[file]]`.
  - Edges become arrows from the named sides, with their labels, bound to both ends so they follow the cards (T-036).
- **Settings carried over (on request)**: the templates folder and daily-note folder, format and template from `.obsidian/templates.json` and `daily-notes.json`. The Moment.js date tokens Obsidian uses by default are the same in AXIS.
- **Obsidian syntax is now styled** in the editor: `==highlight==` (markers hidden off the active line), `%%comments%%` (dimmed) and `> [!type]` callouts (coloured by kind: note / tip / warning / question / quote).
- You can also open an Obsidian vault directly as an AXIS vault. Import is for merging one into an existing vault.

### Onboarding and settings polish (T-033)

- **The welcome screen** lists recent vaults (per device, in local storage) and reopens the last one on launch, which can be switched off. It says that Obsidian vaults open as they are. **Create new vault** can add example notes: a "Start here" guide that links to task and diagram examples, plus a meeting template. They are ordinary notes.
- **Getting started** is a checklist shown once for a newly created vault, and from the palette any time. It covers the guide, AI setup, web clipper pairing, Obsidian import and personalisation, each showing whether it's done where that's known (AI providers, paired browsers), plus the key shortcuts.
- **Keyboard shortcuts are remappable** (Settings → Keyboard shortcuts): click a command and press the new keys. They are stored in `.axis/config.json` as `hotkeys: { "<command id>": "Ctrl+Shift+K" | "" }`, and `""` removes a shortcut. A shortcut belongs to one command, so assigning or resetting takes it from whichever command had it. The palette shows the shortcuts in effect.
- **Settings → About** shows the version (from `package.json`, injected at build), where each kind of data lives, and the open-source credits.

### Performance pass (T-034)

- **Code splitting**: views and dialogs that aren't needed for the first paint load on demand with `React.lazy` (`app/lazy.ts` `lazyNamed` covers named exports). That includes grids, canvases (Excalidraw), graph views (sigma/graphology), tasks, the time report, settings, the AI dialogs, import and getting started. Before, the entry chunk was 1,118 KB; now it is 640 KB (215 KB gzipped). Lazy dialogs render inside `<Suspense fallback={null}>`, so tests wait for them with `findBy…`.
- **Formula functions** (formulajs) load on demand (`lib/formula/functions.ts`). Until they arrive, a formula that calls a function evaluates to `#BUSY!`. The properties panel re-renders when they load, and opening a grid starts the load alongside the grid chunk. Test setup preloads them.
- **Spellcheck**: the nspell engine lives in `spellcheck/hunspell.ts`, which only the worker imports, so the dictionary and nspell stay out of the main bundle.
- Search latency was already covered in Phase 1 (under 100 ms on 5,000 notes). The index and watcher paths were unchanged.

### Installers (T-035)

- **Targets**: Windows `.msi` (WiX) and `.exe` (NSIS), macOS `.dmg` (Apple Silicon and Intel builds), and a Linux AppImage. They are built by `.github/workflows/release.yml` using `tauri-apps/tauri-action` (MIT/Apache-2.0, CI only) when a `v*` tag is pushed or the workflow is started by hand, and attached to a draft release. The AppImage is built on Ubuntu 22.04 so it runs on older glibc versions.
- **Not code-signed yet.** Windows SmartScreen and macOS Gatekeeper will warn. Signing needs certificates, which means an Apple Developer account and a Windows code-signing certificate. That's the user's call; tauri-action picks up the signing secrets once they exist.
- **The browser extension ships inside the app.** `pnpm build:extension` also writes a clean `dist-extension/` (no tests), and `tauri build` runs it first (`beforeBuildCommand`). The bundle includes it as the `extension/` resource. Settings → Web clipper → **Open extension folder** opens it in the file manager for "Load unpacked". Development builds fall back to the source `extension/` folder. `build.rs` creates an empty `dist-extension/` so plain `cargo` builds still work. Publishing to the Chrome Web Store or Firefox Add-ons would need developer accounts, so it's left for later.
- **App icon**: a new AXIS mark (`src-tauri/icons/app-icon.svg`, generated with `tauri icon`) replaces the Tauri placeholder. It is also used for the extension. Version 0.1.0 is now the same in `package.json`, `Cargo.toml` and `tauri.conf.json`.
- **The AXIS logo (T-037)** is the user's own design: three rounded strokes in red, blue and green that form a triangle. The master is `src/assets/logo.svg`, cleaned of its embedded content-credential metadata and white background square. The app uses it on the welcome screen, in Settings → About and as the window favicon. The desktop icons are generated from it with `pnpm tauri icon src/assets/logo.svg`, and the extension's icons follow via `pnpm build:extension`.
- **New main logo (T-078)**: the user's pearl three-point mark (solid, white to cool grey gradient, transparent background) replaces the T-037 mark in `src/assets/logo.svg`, the desktop icons and the extension icons, with the same `tauri icon` pipeline. Being near-white, it gets a soft drop shadow in the app so it stays visible on light themes; on a light taskbar or Start menu the icon itself is faint.

### Phase 6 E2E and polish (T-036)

- **`e2e/specs/phase6.e2e.ts`** runs against the real app:
  - An image embed and an image opened on its own.
  - Obsidian import from a seeded sibling vault. The folder picker is native, so the spec calls the same `inspect_import` / `import_obsidian` commands, then checks the result in the UI: highlight and callout styling, and the converted canvas.
  - The web clipper, driven by the extension's own `extension/lib/queue.js` from Node: a clip queued while AXIS can't be reached, pairing with the code shown in Settings, then flushing, de-duplicating a resend, and a screenshot clip whose image renders.
  - Getting started, after the browser is paired.
  - A remapped shortcut, saved to `.axis/config.json` and then used.
  - E2E runs use their own clipper port (`AXIS_CLIPPER_PORT=38499`).
- **Fixes found along the way:**
  - Dialogs ignored Escape once their focused control disappeared, for example after pairing finishes. Escape pressed on the page is now passed to the open dialog, which applies its own rules (e.g. not while busy).
  - Spellcheck could flag words in code blocks that the background parser hadn't reached yet. It now parses the visible range first and checks again when parsing finishes.
  - Image files have their own icon in the file tree.
  - A Mermaid test now loads Mermaid in `beforeAll`, and an E2E selector is scoped to the main view after the lazy loading from T-034.

## 2026-09-27: Phase 5 AI features (T-025 – T-029)

### Spellcheck (T-025)

- **Hunspell in a Web Worker.** `nspell` (a pure-JS Hunspell) with the SCOWL `en_US` dictionary from `dictionary-en`. Both are bundled as assets, so spellcheck works offline. The worker loads the ~550 KB dictionary on first use and answers `check` and `suggest` calls, so typing never waits on it. Why not Rust (`spellbook`/`zspell`)? Those are MPL-2.0, and the check runs right next to the editor anyway.
- **Only prose is checked.** The check skips code, links and wikilinks, tags, URLs, emails, block ids, math, template variables, frontmatter, CamelCase and ACRONYMS, and words glued to digits. Syntax-tree nodes are skipped as well as regex spans. Only the visible range is checked, with results cached per word. The word being typed is not flagged.
- **Suggestions put adjacent-letter swaps first** ("teh" → "the"). nspell's own suggester often misses transpositions, which are the most common typing error. Found by the Phase 5 E2E (T-029).
- **Quick fixes**: right-click an underlined word (or press Ctrl+.) to see up to 6 suggestions, "Add to dictionary" and "Ignore" (for the session).
- **The personal dictionary is per vault**, in `.axis/config.json` under `spellcheck.words`, so it travels with the notes. Spellcheck can be turned off in Settings → Spelling.
- **Deviation:** only English (US) ships. Other `dictionary-*` packages can be added the same way.

| Package             | Version | License     | Purpose                    |
| ------------------- | ------- | ----------- | -------------------------- |
| nspell              | 2.1.5   | MIT         | Hunspell-compatible engine |
| dictionary-en       | 4.0.0   | MIT AND BSD | en_US Hunspell dictionary  |
| @types/nspell (dev) | 2.1.6   | MIT         | Types                      |

### Fix grammar and clarity (T-026)

- **Plain-text reply, reviewed as a word diff.** The text-fix model returns only the corrected text (it streams, and small models handle this better than JSON). AXIS diffs it against the original: lines first, then the words of changed lines, using LCS with prefix/suffix trimming and a size cap. Each change can be clicked to keep the original before applying. Nothing is written until the user applies.
- **Scope**: the selection, or the note's body without its frontmatter. The prompt says to keep Markdown constructs (links, wikilinks, tags, block ids, code, math) exactly as they are.
- **Applying is safe**: the change goes straight into the editor only if the original range is unchanged. Otherwise the original text is replaced only if it appears exactly once in the note. If neither holds, nothing is written and the user can copy the result.
- **Shortcut Ctrl+Shift+G**, not Ctrl+Shift+J: WebView2 and Chromium use Ctrl+Shift+J to open DevTools.
- **Shared AI helpers** (`src/features/ai/runAi.ts`, `src/lib/aiJson.ts`):
  - `runAi` makes a cancellable request.
  - `askValidated` parses and validates the answer. If it is invalid, it asks **once more**, quoting the problems, then gives up with a clear error.
  - The JSON extraction tolerates code fences and preamble.
  - A small hand-written schema checker produces model-readable messages (e.g. `$.nodes[0].id is missing`). No new dependency.
- The in-memory backend gained `setAiResponder` for scripted answers in tests.

### Handwriting to text (T-027)

- **One vision request, one JSON answer.** The strokes are rendered to a PNG, cropped to the ink with a margin and capped at 1600 px. They go to the model set for the **handwriting** task in JSON mode, and the answer is `{text, uncertain: [{word, occurrence, alternatives, reason: "unclear" | "misspelled"}]}`. Why JSON rather than inline markers: `[[…]]`-style markers collide with Markdown, and every provider supports a JSON mode or a JSON instruction. The answer is validated. If it is invalid, AXIS asks once more, quoting the problems (`askValidated`).
- **Two sources of flags.** The model flags words it couldn't read (dotted underline) or that the writer misspelled (wavy). The local Hunspell spellchecker then flags any other word it doesn't know (wavy). Each flag's quick-fix menu offers the alternatives, "Keep", or a typed correction. Nothing is inserted until the user clicks Insert.
- **Where it runs:**
  - **Canvas**: "Convert to text" reads the selected elements, or every pen stroke if nothing is selected. It uses Excalidraw's `exportToBlob` on a white background and adds an Excalidraw text element under the strokes, or in their place if "Remove the handwriting" is ticked.
  - **Notes**: the `/handwriting` command or the palette opens a pen/touch/mouse pad (Pointer Events with pressure and coalesced events). The text is inserted at the cursor.
- **Privacy**: the canvas or note path is sent as the request's `source`, so "AI: never" and "local only" folders apply to handwriting too. Non-vision models are skipped (T-021's capability check).
- **Acceptance evidence**: `handwriting_reads_an_image_on_two_vision_providers` (Rust) runs the same image request through recorded OpenAI Responses and Anthropic Messages answers. It checks the image and JSON mode in each request body and parses both answers.
- **Browser preview**: `pnpm dev` answers AI requests with canned demo text (`src/ipc/demoAi.ts`), so the flows can be clicked through without a provider. The desktop app never uses it.

### Smart diagram maker (T-028)

- **Mermaid 11.17.2, not 12.** Mermaid 12 added a direct dependency on `elkjs`, which is EPL-2.0 OR GPL-3.0. Version 11.17.2 has no elkjs, and its whole tree is permissive: MIT, ISC, Apache-2.0, BSD, and `dompurify` (MPL-2.0 OR Apache-2.0, taken as Apache). Pin it until elkjs becomes optional again, and check the licenses before upgrading.
- **Mermaid is lazy-loaded** and runs with `securityLevel: "strict"`, so labels are sanitized and click callbacks are disabled. Rendering a note can't run code.
- **In notes, ` ```mermaid ` blocks render as diagrams** (a block widget from a StateField). Placing the cursor in the block, or clicking the diagram, shows the code for editing. Invalid code shows Mermaid's error in place of the diagram.
- **Two output formats, both validated, with one retry:**
  - **Notes → Mermaid code.** Checked with Mermaid's own parser (`mermaid.parse`). A parser error goes back to the model once.
  - **Canvases → a JSON graph** (`{kind, direction, nodes, edges}`). Checked with `GRAPH_SCHEMA` plus `checkGraph`: unique ids, edges that point at real nodes, and mind maps that are trees rooted at the first node. AXIS then lays the graph out itself: flowcharts in layers (longest-path ranks, one barycenter pass, back edges ignored) and mind maps as left-to-right trees. It turns the layout into Excalidraw skeletons (labelled shapes and bound arrows) through `convertToExcalidrawElements`. Why not ask the model for raw Excalidraw JSON? It is large and brittle, and models get coordinates wrong. A small graph is easy to validate and is laid out consistently.
- **Without AI** ("From notes"): a mind map from a note's headings and nested lists, or a flowchart of a note's links in both directions (from the vault graph). The result goes to Mermaid or to canvas shapes.
- **Entry points**: `/diagram` and the palette command "Make a diagram" (the selection becomes the description), `/mermaid` for a blank block, and a "Diagram" button on canvases. The note or canvas path is the request's source, so folder AI rules apply.

| Package | Version | License | Purpose                                    |
| ------- | ------- | ------- | ------------------------------------------ |
| mermaid | 11.17.2 | MIT     | Render and validate diagrams (lazy-loaded) |

## 2026-09-27: Phase 4 multi-provider AI layer (T-021 – T-024)

- **One `AiProvider` trait** (`complete`, `stream`, `vision`, `list_models`) with one implementation, `Adapter`, which drives a per-format **codec** over a **transport**.
  - Codecs: OpenAI Responses (used for OpenAI itself, with `store: false`), OpenAI-compatible Chat Completions (OpenRouter, Ollama, LM Studio, custom endpoints), Anthropic Messages, and Gemini `generateContent`.
  - Codecs are pure: they build a request and parse responses or SSE events. They are tested against recorded provider responses in `src-tauri/src/ai/fixtures/`, and the same prompt is checked through every format.
  - A live test runs only when `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `AXIS_OLLAMA_MODEL` are set.
- **Streaming everywhere.** The app always streams, so requests can be cancelled. Text deltas reach the UI as `ai://delta` Tauri events, and a small incremental SSE parser handles chunks split mid-line or mid-character.
- **Unsupported parameters degrade gracefully.**
  - Known limits are applied before sending (for example, no `temperature` for `gpt-6-astra`, including dated snapshots, through prefix matching in the registry).
  - If a provider still rejects a parameter (found from `error.param` or a known name in the message), the adapter drops it and retries once, then reports a clear error. A retry never happens after text has streamed.
- **Reasoning effort:** Quick / Balanced / Deep maps to OpenAI `reasoning.effort` low/medium/high, Anthropic extended thinking (none / 4k / 16k budget, with `max_tokens` raised to match and `temperature` omitted), and Gemini `thinkingBudget` (0 / dynamic / 16k).
- **Model registry `ai-models.json`:**
  - It holds the spec's defaults per task (OpenAI `gpt-6-astra`/`sol`/`luna`, Anthropic Opus 5.5 / Sonnet 5 / Haiku 4.5), capability flags and prices.
  - It is bundled, and a copy is written to the app config folder on first run so the user can edit it. The user's copy overlays the bundled one.
  - Live model lists are fetched from each provider and enriched with these flags, falling back to name hints for vision (`vl:`, `llava`, ...). Gemini's defaults are always picked from the live list (newest non-preview pro / flash / flash-lite).
- **Keys:** OS keychain via `keyring` (service `AXIS`, entry `ai-provider:<id>`).
  - Commands can set, delete, or report whether a key exists; nothing returns a key to the webview.
  - Keys are not stored in settings files or logs, and removing a provider deletes its key.
- **Settings are per user, not per vault** (`ai-settings.json` in the app config folder), because vaults can be shared. They hold providers, the provider and model per task, the fallback order, the token cap (requests above it are refused), the confirmation threshold (default 4,000 estimated input tokens), the default effort, and a switch for the request log.
- **Fallback:** the task's provider is tried first, then the fallback order, using each provider's default model for the task. The chain moves on only for network errors, 5xx, 429 and auth failures, never for a rejected request. The result says which provider answered.
- **Privacy rules are per vault** in `.axis/config.json` (`ai.folders: { "Medical": "never", "Journal": "local" }`), and the most specific path wins.
  - A request is held to the strictest rule of every note it involves: notes the UI declares as sources, plus notes Rust reads itself (`attach`).
  - "never" is refused before any provider is contacted, even when a provider is named explicitly. "local" only reaches providers whose endpoint is on this machine (localhost, 127.x, ::1). A LAN IP doesn't count.
- **Request log:** JSON lines in the app data folder (`ai-requests.jsonl`, trimmed past ~1 MB). It records time, task, provider, model, local flag, status (ok / error / cancelled / blocked), token counts, duration and the number of source notes. It never records prompts, answers or paths.
- **Token estimate:** about 4 characters per token plus 1,000 per image. It is shown before sending, together with the input cost when the model's price is known.
- **E2E isolation:** `AXIS_CONFIG_DIR` points settings, registry and log at a throwaway folder, and `AXIS_AI_MEMORY_KEYS` keeps keys in memory, so tests never touch the user's settings or keychain.
- **E2E (`ai.e2e.ts`):** the spec starts a mock OpenAI-compatible server on 127.0.0.1 and configures it through Settings → AI in the real app. It checks:
  - A streamed answer about a note, with the note's text arriving at the server and the key only in the `Authorization` header.
  - The key is absent from `ai_settings` (called straight from the webview) and from the settings file.
  - An "AI: never" note is refused before any request, both from the UI and from a direct `ai_run` call in the webview.
  - The request log holds metadata only.

| Crate         | Version | License           | Purpose                                                |
| ------------- | ------- | ----------------- | ------------------------------------------------------ |
| reqwest       | 0.13    | MIT OR Apache-2.0 | HTTPS client (rustls + OS certificate store, no CMake) |
| rustls (ring) | 0.23    | MIT OR Apache-2.0 | TLS crypto provider                                    |
| keyring       | 3.6     | MIT OR Apache-2.0 | OS keychain for API keys                               |
| tokio (dev)   | 1       | MIT               | Async tests                                            |

## 2026-09-26: Phase 3 grids, canvases and structured data (T-016 – T-019)

- **Formula engine: our own parser and evaluator plus `@formulajs/formulajs` (MIT) for the function library.** HyperFormula is GPLv3 or commercial, so it is ruled out. The parser is a small Pratt parser with Excel precedence (comparison < `&` < `+ -` < `* /` < `^` < unary/percent, with `^` right-associative). It handles A1 refs with `$`, ranges, dotted function names and bare names (for computed properties). Evaluation uses Excel error values (`#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#N/A`, `#NUM!`, `#CIRC!`, `#ERROR!`). `IF` is lazy, and `IFERROR`/`IFNA`/`IS*` are native because formula.js only recognizes its own error objects. Everything else is looked up in formula.js.
- **`.axgrid` format**: `{ version: 1, rows, cols, cells: { "A1": raw }, widths: { "A": px }, formats: { "A1": { bold, align } } }`. `raw` is exactly what the user typed (a formula starts with `=`). Computed values are **never stored**, so the file is the single source of truth. Cells are serialized in row-major order so diffs stay stable. Parsing is lenient, and a file that fails to parse opens **read-only and is never autosaved**, so it can't be clobbered.
- **Recalculation** evaluates the whole sheet each time, with memoization and cycle detection (`#CIRC!`). That is instant at note-sized sheets. A dependency graph can come later if large grids need it.
- **Structural edits shift formulas like Excel**: inserting rows or columns moves the references behind them, and references into a deleted span become `#REF!`. Copy/paste within AXIS carries the raw cells (a custom clipboard type) and offsets relative references, while `$` parts stay put. Everything else is plain TSV (values), for Excel and Sheets interop.
- **Grid UI** is a hand-rolled, row-virtualized DOM grid with sticky headers: no grid dependency, and it follows the app's theme tokens.
  - Keyboard follows Google Sheets: typing replaces the cell, Enter/F2 edit, Enter/Tab commit and move, and arrows commit a quick edit.
  - Undo/redo keeps whole-sheet snapshots (200).
  - Load, autosave and conflict handling are shared with future file-backed views through `useFileDocument`, which uses the same rules as the Markdown editor.
- **Search covers grids**: the Rust index gives `.axgrid` files a row whose FTS body is their non-formula cell text and whose title is the file stem. Grids have no links or tags, can be linked as `[[Budget.axgrid]]`, keep incoming links on rename, and are excluded as unlinked-mention sources.
- **Canvas = Excalidraw (MIT), embedded and lazy-loaded.** `.axcanvas` is Excalidraw's own JSON scene (`type: "excalidraw"`, `version: 2`, `source: "axis"`), so files open in Excalidraw too.
  - Only scene settings are persisted (background color and grid settings). Zoom, scroll and selection stay per-session. Deleted elements and unused image files are dropped on save.
  - Images are embedded as data URLs (Excalidraw's standard). Moving them to vault attachments is a later optimization.
- **Note cards are Excalidraw "embeddable" elements with `link: "axis:<path>"`.** `renderEmbeddable` draws them as live previews that re-read the note when it changes, and `onLinkOpen` opens the note.
  - Add cards from a picker or by dragging a note from the file tree (the tree sets an `application/x-axis-path` drag type).
  - When a note or folder is renamed, the Rust rename rewrites exact `"link": "axis:<old>"` JSON strings in every canvas, leaving the rest of the file byte-for-byte unchanged. Canvas text elements are indexed for search.
- **Pen input and grid snapping come from Excalidraw**: the freedraw tool with pressure, automatic pen mode, and grid mode (Ctrl+'), whose on/off state and size are saved in the file.
- **Offline fonts:** Excalidraw normally fetches fonts from a CDN. A small Vite plugin serves `node_modules/@excalidraw/excalidraw/dist/prod/fonts` at `/excalidraw-assets/fonts/` in dev and copies it into the build. `window.EXCALIDRAW_ASSET_PATH` points there. The fonts add about 14 MB to the installer, most of it the CJK font Xiaolai.
- **Change detection:** Excalidraw's `onChange` also fires for view-only updates, so a change counts only when the scene version, files or saved settings change. The scene is saved only if the serialized result differs from what is on disk, so opening a canvas never rewrites it. An outside edit remounts the editor with the new scene.
- **Tasks use the Obsidian Tasks emoji format.** Due dates are written `📅 YYYY-MM-DD` (the easier-to-type `due:YYYY-MM-DD` also works), and priority is `⏫`/`🔼`/`🔽` (plus `🔺`/`⏬`). Existing Obsidian vaults therefore work as they are, and `/` commands insert the markers.
  - The Rust index keeps a `tasks` table (index schema v2, rebuilt automatically) with the file line, raw line, clean text, done state, due date and priority. Code blocks and frontmatter are skipped.
  - The TS parser in `src/lib/tasks.ts` mirrors it, sharing test cases, for the in-memory backend and for edits.
  - Completing a task stamps `✅ <today>` and reopening removes it, the same convention as the Tasks plugin.
- **Edits from outside the editor go through `editNote`.** If the note is open, the change is applied through CodeMirror, so it autosaves and can be undone. Otherwise the note is read, edited and written back with an mtime check (retried once). Task toggles only edit a line that still matches what was indexed; otherwise the list refreshes instead.
- **Time tracking lives in the note:** `time_log: [{ start, end?, task? }]` in the frontmatter. Stamps are local `YYYY-MM-DDTHH:mm:ss`.
  - Starting a timer writes an entry without `end`, and stopping fills it in. A timer therefore survives restarts: on vault load, the latest open entry is restored. Only one timer runs at a time; starting another stops the first.
  - Timers start from the note header or from a task (the entry gets the task text), and the status bar shows the running clock.
  - The Rust index serves every entry with its note's tags and `project` property (`time_entries`). The report groups by note, tag, project (the `project` property, else the top-level folder) or day, over preset or custom date ranges. Manual entries are added from the report.
- **Computed properties** are frontmatter strings starting with `=`, evaluated with the grid formula engine.
  - Other properties are referenced by name (case-insensitive), lists act as ranges (`=SUM(scores)`), and formulas can use other formulas (`#CIRC!` on cycles).
  - The properties panel has a Formula type that shows the live result. Structured values (maps, lists of maps such as `time_log`) are shown read-only instead of being flattened into text.
  - They are evaluated in the UI only; search operators (`prop:`) still see the raw expression.
- **E2E:** `structured.e2e.ts` runs against the real Tauri build. It covers the Phase 3 acceptance:
  - A grid with formulas saves, and reopening it shows the same values without rewriting the file.
  - A canvas holds a live note card (which follows edits made on disk) and a freehand stroke drawn with pointer actions. This confirms Excalidraw works under the app's CSP with self-hosted fonts.
  - It also covers the tasks view, computed properties and a timer round trip. Screenshots are saved to `.agents/qa/phase-3/`.
- **Fix:** link decorations now use the tree returned by `ensureSyntaxTree`. Before, `syntaxTree(state)` returned whatever was parsed when the state was created, so code and frontmatter detection flaked under load.

| Package                | Version | License | Purpose                          |
| ---------------------- | ------- | ------- | -------------------------------- |
| @formulajs/formulajs   | 4.6     | MIT     | Spreadsheet function library     |
| @excalidraw/excalidraw | 0.18    | MIT     | Canvas / whiteboard (lazy chunk) |

## 2026-09-26: Phase 2 outliner, block references, embeds and graph (T-012 – T-015)

- **Outliner on plain Markdown.** No separate data model: operations work on list items (with nested children) and heading sections found from the text. Tab / Shift-Tab indent under the previous sibling's content column or out to the parent's level (CommonMark-correct for `-` and `1.` lists); Alt+↑/↓ swap with siblings; list items and sections fold. "Outline view" (per-viewer preference) adds a fold gutter and drag handles; a drop re-indents to the target's level.
- **Blocks follow Obsidian:** `^id` at the end of a list item's own line (children included) or a paragraph's last line; an id on its own line refers to the block above. Headings are linked with `#Heading`, not ids. New ids are 6 random base-36 characters. `[[Note#^` completion lists paragraphs and list items and **adds the id to the target note** (fresh read + optimistic write) when missing. `^id` markers are hidden in live preview.
- **Embeds are editable in place.** `![[Note]]`, `![[Note#Heading]]` and `![[Note#^id]]` on their own line render as block widgets containing a mini CodeMirror editor. Saves are debounced (400 ms), and each save **re-reads the source and checks the block text still matches what was loaded**; if not, the embed reloads instead of overwriting. Embeds of the note you're editing are read-only (the outer autosave would otherwise race). Nested editors don't render embeds (no recursion).
- **Live preview shows raw Markdown only on the cursor's lines while the editor has focus**, so unfocused editors (including embeds) render fully.
- **Graph:** built in Rust with in-memory resolution identical to `Index::resolve` (5,000 notes in ~14 ms); unresolved targets become `?name` nodes. Rendered with sigma.js (WebGL) and ForceAtlas2 (synchronous up to 400 nodes, otherwise a web worker for 2.5 s), **lazy-loaded** through `graphLibs.ts` (also the seam tests mock, since jsdom has no WebGL). Hover fades non-neighbors; the open note is emphasized, not isolated. Hover labels use theme colors (sigma's default is a white box). Stale mounts are cancelled before creating a renderer.
- **Test robustness:** Testing Library's async timeout raised to 5 s and Vitest's test timeout to 20 s (busy machines); link decorations force a parse of the visible ranges so code/frontmatter detection doesn't depend on the parser's time budget.
- **E2E:** `blocks.e2e.ts` covers the Phase 2 acceptance (embed a single bullet and edit it in place; the source file changes), block completion, outliner keys, and the graph (clicking a node via the renderer's event, since WebGL nodes aren't DOM elements).

| Package                         | Version | License | Purpose                 |
| ------------------------------- | ------- | ------- | ----------------------- |
| sigma                           | 3.0     | MIT     | Graph rendering (WebGL) |
| graphology (+ graphology-types) | 0.26    | MIT     | Graph data structure    |
| graphology-layout-forceatlas2   | 0.10    | MIT     | Force layout (worker)   |

## 2026-09-26: Phase 1 editor, panels, commands and customization (T-007 – T-011)

- **Frontmatter is parsed as YAML inside the editor** (`@codemirror/lang-yaml`'s `yamlFrontmatter`), so Lezer no longer reads `---` blocks as setext headings. The block is folded behind a "Properties" chip unless the cursor is in it; the **properties panel** edits it with typed controls (text, number, checkbox, date, list). The editor document stays the single source of truth: panel edits become minimal document changes, and **only changed keys are rewritten**, so untouched values keep their YAML formatting (found by E2E: `aliases: [PA]` was being reflowed).
- **Wikilinks in live preview:** brackets and `target|` hidden off the cursor line; unresolved links styled as dashed; click follows (Ctrl/Cmd-click on the line being edited); missing notes are created at the vault root, like Obsidian. Jump targets (`#heading`, `#^block`, line) are **bound to the note they were requested for**, so a stale target can't be consumed by another editor.
- **Search / Tags / Files** share the left sidebar; **calendar + backlinks + unlinked mentions** the right. Panels re-query when the store's `indexVersion` is bumped (after the app's own saves, creates, renames, and watcher events). Linking an unlinked mention re-reads the file and verifies the text at the offsets before writing, with optimistic concurrency.
- **Commands:** one registry drives the palette (Ctrl+P) and global shortcuts (captured before the editor): Ctrl+O switcher, Ctrl+N new note, Ctrl+Shift+D daily note, Ctrl+Shift+F search, Ctrl+Alt+T insert template, Ctrl+, settings.
- **`/` and `:` quick commands** are CodeMirror completion sources configured through a facet; triggers, disabled built-ins and custom snippets live in `.axis/config.json` and update live. Emoji data (emojilib) is **lazy-loaded** (174 kB chunk, not in the startup bundle). The `:` trigger needs two letters, so `10:30` doesn't open it.
- **Templates:** built-ins plus notes in `Templates/`; variables `{{title}} {{date[:fmt]}} {{time[:fmt]}} {{prompt:Q}} {{cursor}}`; inserting merges the template's properties into the note. **Page styles** (`axis-style: lined | dotted | math-grid | cornell`) are CSS backgrounds on a 26 px line grid.
- **Daily notes:** folder, moment-style file-name format, template and open-on-startup are configurable; the calendar marks days with notes.
- **Customization:** theme = system / light / dark / a user theme (`.axis/themes/<name>.css`, overriding the CSS variables); CSS snippets from `.axis/snippets/`. Folder/note icons are a **curated Lucide set** (importing all icons would bloat the bundle) or any emoji, with colors; icon settings follow renames and are removed on trash.
- **Every Lucide icon (T-082).** The icon picker offers the whole Lucide set (~1,900 icons) in any colour (swatches plus a custom colour input). The set loads on demand as its own chunk (`src/features/icons/lucideAll.ts`, about 594 kB, 157 kB gzipped) the first time the picker or a non-curated icon needs it; the curated icons stay in the main bundle, which did not grow (700.30 → 699.63 kB). No new dependency: lucide-react 1.48 exports the `icons` namespace. Stored values remain `lucide:<Name>`; a name Lucide doesn't know falls back to the default file or folder icon.
- **Notion-style page icons and covers (T-083).** A note's page icon _is_ its custom icon in `.axisnotes/config.json` (`folderIcons`), so the file tree and the large icon above the title always match and follow renames. Icons can also be an image from the vault, stored as `image:<vault path>`. The cover lives in the note's frontmatter in the **Obsidian Banners plugin format** — `banner: "[[path/to/image.png]]"` (or a plain path) and `banner_y: 0–1` for the vertical focus — so covers survive moving between the two apps; AXISNotes adds `banner: gradient:<name>` (built-in gradients) and `banner: "#rrggbb"`. `banner` and `banner_y` are edited on the cover and hidden from the properties chip. Web (`http(s)`) covers are never fetched: the app stays offline and says so. Uploading copies one image into `attachments/` beside the note through a new Rust command (`import_image`: image extensions only, 25 MB cap, a free name, never overwrites, destination resolved inside the vault). Once the note is scrolled, the cover shrinks to a thin strip so it doesn't take editing space (the editor scrolls inside CodeMirror, so the header can't scroll away with the text). Known gaps: renaming an image doesn't update covers or image icons that point at it (they show "not found" / fall back), and the browser preview can only show SVG images.
- **Tabs (T-085), Obsidian style.** The main area has a row of tabs; each holds a note (or the graph, tasks or time report) and its own back/forward history. The model is pure functions in `src/app/tabs.ts`; the store keeps `tabs` and mirrors the active tab into `activePath`/`mainView`, so the ~30 existing callers didn't change. Opening replaces the active tab's note (pushing history) unless the tab is pinned or a new tab is asked for: Ctrl/Cmd+click or middle-click in the file tree, middle-click on a link (Ctrl+click on the line being edited already means "follow"), Ctrl+Enter in the quick switcher. Views (graph, tasks, time report) replace the note _in the same tab_, and "back to note" returns to it — unlike Obsidian, which opens them in their own tabs. **Only the active tab's view is mounted**: switching tabs flushes unsaved edits and remounts the editor, as switching notes did before; the cursor and scroll come back (remembered per note for the session), but undo history doesn't. That keeps memory flat with many tabs. Tabs are saved **per vault and device** in local storage (paths, views, pins and the active tab, not history), and on reopen tabs whose file is gone are dropped. Shortcuts follow Obsidian where free: Ctrl+T, Ctrl+W (not on pinned tabs), Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+1–8, Ctrl+9, Ctrl+Alt+← / →. "Reopen closed tab" has no default because Ctrl+Shift+T already opens Tasks. The side-panel buttons moved into the ends of the tab row, so note, graph, grid and canvas headers no longer pad for them.
- **Tab groups (T-087), Chrome style.** Tabs can be selected (Ctrl/Cmd+click toggles, Shift+click takes the range from the active tab) and gathered into groups with a name and one of Chrome's nine colours. Selecting doesn't open a tab, so the active tab is always part of the selection, and a plain click clears it. A group's tabs always sit together: every change goes through one tidy step that drops empty groups and gathers each group's tabs at its first tab. A group shows as a chip before its tabs — a coloured circle until it's named, then the name on a coloured pill — and clicking it collapses or expands the group; right-click edits the name and colour. A collapsed group never holds the active tab: collapsing it moves to the nearest tab outside (or a new tab), and opening a hidden tab any other way expands it; Ctrl+Tab and Ctrl+1–8 count only visible tabs. New tabs opened from a grouped tab join its group. Dropping a tab next to a grouped tab puts it in that group; dropping a group lands it before or after another group, never inside. Groups are saved with the tabs (name, colour, collapsed).
- **`.axis/config.json`** is merged over defaults (wrong-typed values ignored, unknown keys preserved) and saved on every settings change.
- **E2E:** each spec gets a fresh vault seeded by its file name (`vault`, `knowledge`, `perf`). The perf spec generates 5,000 notes. Specs save QA screenshots to `.agents/qa/phase-N/` (gitignored).
- **Measured in the real app (debug build, 5,000 notes):** searches 7–12 ms including IPC; quick-switcher filter ~96 ms including WebDriver typing; vault visible ~2.2 s after launch.

| Package               | Version | License | Purpose                                        |
| --------------------- | ------- | ------- | ---------------------------------------------- |
| @codemirror/lang-yaml | 6.1     | MIT     | Frontmatter parsing in the editor              |
| emojilib              | 4.0     | MIT     | `:` emoji picker and emoji icons (lazy-loaded) |

## 2026-09-26: Phase 1 index and search (T-006)

- **SQLite index in `.axis/index.db`** (rusqlite, bundled SQLite): tables `notes`, `links`, `tags`, `aliases` and an FTS5 table (`title`, `body`; `unicode61 remove_diacritics 2`). It is a cache: a schema-version mismatch or a corrupt file is dropped and rebuilt from the Markdown files. On open it re-indexes only files whose mtime changed.
- **Kept in step** by the commands (the app's own writes, creates, renames, trashes) and by the file watcher (changes from other programs) before the `vault://changed` event is emitted, so the UI always queries fresh data.
- **Link resolution follows Obsidian:** `[[Name]]` matches a note basename anywhere (case-insensitive); path segments narrow it; ties go to the same folder, then the shortest path; aliases (`aliases:` frontmatter) are the fallback. Resolution happens at query time, so creating a note instantly "fixes" dangling links.
- **Renames rewrite incoming links**, preserving `#heading`, `#^block`, `|alias` and `!` embeds, and keeping the author's style (bare name vs. path). Links that still resolve after the move (aliases; bare names after a folder move) are left alone; a path is used when a bare name would become ambiguous. Rewritten notes are announced as `modified` so open editors reload them.
- **Search language:** words (prefix match), `"phrases"`, `-exclude`, `tag:` / `#tag` (nested tags match children), `path:`, `file:`, `prop:key` and `prop:key=value` (works for list values). Ranked by BM25 with titles weighted 8×.
- **Measured (release, 5,000 notes):** queries 0.4–5.7 ms; backlinks 0.25 ms; full initial index 1.1 s.
- Unlinked mentions return UTF-16 offsets so the UI can edit the file with JS string indices.
- `rust-version` raised to 1.85 (from the template's 1.77) so current crates resolve.

| Package                   | Version | License                     | Purpose                                              |
| ------------------------- | ------- | --------------------------- | ---------------------------------------------------- |
| rusqlite (bundled SQLite) | 0.40    | MIT (SQLite: public domain) | Index + FTS5                                         |
| yaml-rust2                | 0.13    | MIT OR Apache-2.0           | Frontmatter in the indexer                           |
| yaml (npm)                | 2.9     | ISC                         | Frontmatter editing in the UI (keeps comments/order) |

## 2026-09-26: Phase 0 integration and E2E (T-005)

- **E2E tests drive the real desktop build** through `tauri-driver` + WebdriverIO (`pnpm e2e:build && pnpm e2e`) against a throwaway vault on disk. Windows needs `msedgedriver` matching the installed WebView2 (put it in `~/.axis-e2e/msedgedriver-<version>/` or set `AXIS_MSEDGEDRIVER`); Linux CI uses `webkit2gtk-driver` under Xvfb. `tauri-driver` has no macOS support.
- **`AXIS_OPEN_VAULT=<folder>`** opens that folder as the vault at startup. Added because WebDriver can't operate the native folder picker; also handy for scripting.
- **Watcher: self-write suppression is mtime-based for file writes.** After our own write, events for that file are ignored only while its mtime is still the one we produced. Before, any event within 2 s of our save was dropped, so an edit by another program right after an autosave was silently missed (found by E2E).
- **Watcher: renames and removes are classified by outcome.** A rename _onto_ a path, and a "remove" of a path that exists again when the debounced batch is processed, are reported as `modified`. Windows reports an atomic replace (temp file renamed over the note � how VS Code, Vim and AXIS itself save) as remove + create. Before, this showed a false "moved or deleted" banner. Only a rename between two visible paths is `renamed` `[from, to]`, and the editor only treats it as a move when this note is `from`.
- WebdriverIO packages (`@wdio/cli`, `local-runner`, `mocha-framework`, `spec-reporter`, `globals`, `webdriverio` 9.32): **MIT**. Their optional install scripts (browser-driver downloads) are left disabled by pnpm; they aren't needed.
- Measured: typing in a 1 MB note costs ~14 ms per keystroke including WebDriver overhead.

## 2026-09-26: Phase 0 foundation (T-001)

### Architecture

- **The UI depends on a `Backend` interface (`src/ipc/types.ts`), not on `invoke`.** There are two implementations: `tauriBackend` (the Rust core) and `memoryBackend` (in memory, with the same behavior). Why: UI features can be unit-tested without Tauri, the app runs in a plain browser (`pnpm dev`) with a demo vault, and there is a single documented contract between the Codex- and Claude-owned code.
- **All IPC paths are vault-relative with forward slashes.** The Rust core resolves them, and rejects `..`, absolute paths and the vault root. Why: the frontend can never touch files outside the vault.
- **Writes are atomic** (temp file `.<name>.axis-tmp` + rename). They have **optimistic concurrency**: `writeFile(path, content, expectedModifiedMs)` returns `Conflict` if the file changed on disk since it was loaded. Why: a crash mid-save can't corrupt a note, and edits made outside the app are never silently overwritten.
- **Deletes go to the OS trash** (`trash` crate), never a hard delete.
- **Watcher**: `notify` + `notify-debouncer-full` (250 ms). It emits `vault://changed` with `{ changes: [{ kind, paths }] }`. The app's own writes are suppressed for 2 s via `SelfWrites`. Dot-paths (`.axis`, `.git`) and temp files are ignored.
- **Hidden entries**: names starting with `.` are left out of the tree.
- **Line endings**: `.gitattributes` forces LF (and CRLF for `.ps1`), so both agents' worktrees produce identical diffs.

### Tooling

- **TypeScript is pinned to 6.x**, not 7.0: typescript-eslint 8.70 refuses to run on TS 7.0. Revisit once typescript-eslint supports TS ≥ 7.
- pnpm 12, Vite 8, Vitest 5 (jsdom), ESLint 10 (flat config), Prettier 3.
- CI runs on Windows, Linux and macOS: typecheck, lint, format, unit tests, web build, `cargo fmt --check`, clippy `-D warnings` and `cargo test`.

### Dependencies (all permissive)

| Package                                        | Version    | License                  | Purpose                                 |
| ---------------------------------------------- | ---------- | ------------------------ | --------------------------------------- |
| react / react-dom                              | 19.3       | MIT                      | UI                                      |
| zustand                                        | 5.0        | MIT                      | UI state                                |
| lucide-react                                   | 1.48       | ISC                      | Icons                                   |
| @codemirror/* , @lezer/highlight               | 6.x / 1.2  | MIT                      | Markdown editor (used by T-004)         |
| @tauri-apps/api, plugin-dialog                 | 2.11 / 2.7 | MIT OR Apache-2.0        | IPC, native folder picker               |
| tauri, tauri-build, tauri-plugin-dialog (Rust) | 2.11       | MIT OR Apache-2.0        | Desktop shell                           |
| notify                                         | 8.2        | CC0-1.0                  | File watching                           |
| notify-debouncer-full                          | 0.6        | MIT OR Apache-2.0        | Event debouncing                        |
| trash                                          | 5.2        | MIT                      | Move to OS trash                        |
| zip (+ typed-path, zopfli)                     | 7.4        | MIT (Apache-2.0 deps)    | Packs and note imports from .zip files  |
| thiserror                                      | 2.0        | MIT OR Apache-2.0        | Error types                             |
| dunce                                          | 1.0        | CC0 / MIT-0 / Apache-2.0 | Windows paths without the `\\?\` prefix |
| serde / serde_json                             | 1.0        | MIT OR Apache-2.0        | Serialization                           |
| tempfile (dev)                                 | 3.27       | MIT OR Apache-2.0        | Rust tests                              |
| vite, vitest, jsdom, @testing-library/*        | latest     | MIT                      | Build and tests                         |
| eslint, typescript-eslint, prettier            | latest     | MIT                      | Lint and format                         |
| typescript                                     | 6.0        | Apache-2.0               | Types                                   |
