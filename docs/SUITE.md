# AXIS suite architecture

Status: human-approved direction; T-042 implementation baseline awaiting cross-review.
This specification takes precedence over the historical Notes-only scope in
[AXIS_BUILD_PROMPT.md](../AXIS_BUILD_PROMPT.md) for new suite work. Existing Notes behaviour
and data compatibility remain requirements. See [delivery](SUITE_ROADMAP.md),
[protocol](SUITE_PROTOCOL.md) and [research](research/suite-landscape-2026-09-30.md).

## Product boundaries

AXIS is a family of independent, connected applications for students, researchers and
knowledge workers. AXIS Hub is a workspace and launcher. AXIS Connect is an optional local
coordination process; closing Hub does not close the other applications or their services.
Each product has an independent release, storage owner and useful standalone workflow.

| Product       | Owns                                                                           | Connected behaviour                                                       |
| ------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| AXIS Hub      | Launcher sections, shortcuts, local launch mappings, tab/session configuration | Shared projects, cross-app search, resource opening                       |
| AXISNotes     | Markdown, grids, canvases, knowledge links, daily notes, tasks, vault settings | Durable note references, search/open, explicit task mutations             |
| AXIS Deck     | Cards, content snapshots, learning schedules, review history                   | Reviewed Notes-to-card creation, project membership, study workload       |
| AXIS Calendar | Time blocks, recurrence, local planning preferences                            | Notes task/daily-note links and Deck study allocations                    |
| AXIS Athena   | Broad document/media catalogue, extraction, summaries, classification, graph   | References to ULAP results with version, provenance and processing status |
| AXIS ULAP     | Deep photo/video analysis, OCR, speech, people, scenes, embeddings and gallery | Explicit semantic search and compatible analysis-result references        |
| AXIS Connect  | Projects, app registry, cross-app references and coordination metadata         | No direct writes to app-owned content or databases                        |

All six products must offer optional BYOK and on-device AI, and target desktop, mobile
applications (iOS/Android) and web clients. These are delivery commitments, not claims that
these clients exist today. Private-server inference is a separate option, not on-device AI.
Every core workflow remains usable with AI disabled and without an AXIS account.
Windows is the first local suite integration target; preserve existing cross-platform code.
Keep app.axis.axisnotes, the AXISNotes keychain namespace, .axisnotes settings, Markdown,
.axgrid and .axcanvas formats. Keep the current daily-note navigator and task view.

## Current implementation inventory

Inventory observed on 2026-09-30; historical task-board completion is not a fresh acceptance run.

| Project                      | Existing implementation                                                                                                 | Gaps relative to this suite                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| This repository (AXISNotes)  | React/Tauri, Rust file/index/AI engines, Notes phases 0–6 recorded complete; browser IPC uses memory fixtures/canned AI | Path-based note references; no durable suite identity map, Connect adapter, exact model permissions or production web/mobile release |
| Athena (sibling repository)  | Python catalogue engine and local web UI                                                                                | Next cloud UI is a fixture demo; no production account/sync integration or native suite adapter                                      |
| ULAP (sibling repository)    | Python service, React gallery, Tauri shell; seven local phases reported implemented                                     | Suite adapter, shared project integration and production mobile/web distribution unverified                                          |
| Hub, Connect, Deck, Calendar | Suite baseline contracts only                                                                                           | Runtime applications and services still to be built                                                                                  |

Preserve Athena and ULAP as separate repositories and databases. Their sibling checkouts
were inspected for research only; T-042 does not modify either. The browser Notes demo must
remain labelled a demo until real storage, security and offline acceptance checks pass.

## Hub launch model

Users create nested named sections with colours/icons and ordered items. A Gaming section
can contain Spotify (website), Discord (Windows app) and VALORANT (Windows app). Items may
target an executable with an argument array, a Windows shortcut, a registered application
URI, a local file/folder, a website or an AXIS resource. Launch native targets in their own
windows; websites use dedicated Hub tabs or an external browser.

Website opening is explicit: Hub session, default browser, or configured browser/profile.
Multiple Facebook account shortcuts can use separate Hub session storage partitions or
separate browser profiles. Never promise that every identity provider permits embedded
sign-in. Always offer Open in browser and show the selected profile/session. Cookie jars
are device-local secrets and must not be synced with shortcut metadata. Browser executables,
profile IDs and launch arguments are device mappings, resolved by a trusted backend.

Only user-configured shortcuts can launch processes. Use executable plus argument arrays,
never shell interpolation. Remote tabs cannot invoke launch commands or alter shortcuts.
Validate HTTP(S) websites; registered URI launches require explicit local registration and
confirmation during setup. Prevent cyclic sections and provide keyboard move/sort controls.
Google Stitch and Open Design are named web shortcuts with optional logos/custom icons.

## Projects and durable resources

A project has a stable ID, name, colour, icon and memberships represented by owner-issued
resource references. Adding a Biology note or a media file never moves, copies or edits its
source. Removing a membership or deleting a project removes coordination metadata only.
Explicit item colours override project colour. With several projects, the user can choose
a primary colour source; otherwise show project badges rather than arbitrarily choosing.

References contain app ID, collection ID and resource ID. Paths and SQLite row IDs are
locators, never identity. Apps maintain authoritative identity/rename metadata separately
from disposable indexes. Preserve existing Notes paths, block IDs and canvas axis: links;
introduce an adapter conversion without rewriting existing documents. The current Notes
NoteRef is path-based and its index has integer row IDs; T-045 must add durable collection
and resource identity metadata rather than treating that existing index as authoritative.

