# AXIS suite delivery and checkpoints

S1–S6 are suite phases. Historical Notes phases 0–6 retain their original IDs/status; they
are not completion evidence for this roadmap. Follow AGENTS.md task ownership, isolated
worktrees, other-model cross-review, green CI and lead-only merges. Every phase stops for
a human checkpoint after working acceptance scenarios, including honest gaps/check results.

## S1 — Architecture baseline (T-042)

Deliver updated scope, inventory separating runtime features from demos, contracts, researched
comparisons, tested identity/AI reference helpers and the suite task proposal. Preserve product
IDs, existing Notes data and current main-checkout work. No runtime service migration yet.

Acceptance: TypeScript compiles the versioned contract; identity tests show rename/rebuild
continuity and separator collision prevention; permission tests cover exact model identities,
mixed study/medical inputs and fail-closed rules. Lead reviews scope/contracts and adopts
subsequent tasks. This phase is a code/document baseline, not the full Biology UI scenario.

## S2 — Hub and Notes foundation

Build Connect startup/discovery/authentication, project storage/backup, Notes stable reference
and search/open adapter, then a separate Hub desktop app with nested sections and launch
targets. Native launches and isolated remote sessions have separate permissions. Implement
Notes exact AI allowlists in Rust before connected operations use restricted sources.

Acceptance: create Biology; attach a note; rename it and rebuild Notes' index; Hub still
searches/opens the same resource. Gaming launches Spotify, Discord and a configured game.
Two website profiles are isolated and external browser fallback works. Notes works with Hub
closed and Connect unavailable. Unauthenticated/remote-origin/remote-tab requests fail.
Deleting Biology preserves all content. Restart restores projects/identity/launcher data.
Invalid privacy files deny AI. Medical data never reaches the mock cloud provider.

## S3 — Athena and ULAP integration

Implement adapters in their own repositories with independent releases. Athena initially
uses its existing local web interface. Add catalogue search and ULAP semantic mode, status
and provenance links. Reuse compatible results at the same content version; keep separate DBs.

Acceptance: add references to Biology without moving source files; resolve/open results from
Hub; show stale/failed/queued media states and partial search when one service is stopped.
Exercise duplicate files, deleted paths, source edits, retries and index rebuilds. Compare
before/after source hashes and directory manifests; every original remains identical.

## S4 — AXIS Deck

Separate standalone authoring/study app. Select and document licensed FSRS implementation,
versioned scheduling state, durable source snapshots and append-only review history. Add
reviewed Notes card creation/refresh and projects. AI drafting respects every source policy.

Acceptance: make a Biology deck from a note, study offline, restart and recover reviews;
edit source and accept/reject individual updates without resetting history. Missing source
does not delete cards. Due-workload estimates expose a supported Calendar integration API.
Mock AI shows exact permission enforcement and safe fallback; no live provider keys in tests.

## S5 — AXIS Calendar

Standalone time blocking with recurrence/day/week/month; then Notes tasks/daily notes and
Deck study blocks. Implement IANA zones, recurrence exceptions and explicit DST behaviour.

Acceptance: schedule Biology study, move its block and verify Deck due dates/history stay
unchanged; complete a linked Notes task and verify the owner write; stale revisions conflict.
Test spring gaps, autumn folds, travel, overnight blocks, occurrence/series edits and recovery.
Full local scenario: create Biology, attach notes/documents, create/study linked deck,
schedule study, then reopen every resource through Hub with one unrelated app unavailable.

## S6 — Production web/mobile and selective sync

All six products target desktop, mobile apps and usable web clients. Ship real persistent
clients, not memory demos. Notes/Deck/Calendar/projects get selective sync first. Hub web/mobile
use capability-aware local handoff; Athena/ULAP library access stays local by default. AI BYOK
and on-device options are platform-capability-aware and truthful. Browser inference or secure
companion pairing is required for a local-AI feature; never put provider keys in hosted logs.

Accounts, hosting, collaboration, conflict resolution and cross-device pairing receive a
separate approved implementation/security phase. Membership references are syncable;
executable paths, browser profiles and sessions stay device-local. Sync permissions and AI
permissions are independent: cloud backup consent does not permit cloud inference.

Acceptance: useful offline persistence on each released target; opt-in sync excludes local-only
records; recover conflicts and interrupted uploads without duplicate reviews/time blocks.
Test exported/backed-up records independently of hosted service. Document unsupported
platform capabilities in UI and release notes. No source-library upload by default.

## Proposed task ownership

Only T-042 is assigned by the human continuation. Other rows await lead adoption/briefs.
Tasks in external repositories need a local board and worktree there before edits. Keep Hub,
Deck, Calendar and Connect independent application/release boundaries; decide exact new
repository roots in T-043 before scaffold tasks. The scopes below are logical ownership,
not permission to create another application's code inside the Notes Rust core.

| ID    | Phase | Owner  | Deliverable and ownership scope                                                                      |
| ----- | ----- | ------ | ---------------------------------------------------------------------------------------------------- |
| T-042 | S1    | codex  | Suite baseline documents, research and src/suite reference contracts                                 |
| T-043 | S2    | claude | Connect/repository placement, protocol review, security and dependency decisions; docs/DECISIONS.md  |
| T-044 | S2    | claude | Separate Connect service: auth/discovery/projects/backup; Connect repository                         |
| T-045 | S2    | claude | Notes durable IDs, adapter and backend exact AI policies; src-tauri/src suite/AI/identity boundaries |
| T-046 | S2    | codex  | Notes exact AI settings/project badges; src/features/ai and assigned Notes UI files after T-045      |
| T-047 | S2    | claude | Separate Hub native launcher/session capabilities; Hub repository native core                        |
| T-048 | S2    | codex  | Hub sections, shortcuts, project/search UI; Hub repository frontend                                  |
| T-049 | S2    | claude | Integration E2E/cross-review/phase checkpoint; assigned e2e and QA scopes                            |
| T-050 | S3    | claude | Athena adapter and provenance results; Athena repository                                             |
| T-051 | S3    | codex  | ULAP adapter/status/search/project references; ULAP repository                                       |
| T-052 | S3    | claude | Non-destructive integration acceptance and checkpoint                                                |
| T-053 | S4    | claude | Deck core/storage/FSRS selection; Deck repository native/core scope                                  |
| T-054 | S4    | codex  | Deck authoring/study/reviewed Notes snapshot UI; Deck frontend                                       |
| T-055 | S4    | claude | Deck/Notes integration acceptance and checkpoint                                                     |
| T-056 | S5    | claude | Calendar core/recurrence/time zones; Calendar native/core scope                                      |
| T-057 | S5    | codex  | Calendar planning/linked study/tasks UI; Calendar frontend                                           |
| T-058 | S5    | claude | Full Biology integration acceptance and checkpoint                                                   |
| T-059 | S6    | claude | Approved web/mobile/sync design and per-platform task split                                          |

## Validation and evidence

For each task run applicable lint, typecheck, Vitest and Rust/Python checks. Real native
runtime changes require WebdriverIO + tauri-driver against the actual built Tauri app;
lead visual QA captures phase screenshots. Record commands, exit status, skipped/unavailable
checks and reviewed commits in handoffs/reviews; do not equate a browser preview with a
desktop E2E pass. Keep authoritative data backups and use fixtures for external AI calls.

The full local Biology scenario is the S5 checkpoint. S1 cannot claim it already works.
Unmet acceptance criteria become owned tasks before release. No task is merged without
the other agent's approve and green CI; unavailable review does not imply approval.
