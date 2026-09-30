# AXIS bundled modules and performance

Human-requested direction, 2026-09-30. T-062 implements the existing Notes frontend portion;
other products and native service lifecycle work remain in their scoped suite tasks.

## Architecture

Each product retains a dependable core and its independent database/content owner. Optional
tools are bundled modules with stable feature IDs, a metadata-only catalog, defaults,
dependencies and platform capabilities. UI imports the catalog without importing heavy
implementations. Surface activation uses dynamic imports; lifecycle cleanup removes owned
timers, subscriptions and workers. Built-in feature settings are not third-party plugin execution.

Keep ordinary UI in process. Run expensive extraction, OCR, transcription, embedding and
model inference in bounded workers/jobs owned by Athena/ULAP or the owning native backend.
An extra process consumes memory and adds IPC; use one where isolation or workload warrants it.
Modules use supported owner operations, never generic SQL/file access across applications.

| Product  | Dependable core                                                                              | Optional modules                                                                                 |
| -------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Notes    | Markdown saving/recovery, links/identity, tasks, daily notes; compatible grid/canvas opening | Graph, timers/report, AI assistance, handwriting recognition, diagram tools, spellcheck          |
| Hub      | Sections/shortcuts, validated launch targets, device-local mappings                          | Widgets, extra views and app adapters; website sessions have independent suspend/resume controls |
| Deck     | Card storage, licensed/versioned scheduler, append-only reviews and snapshots                | Extra card/study views and AI drafting                                                           |
| Calendar | Records, recurrence/exceptions, time zones and recovery                                      | Planning helpers, extra views, future external connectors                                        |
| Athena   | Catalogue identity, source protection, jobs/status/provenance                                | Extractors, classifiers, graph/views and optional AI pipelines                                   |
| ULAP     | Media identity/references, source protection, jobs/status/provenance                         | OCR, transcription, people/scenes/semantic analysis and gallery views                            |
| Connect  | Authenticated registry, projects/references and durable metadata                             | Owner adapters with capability checks; app cores survive Connect failure                         |

## Loading and disabling

Enabled does not mean initialized at startup. Open graph rendering only when requested;
models load for explicitly requested work. Native runners need idle/unload controls and
bounded concurrency; do not claim that hiding a panel unloads a model. Resolve active writes
before disable, cancel cancellable jobs, ignore late completions and keep recoverable outcomes.
UI guards supplement backend permissions; feature switches never authorize source access.

Disable preserves files, dictionary data, settings, snapshots, annotations and reviews.
Missing/disabled tools explain how to re-enable or recover data. Dependencies affect effective
availability without overwriting the user's preferences. Already imported JS remains cached;
stopping activity reduces ongoing work but does not guarantee a return to cold-start memory.
Installable third-party extensions need a separate approved security/versioning phase.

## Implemented in T-062

Notes stores bundled feature preferences in .axisnotes/config.json. Old configurations retain
enabled defaults; wrong-typed flags are ignored and unknown keys survive saving. Settings →
Features controls graph, time tracking, AI assistance, handwriting, diagrams and the existing
spellcheck setting. Handwriting requires AI assistance; diagrams retain deterministic creation
when AI assistance is disabled. Core tasks and the daily-note navigator remain available.

The local graph starts collapsed and loads on expansion. Timer runtime/restoration waits for
the current vault configuration; disabled timer controls do not import the timer implementation.
Disabling time tracking requires stopping an active timer, so the switch does not silently edit
or leave a running entry. Stale restoration cannot reactivate a suspended timer. Spellcheck's
worker terminates on disable and settles pending requests. Shared AI dispatch rejects disabled
assistance and cancels outstanding runs. Canvas handwriting/diagram dialogs and AI settings
load on first opening. Optional chunk failures leave core editing and source data available.

This changes frontend module lifetimes, not the native AI policy implementation. Exact model
allowlists/attestation remain T-045. The existing Rust index still owns shared indexing; no
independent module scanners were added. This is not a plugin marketplace or a model runner.

## Acceptance and measurements

For each implementing task, record machine/build/version and fixed vault/media workload:
startup to usable editor, first feature use, initial JS plus static dependencies, idle process
memory/CPU, typing/autosave latency and peak concurrent jobs. Compare the same cold/warm
conditions before and after. Initial JS size is not a CPU/memory benchmark.

Tests must cover disabled entry points/shortcuts, first-use imports, teardown, late completion,
re-enable, vault switches, failures, active-write/run handling and data preservation. Native
runtime changes require real Tauri tests; core workflows still work with optional modules,
AI, Hub and Connect unavailable. Every released platform declares supported capabilities.
