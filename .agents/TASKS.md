# AXIS Task Board

See `AGENTS.md` for the status flow and rules. The lead (Claude Code) maintains this board.

| ID    | Phase | Task                                                                        | Owner  | Status    | Branch            | Files (ownership)                                                                                      |
| ----- | ----- | --------------------------------------------------------------------------- | ------ | --------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| T-001 | 0     | Scaffold, tooling, CI, IPC contract, Rust vault core + watcher, app shell   | claude | merged    | agent/claude/T-001 | root configs, `.github/**`, `src-tauri/**`, `src/ipc/**`, `src/app/**`, `src/styles/**`, `src/features/vault/**`, `src/App.tsx`, `src/main.tsx`, `docs/**` |
| T-003 | 0     | File tree: nested view, create/rename/move (drag-drop)/trash, keyboard, context menu | claude | merged    | agent/claude/T-003 | `src/features/filetree/**`                                                                             |
| T-004 | 0     | Markdown editor: CodeMirror 6 live preview, autosave, conflict handling      | claude | in-review | agent/claude/T-004 | `src/features/editor/**`                                                                               |
| T-005 | 0     | Integration, WebdriverIO + tauri-driver E2E smoke test, phase QA            | claude | todo      | agent/claude/T-005 | `e2e/**`, integration fixes                                                                           |

_T-002 was folded into T-001: the Rust vault core was built together with the contract so that the Codex tasks have a real backend to target._

_Codex could not run commands (Windows sandbox provisioning failed: `helper_sandbox_lock_failed`), so per the user Claude builds T-003/T-004 itself. Codex cross-reviews are owed once the sandbox is fixed._
