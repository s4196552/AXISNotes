# AXIS: Multi-Agent Working Agreement

This file is read by **every** coding agent on this project. OpenAI Codex reads `AGENTS.md` automatically, and Claude Code reads it through `CLAUDE.md`. Read the suite context below before taking a task. `AXIS_BUILD_PROMPT.md` remains the historical AXISNotes implementation spec; the suite documents govern new suite work.

## AXIS suite context

The human approved a family of **independent, connected applications**, with local integration first. Every product must offer optional **BYOK and on-device AI** and target **desktop, mobile apps (iOS/Android), and usable web clients**. These are delivery requirements, not claims that these clients already exist. Windows is the first suite integration target. Core workflows must remain useful without AI or an AXIS account.

| Product           | Responsibility                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **AXIS Hub**      | Nested sections/folders for applications, games, websites, files and AXIS resources; shared projects, colours and federated search |
| **AXISNotes**     | Existing Markdown/grid/canvas knowledge app, daily-note navigator and tasks; source-specific AI access                             |
| **AXIS Deck**     | Standalone card authoring/study, spaced repetition, snapshots and review history                                                   |
| **AXIS Calendar** | Standalone time blocking, recurrence and day/week/month views; linked tasks and study allocations                                  |
| **AXIS Athena**   | Broad document/media catalogue, deterministic extraction first, optional AI, summaries, filters and graph                          |
| **AXIS ULAP**     | Deep photo/video intelligence, OCR, speech, people/scenes, semantic search and gallery                                             |
| **AXIS Connect**  | Optional local coordination service for app registration, projects and durable cross-app references; separate from Hub's window    |

### Read before implementing

1. [Suite specification](docs/SUITE.md): approved scope, ownership and boundaries.
2. [Protocol](docs/SUITE_PROTOCOL.md) and [TypeScript contracts](src/suite/contracts.ts): proposed v1 adapter/Connect interfaces and reference helpers.
3. [Suite roadmap](docs/SUITE_ROADMAP.md): phases S1–S6, acceptance scenarios and proposed task split.
4. [Research report](docs/research/suite-landscape-2026-09-30.md): 15 comparable products, sourced features/funding/stack observations and improvements for AXIS.
5. [Task board](.agents/TASKS.md), your written brief, relevant handoffs/reviews and [decision log](docs/DECISIONS.md).

**Branch availability:** the suite baseline is on `agent/codex/T-042` and is not merged. If these files are absent in your checkout, locate the existing task worktree with `git worktree list`, or read them with `git show agent/codex/T-042:docs/SUITE.md` (likewise for the other paths). Do not recreate the baseline or assume missing files mean the suite was cancelled.

### Required product behaviour and boundaries

- **Hub:** support a Gaming section containing Spotify (site), Discord (desktop app) and VALORANT (game). Support custom logos/icons, including Google Stitch and Open Design shortcuts. Native apps open in their own windows; websites use dedicated isolated tabs or a chosen external browser/profile. Multiple-account shortcuts need separate sessions/profiles and an Open in browser fallback. Sessions, executable paths and profile mappings are device-local. Launch with executable/argument arrays, never shell interpolation.
- **Projects:** name, colour, icon and references across apps. Membership never moves files. Explicit item colours override project defaults. Deleting a project deletes coordination metadata only, never app content.
- **Notes compatibility:** retain `app.axis.axisnotes`, the AXISNotes keychain namespace, `.axisnotes` settings, Markdown, `.axgrid`, `.axcanvas`, existing block IDs and canvas `axis:` links. Retain the daily-note navigator and task view. Current note references are path-based; durable suite identity must be added without relying on rebuildable SQLite row IDs.
- **AI access:** users select the exact provider, endpoint and model allowed to read/suggest/apply to each source. Example: cloud AI may access study notes; medical notes permit only selected on-device models. Intersect restrictions across all inputs, inherited rules and derivative provenance, including cards, summaries, OCR and embeddings. Recheck fallbacks and policy revisions. Invalid/unreadable/missing rules fail closed. Localhost does not prove on-device inference; private-server and cloud execution are distinct. Credentials and enforcement stay in owning native backends.
- **Deck/Calendar:** Deck owns spaced repetition and review history; plan FSRS, with implementation/version/license selection still pending. Note-to-card creation saves a snapshot and source reference; source changes require reviewed updates and never silently reset history. Calendar owns time allocations. Moving a study block cannot change card due dates or reviews. Completing a linked task calls Notes' supported mutation with revision checks. Test recurrence, time zones and DST.
- **Athena/ULAP:** preserve their Python engines, ULAP's Tauri shell, independent repositories and separate databases. Originals are never moved, renamed, imported or rewritten. Derived metadata lives outside source libraries. Reuse compatible media analysis for the same content version with provenance/status; fingerprints are not resource identity. Athena initially uses its existing local web interface.
- **Integration:** apps alone write their own content/databases. Connect stores coordination metadata and references. Use versioned authenticated loopback HTTP/JSON between native backends; no credentials or privileged capabilities in remote webviews. Test unauthenticated requests and remote-tab access denial. Search apps concurrently and show partial results when one is unavailable; ULAP semantic search is an explicit mode. Standalone workflows survive Hub/Connect failure.
- **Durability:** owner-issued app/collection/resource IDs survive known renames and index rebuilds. Missing/ambiguous references need visible relinking, never silent rebinding. Back up authoritative identity/project/reference data, card history and calendar records; keep derived indexes rebuildable.
- **Scope:** built-in configurable features/panels/commands/templates/views first. Third-party extensions, external calendar sync, accounts, hosting and collaboration are deferred. Production web/mobile and selective sync follow the local phases; Athena/ULAP source libraries stay local by default. Memory fixtures and canned AI are demos, not production clients.

