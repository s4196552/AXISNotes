# AXIS Task Board

See `AGENTS.md` for the status flow and rules. The lead (Claude Code) maintains this board.

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
| T-033 | 6     | Onboarding + settings polish                                                | claude | todo      | agent/claude/T-033 | `src/features/vault/**`, `src/features/settings/**` |
| T-034 | 6     | Performance pass                                                            | claude | todo      | agent/claude/T-034 | build config, lazy loading |
| T-035 | 6     | Installers (.msi, .dmg, AppImage) + release workflow                        | claude | todo      | agent/claude/T-035 | `src-tauri/tauri.conf.json`, `.github/workflows/release.yml` |
| T-036 | 6     | Phase 6 E2E + polish                                                        | claude | todo      | agent/claude/T-036 | `e2e/**` |

_T-002 was folded into T-001: the Rust vault core was built together with the contract so that the Codex tasks have a real backend to target._

_Codex could not run commands (Windows sandbox provisioning failed: `helper_sandbox_lock_failed`). From Phase 6 the user dropped Codex entirely: Claude builds and verifies every task, and no Codex reviews are owed._
