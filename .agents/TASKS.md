# AXIS Task Board

See `AGENTS.md` for the status flow and rules. The lead (Claude Code) maintains this board.

## Suite work — 2026-09-30 proposal

The current human instruction restores the AGENTS.md working agreement. Historical merged
rows retain their status; old Notes phase numbers do not imply suite completion. The human
assigned the baseline continuation to Codex. Future rows await lead adoption and written briefs.
The [suite roadmap](../docs/SUITE_ROADMAP.md) defines acceptance and logical file ownership.

| ID | Phase | Task | Owner | Status | Branch | Files (ownership) |
| --- | --- | --- | --- | --- | --- | --- |
| T-042 | S1 | Architecture/research/contracts baseline | codex | in-review | agent/codex/T-042 | AGENTS.md suite context; AXIS_BUILD_PROMPT.md banner; docs/DECISIONS.md suite entry; docs/SUITE*.md; docs/research/suite-landscape-2026-09-30.md; src/suite/**; src-tauri/capabilities/default.json (format only); .github/workflows/ci.yml (task push CI); reviews/T-042.md; this section; briefs/T-042.md; handoffs/T-042.md |
| T-043 | S2 | Protocol/security/repository placement review | claude | todo | agent/claude/T-043 | docs/DECISIONS.md, docs/SUITE_PROTOCOL.md after T-042 |
| T-044 | S2 | Connect local coordination service | claude | todo | agent/claude/T-044 | separate Connect repository, scoped by lead |
| T-045 | S2 | Notes durable resources/adapter/exact AI rules | claude | todo | agent/claude/T-045 | Notes Rust identity/adapter/AI boundaries, scoped by lead |
| T-046 | S2 | Notes exact AI settings/project UI | codex | todo | agent/codex/T-046 | assigned Notes AI/settings/project UI after T-045 |
| T-047 | S2 | Hub native launcher/session isolation | claude | todo | agent/claude/T-047 | separate Hub native repository scope |
| T-048 | S2 | Hub sections/shortcuts/projects/search UI | codex | todo | agent/codex/T-048 | separate Hub frontend scope |
| T-049 | S2 | Real-Tauri integration acceptance/checkpoint | claude | todo | agent/claude/T-049 | assigned e2e/QA scopes |
| T-050 | S3 | Athena catalogue adapter/provenance | claude | todo | agent/claude/T-050 | Athena repository, local brief required |
| T-051 | S3 | ULAP adapter/search/status/project references | codex | todo | agent/codex/T-051 | ULAP repository, local brief required |
| T-052 | S3 | Non-destructive integration acceptance/checkpoint | claude | todo | agent/claude/T-052 | assigned integration tests |
| T-053 | S4 | Deck core/storage/FSRS | claude | todo | agent/claude/T-053 | separate Deck core scope |
| T-054 | S4 | Deck authoring/study/reviewed snapshot UI | codex | todo | agent/codex/T-054 | separate Deck frontend scope |
| T-055 | S4 | Deck acceptance/checkpoint | claude | todo | agent/claude/T-055 | assigned Deck/Notes integration tests |
| T-056 | S5 | Calendar core/recurrence/time zones | claude | todo | agent/claude/T-056 | separate Calendar core scope |
| T-057 | S5 | Calendar planning/linked task/study UI | codex | todo | agent/codex/T-057 | separate Calendar frontend scope |
| T-058 | S5 | Biology suite acceptance/checkpoint | claude | todo | agent/claude/T-058 | assigned cross-app acceptance tests |
| T-059 | S6 | Web/mobile/selective sync plan and task split | claude | todo | agent/claude/T-059 | suite client/sync specs, scoped by lead |
| T-060 | S1 | Fix macOS CI flake in watcher test `reports_external_edits` | claude | approved | agent/claude/T-060 | src-tauri/src/vault/watcher.rs (test module only); briefs/T-060.md; handoffs/T-060.md; this row |

| ID    | Phase | Task                                                                        | Owner  | Status    | Branch            | Files (ownership)                                                                                      |
| ----- | ----- | --------------------------------------------------------------------------- | ------ | --------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| T-001 | 0     | Scaffold, tooling, CI, IPC contract, Rust vault core + watcher, app shell   | claude | merged    | agent/claude/T-001 | root configs, `.github/**`, `src-tauri/**`, `src/ipc/**`, `src/app/**`, `src/styles/**`, `src/features/vault/**`, `src/App.tsx`, `src/main.tsx`, `docs/**` |
| T-003 | 0     | File tree: nested view, create/rename/move (drag-drop)/trash, keyboard, context menu | claude | merged    | agent/claude/T-003 | `src/features/filetree/**`                                                                             |
| T-004 | 0     | Markdown editor: CodeMirror 6 live preview, autosave, conflict handling      | claude | merged    | agent/claude/T-004 | `src/features/editor/**`                                                                               |
| T-005 | 0     | Integration, WebdriverIO + tauri-driver E2E smoke test, phase QA            | claude | merged    | agent/claude/T-005 | `e2e/**`, integration fixes                                                                           |

| T-006 | 1     | Rust index (SQLite/FTS5), search language, backlinks, mentions, link-safe renames | claude | merged    | agent/claude/T-006 | `src-tauri/src/index/**`, `src/ipc/**`, `src/lib/**` |
| T-007 | 1     | Editor: wikilinks, tags, `[[` autocomplete, frontmatter + properties panel  | claude | merged    | agent/claude/T-007 | `src/features/editor/**`, `src/app/store.ts` |
| T-008 | 1     | Sidebars: search, tags, backlinks + unlinked mentions                      | claude | merged    | agent/claude/T-008 | `src/features/panels/**` |
| T-009 | 1     | `/` + `:` commands, palette, switcher, templates, daily notes, calendar    | claude | merged    | agent/claude/T-009 | `src/features/{commands,templates,daily}/**`, `src/app/config.ts` |
| T-010 | 1     | Themes, CSS snippets, folder icons, settings                               | claude | merged    | agent/claude/T-010 | `src/features/{icons,settings}/**`, `src/app/appearance.ts` |
| T-011 | 1     | Phase 1 E2E (real app) + 5,000-note performance                            | claude | merged    | agent/claude/T-011 | `e2e/**` |

| T-012 | 2     | Outliner: indent/outdent, move, fold, outline view with drag handles        | claude | merged    | agent/claude/T-012 | `src/features/editor/outliner*.ts`, `prefs.ts` |
| T-013 | 2     | Block ids, `[[Note#^` completion, editable embeds, copy block link          | claude | merged    | agent/claude/T-013 | `src/lib/blocks.ts`, `src/features/editor/embeds.ts` |
| T-014 | 2     | Graph view (global + local), Rust graph builder                             | claude | merged    | agent/claude/T-014 | `src/features/graph/**`, `src-tauri/src/index/graph.rs` |
| T-015 | 2     | Phase 2 E2E + polish                                                        | claude | merged    | agent/claude/T-015 | `e2e/**` |

| T-016 | 3     | Formula engine, `.axgrid` grid view, grid search indexing                    | claude | merged    | agent/claude/T-016 | `src/lib/formula/**`, `src/features/{grid,files}/**`, `src/lib/fileKinds.ts`, `src-tauri/src/index/**` |
| T-017 | 3     | `.axcanvas` Excalidraw canvas: note cards, pen input, autosave               | claude | merged    | agent/claude/T-017 | `src/features/canvas/**`, `src/lib/canvas.ts`, `vite.config.ts`, `src-tauri/src/index/**` |
| T-018 | 3     | Tasks: Rust task index, vault-wide tasks view, toggle edits the source      | claude | merged    | agent/claude/T-018 | `src-tauri/src/index/tasks.rs`, `src/lib/tasks.ts`, `src/features/tasks/**`, `src/features/files/editNote.ts` |
| T-019 | 3     | Time tracking (timer, manual entries, report) + computed properties         | claude | merged    | agent/claude/T-019 | `src/features/time/**`, `src/lib/computed.ts`, `src/features/editor/Properties*`, `src-tauri/src/index/time.rs` |
| T-020 | 3     | Phase 3 E2E + polish                                                        | claude | merged    | agent/claude/T-020 | `e2e/**` |

| T-021 | 4     | Rust AI layer: provider trait, 4 codecs, registry, keychain, privacy, log, commands | claude | merged    | agent/claude/T-021 | `src-tauri/src/ai/**`, `src-tauri/src/ai_commands.rs`, `src-tauri/ai-models.json` |
| T-022 | 4     | AI settings UI: providers + keys + test, task models, fallback, limits, folder rules, log | claude | merged    | agent/claude/T-022 | `src/features/ai/**`, `src/ipc/memoryAi.ts`, file tree AI rules |
| T-023 | 4     | Ask AI panel: plan preview, streaming, cancel, provider/model shown          | claude | merged    | agent/claude/T-023 | `src/features/ai/AskAi.tsx`, commands |
| T-024 | 4     | Phase 4 E2E (mock OpenAI-compatible server) + polish                        | claude | merged    | agent/claude/T-024 | `e2e/**` |

| T-025 | 5     | Offline spellcheck (Hunspell worker), quick fixes, personal dictionary      | claude | merged    | agent/claude/T-025 | `src/features/spellcheck/**`, `src/lib/spelling.ts`, Settings → Spelling |
| T-026 | 5     | AI "fix grammar/clarity" with diff review; shared AI run + JSON helpers     | claude | merged    | agent/claude/T-026 | `src/features/ai/**`, `src/lib/aiJson.ts` |
| T-027 | 5     | Handwriting to text (canvas + note pad), uncertain words with quick fixes   | claude | merged    | agent/claude/T-027 | `src/features/handwriting/**`, `src/features/canvas/**`, Rust vision fixtures |
| T-028 | 5     | Diagram maker: Mermaid rendering, AI Mermaid/Excalidraw (schema), outline → diagram | claude | merged | agent/claude/T-028 | `src/features/diagrams/**`, `src/lib/diagram*.ts` |
| T-029 | 5     | Phase 5 E2E + polish                                                        | claude | merged    | agent/claude/T-029 | `e2e/**` |

| T-030 | 6     | Web clipper endpoint (localhost, pairing, clips → notes), image embeds, settings | claude | merged    | agent/claude/T-030 | `src-tauri/src/clipper/**`, `src/features/clipper/**`, `src/lib/attachments.ts` |
| T-031 | 6     | Browser extension (Chrome/Edge/Firefox MV3): page/selection/screenshot/link, offline queue | claude | merged | agent/claude/T-031 | `extension/**` |
| T-032 | 6     | Obsidian vault import                                                       | claude | merged    | agent/claude/T-032 | `src-tauri/src/import.rs`, `src/features/import/**` |
| T-033 | 6     | Onboarding + settings polish                                                | claude | merged    | agent/claude/T-033 | `src/features/vault/**`, `src/features/settings/**` |
| T-034 | 6     | Performance pass                                                            | claude | merged    | agent/claude/T-034 | build config, lazy loading |
| T-035 | 6     | Installers (.msi, .dmg, AppImage) + release workflow                        | claude | merged    | agent/claude/T-035 | `src-tauri/tauri.conf.json`, `.github/workflows/release.yml` |
| T-036 | 6     | Phase 6 E2E + polish                                                        | claude | merged    | agent/claude/T-036 | `e2e/**` |
| T-037 | 6     | AXIS logo (user design) in icons, welcome screen, About; installers rebuilt   | claude | merged    | agent/claude/T-037 | `src/assets/logo.svg`, `src-tauri/icons/**` |
| T-038 | 6     | Rename to AXISNotes (product of AXIS): names, identifier, vault folder, keychain + migrations | claude | merged | agent/claude/T-038 | whole repo |
| T-039 | 6     | Big/messy folders: robust walk, link loops, background indexing with progress | claude | merged | agent/claude/T-039 | `src-tauri/src/vault/**`, `src-tauri/src/index/**` |
| T-040 | 6     | Zoom, note text size, fonts, editor width (Settings → Appearance) | claude | merged | agent/claude/T-040 | `src/app/zoom.ts`, `src/app/appearance.ts`, settings |
| T-041 | 6     | Zoom keys on the welcome screen too | claude | merged | agent/claude/T-041 | `src/app/zoom.ts` |

_T-002 was folded into T-001: the Rust vault core was built together with the contract so that the Codex tasks have a real backend to target._

_Historical note (superseded for new work by the 2026-09-30 human agreement): Codex could not run commands (Windows sandbox provisioning failed: `helper_sandbox_lock_failed`). From Phase 6 the user dropped Codex entirely: Claude builds and verifies every task, and no Codex reviews are owed._