### Current handoff — 2026-09-30

- **T-042 / S1:** architecture, research, contracts and tested reference helpers implemented; baseline commit `7502644`, with documentation follow-ups on the same branch. See [handoff](.agents/handoffs/T-042.md). Status is **in-review**, not merged or approved.
- Lint and both TypeScript checks passed; 307 Vitest tests passed (37 contract vectors; full suite with four workers); Rust: 95 passed, 2 existing tests ignored. Repository-wide Prettier now passes after the human-approved formatting-only cleanup of `src-tauri/capabilities/default.json`; parsed permissions are identical. Claude code review approved cea4c08. Native Windows Tauri WDIO passed 53 tests in 8 specs. The CI-trigger follow-up at 51c6e0a is Claude-approved. Claude authored T-060, Codex cross-reviewed it, and the lead integrated the bounded watcher-test fix; full Rust now passes 96 tests with 2 existing ignored. Hosted run 36672935411 passes all three platform check jobs, but Linux native E2E has 17 passing and 36 failing tests across 8 specs. It is not green; see the T-042 handoff for the T-061 ownership request. Lead merge remains gated.
- Claude login is now working and its genuine baseline cross-review is recorded in .agents/reviews/T-042.md. Claude authored T-043 design/briefs, corrected the review findings, and Codex approved the saved proposal. Draft PR #2 / agent/claude/T-043 contains docs/S2_FOUNDATION.md and briefs T-044–T-049. No S2 runtime work has begun. Claude now reports a session limit until 7:40 pm Sydney; authentication is working, but new lead/review/merge actions are unavailable. A self-review never substitutes for cross-review; check the latest reviewed commit and CI before merge.
- The TypeScript AI evaluator is a reference implementation, **not enforcement in the existing Notes Rust runtime**. Hub, Connect, Deck and Calendar runtime apps are not implemented. Real-Tauri integration/remote-tab tests and the full Biology workflow remain future acceptance work.
- **Next:** lead adopts/rebriefs proposed T-043–T-059; S2 delivers Hub + Connect + Notes. Historical Notes phases 0–6 are distinct from suite phases S1–S6. Full local acceptance in S5: Biology project → notes/reference documents → linked deck → scheduled study → reopen every item through Hub.
- Preserve uncommitted `DESIGN.md` and `design/` in the primary checkout. Do not treat them as disposable generated files. Do not modify sibling repositories without their own scoped task/worktree.

The latest human-supplied working agreement below applies to new work. Older task-board/decision-log entries about dropping Codex or waiving cross-review describe historical work and do not override it. Each suite phase ends at a human checkpoint; permission to update documentation is not approval to begin the next phase.

## Roles

| Agent            | Role                                                                                                                           | Owns                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **Claude Code**  | **Lead / orchestrator.** Plans each phase, splits it into tasks, assigns them, merges branches, and runs the phase checkpoint. | Architecture, Rust/Tauri core (file system, index, the `AiProvider` trait), `docs/DECISIONS.md` |
| **OpenAI Codex** | **Builder + reviewer.** Builds the tasks assigned to it and reviews every Claude-authored change.                              | The tasks assigned to it in `.agents/TASKS.md`                                                  |

**Cross-review rule:** code is never merged without a review from the _other_ agent. Claude reviews Codex's work and Codex reviews Claude's. Each model catches mistakes the other misses.

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
- **File ownership:** only edit files listed in your task's _Files_ column. If you need to change a file owned by another task, stop and write the request into your handoff note.
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
