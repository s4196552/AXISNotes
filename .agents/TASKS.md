# AXIS Task Board

See `AGENTS.md` for the status flow and rules. The lead (Claude Code by default) and human-assigned task agents maintain their task records. Since 2026-11-10 the assigned agent's verification is sufficient; Claude review is not required.

Finished tasks are moved to [the archive](TASKS-archive-2026.md) (T-283). Keep each row to one line; put the detail in the brief and handoff.

| ID    | Phase | Task                                                                        | Owner  | Status    | Branch            | Files (ownership)                                                                                      |
| ----- | ----- | --------------------------------------------------------------------------- | ------ | --------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| T-281 | 6 | Unbypassable "local only" AI check: endpoints parsed with `url` (loopback IP, `localhost`, `*.localhost`; no user info; fail closed); plain `http://` only on this computer; local client never redirects, no proxy, loopback-only DNS; remote redirects only same host over https | claude | merged | agent/claude/T-281 | `src-tauri/src/ai/**`, `src-tauri/Cargo.*`, `src/features/ai/AiSettings*`, `src/lib/aiEndpoint*`, `src/ipc/memoryAi.ts`, `docs/DECISIONS.md` |
| T-283 | 6 | Repo hygiene: `.worktrees/` and `test-vaults/` ignored by ESLint, Prettier, the dev server and git (lint no longer hangs in the primary checkout); `scripts/agents/prune-worktrees.ps1` (report; `-Apply` removes merged, unchanged worktrees and merged branches) and `launch-config.ps1`; finished rows archived; `docs/research/improvements-2026-11-25.md` | claude | merged | agent/claude/T-283 | `eslint.config.js`, `.prettierignore`, `.gitignore`, `vite.config.ts` (server.watch), `scripts/agents/*`, `docs/research/improvements-2026-11-25.md`, `.agents/TASKS*.md`, `AGENTS.md` |

## Open branches without a row (need a decision)

Found by `scripts/agents/prune-worktrees.ps1` on 2026-11-25. Each is unmerged; add a row when work resumes, or close it.

- Suite baseline and follow-ups: `agent/codex/T-042`, `agent/claude/T-043`, `agent/claude/T-060`, `agent/codex/T-061` (Linux E2E fix), `agent/codex/T-062` (feature modules), `agent/claude/T-063`
- Later: `agent/claude/T-202`, `agent/codex/T-215`, `agent/codex/T-220`, `agent/codex/T-228`, `agent/codex/T-229` (standalone Hub)
- Superseded but still present: `agent/claude/T-068`, `agent/claude/T-070`
