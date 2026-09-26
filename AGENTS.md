# AXIS: Multi-Agent Working Agreement

This file is read by **every** coding agent on this project. OpenAI Codex reads `AGENTS.md` automatically, and Claude Code reads it through `CLAUDE.md`. The product spec is in `AXIS_BUILD_PROMPT.md`.

## Roles

| Agent | Role | Owns |
|---|---|---|
| **Claude Code** | **Lead / orchestrator.** Plans each phase, splits it into tasks, assigns them, merges branches, and runs the phase checkpoint. | Architecture, Rust/Tauri core (file system, index, the `AiProvider` trait), `docs/DECISIONS.md` |
| **OpenAI Codex** | **Builder + reviewer.** Builds the tasks assigned to it and reviews every Claude-authored change. | The tasks assigned to it in `.agents/TASKS.md` |

**Cross-review rule:** code is never merged without a review from the *other* agent. Claude reviews Codex's work and Codex reviews Claude's. Each model catches mistakes the other misses.

## Coordination files (`.agents/`)

```
.agents/
├── TASKS.md             # task board: the single source of truth
├── briefs/T-###.md      # written by the lead before assigning a task
├── handoffs/T-###.md    # written by the builder when a task is done
├── logs/                # Codex run logs (gitignored)
└── reviews/T-###.md     # written by the reviewer
```

**TASKS.md row format:**

```
| ID    | Phase | Task                          | Owner  | Status      | Branch              | Files (ownership)        |
|-------|-------|-------------------------------|--------|-------------|---------------------|--------------------------|
| T-012 | 1     | Wikilink autocomplete         | codex  | in-review   | agent/codex/T-012   | src/editor/wikilinks/**  |
```

Status moves through `todo → in-progress → in-review → changes-requested → approved → merged`.

**Handoff note (`handoffs/T-###.md`)** contains:
- what was built
- the files that changed
- how to test it
- known gaps
- any decision that needs the lead

**Review note (`reviews/T-###.md`)** contains:
- a verdict (`approve` / `changes-requested`)
- findings, most severe first, each with `file:line`
- whether you ran the tests and whether they passed

## Git rules

- One task = one branch, `agent/<claude|codex>/T-###`, in its **own git worktree** (`git worktree add ../axis-T-012 -b agent/codex/T-012`), so the two agents never edit the same checkout.
- **File ownership:** only edit files listed in your task's *Files* column. If you need to change a file owned by another task, stop and write the request into your handoff note.
- Only the lead merges into `main`, and only after an `approve` review and green CI.
- Commit messages start with `T-###:`.

## Shared engineering rules

- Before you finish a task, run `pnpm lint && pnpm test && cargo test` (or whatever the equivalent commands are once they exist).
- Don't add a dependency without a line in `docs/DECISIONS.md` that includes its license.
- Never commit API keys. Tests that call real AI providers must use recorded fixtures and skip themselves when no key is set.
- Phase checkpoints from `AXIS_BUILD_PROMPT.md` still apply: when a phase is complete, the lead stops and reports to the human.

## UI verification

- **Automated (both agents):** WebdriverIO + `tauri-driver` end-to-end tests against the real Tauri build, which work on Windows and Linux. Use Vitest + Testing Library for components.
- **Visual / exploratory (lead only, at phase end):** use computer use (see `ORCHESTRATION.md`) to launch the built app, click through the phase's acceptance criteria, and save screenshots to `.agents/qa/phase-N/`. Log any bugs found as new tasks.