Duplicate content can have distinct resources. A fingerprint identifies a content version
for analysis reuse, not an ownership identity. Missing resources stay visible with a relink
action. Never silently bind an ambiguous duplicate or a newly created file at an old path.
Rebuilds/restarts keep resource IDs, project memberships and provenance intact.

## Deck and Calendar

Deck authors cards and runs standalone study sessions. Adopt FSRS for spaced repetition
after the implementation/version/license decision in the Deck task. Keep append-only review
events, algorithm version, parameters and per-card state recoverable from backups. Study
works offline; AI is optional for drafting cards and explanations. No scheduler dependency
is introduced by this baseline.

Creating cards from a note captures content and a durable source reference/revision. Source
changes offer a diff for review. Accepting text changes does not reset learning history;
reset/reschedule requires a separate explicit action. Deleting a source leaves cards usable
and marks the source missing. Content-derived privacy restrictions travel with snapshots.

Deck publishes due workload and estimated study duration. Calendar allocates sessions to
that workload, checks revisions and warns on stale estimates. Moving a study block does not
change card due dates or review events. Completing a Notes task calls Notes' supported
mutation with its current revision; a conflict requires reread/review, never a blind overwrite.

Calendar owns day/week/month views, time blocks, recurrence and exceptions. Store instants
plus IANA time zones; recurring wall-clock rules include their zone and explicit DST gap/fold
behaviour. Distinguish all-day dates from instants. Test travel, edits to one occurrence vs
the series, overnight blocks, clock changes and invalid times. External calendars are deferred.

## Athena and ULAP

Athena remains the broad catalogue; ULAP is the deeper media specialist. Both leave originals
untouched: no import/move/rename or metadata writes. Indexes, thumbnails and extracted text
live outside source libraries. Jobs report queued/running/ready/failed/stale/cancelled states.

Athena references ULAP results using resource IDs, content fingerprints, pipeline/model
versions and provenance. Reuse only compatible results for the same content version, policy
and requested analysis. Changed content marks results stale; retries resume idempotent stages.
Databases remain separate. Deterministic extraction precedes optional AI classification.
Measure source hashes and directory manifests before/after indexing and integration.

## AI permissions and execution

Each app owns its provider configuration, credentials and dispatch. Shared AI permission
semantics are not a shared credential vault. Hub and Connect cannot bypass source rules.
Every execution identifies the exact provider configuration, endpoint configuration and
model. Changing an endpoint, changing a model or using fallback triggers a fresh check.

Allow policies specify allowed execution locations, exact model identities and operations:
read, suggest, apply. Suggest/apply require read. Applying suggestions still requires the
app's existing reviewed-edit workflow. Folder/source inheritance and every input's provenance
are combined by intersection. A deny anywhere blocks the run. Missing, unreadable, unknown
version or invalid rules fail closed. Permission widening is explicit and reviewed.

For example: study notes allow the configured OpenAI study model and a local study model;
medical notes allow only selected on-device models. A prompt containing both sources can
run only on a model permitted by both policies. Retrieval, summaries, embeddings, image
analysis, card snapshots and tool output are all sources subject to this rule.

Localhost is not execution evidence: a local API can forward inference to the cloud.
Backends attest execution based on the actual runner/provider configuration, restrict model
aliases/cloud fallback and block unknown execution locations for on-device-only sources.
On-device verification and exact model IDs must be implemented in each backend; the
TypeScript helper is a reference implementation, not a browser security boundary.

Legacy Notes Any/Local/Never can be translated explicitly without rewriting files. Migration
must preserve stricter restrictions and surface invalid rules, never interpret them as empty
permissions. Per-model permissions need a Rust implementation and migration tests before
they protect actual Notes operations. This baseline does not change the current AI runtime.

## Process, storage and client boundaries

Use versioned authenticated loopback HTTP/JSON between native backends. Any app can request
Connect startup. A single-instance lock and readiness handshake avoid duplicate services.
Failure leaves app-owned standalone operations available. Connect does not depend on Hub's
window lifetime. Search queries run concurrently, group by app/type and return useful partial
results with unavailable/unsupported states. Keep ULAP semantic mode explicit.

Remote webviews receive zero native filesystem/keychain/app-command/Connect capabilities.
Define capabilities per trusted local window; never match remote URLs or labels with broad
wildcards. Reject unauthenticated requests and remote browser origins at Connect/adapters.
See Tauri's [capability documentation](https://v2.tauri.app/security/capabilities/).
No tokens in DOM, URLs, localStorage, page scripts or remote tabs.

Authoritative backups cover files/settings/identity metadata, projects/references, Deck
content/review history, Calendar records and any user annotations. Derived extraction/indexes
are rebuildable; user corrections and provenance are authoritative. Backups exclude bearer
credentials and cookie sessions, which are re-paired on restore.

Mobile/web support progresses through usable clients and then selective sync. Browser local
AI may require a supported browser runner or an explicitly paired local companion; do not
ship a fake local-AI toggle. Browser sandboxes cannot launch arbitrary desktop apps or scan
arbitrary source folders: expose capability-aware handoff/pickers instead. Athena/ULAP source
libraries stay local by default; synced catalogues require deliberate selection and policy
checks. No accounts, hosting, collaboration or shared cloud library in the initial local phases.

Modularity initially covers configurable built-in features, panels, commands, templates and
views. Third-party plugin execution is a later security/product phase.
