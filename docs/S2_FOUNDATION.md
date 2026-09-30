# S2 foundation design: Connect, Notes identity/AI policy and Hub

Status: T-043 proposal, in review. Revision 2 addresses the first Codex review
(`.agents/reviews/T-043.md`): S2-D07, D09–D11, D19, D24, D29a, D32–D34 and D42. Later
revisions address the follow-up findings: the S2-D33 provenance cap, and S2-D39 Hub
webview isolation, which is checked against the official Tauri capability documentation.
Nothing here is implemented.
It refines [SUITE.md](SUITE.md), [SUITE_PROTOCOL.md](SUITE_PROTOCOL.md) and the S2 section
of [SUITE_ROADMAP.md](SUITE_ROADMAP.md) into decisions that T-044–T-049 can build and test.
Decision IDs (S2-Dnn) are cited by the briefs in `.agents/briefs/` and by
[DECISIONS.md](DECISIONS.md). No dependency is added by this document; every crate named
below is a candidate whose exact version and license the owning task verifies and logs.

## 1. Threat model for S2 (S2-D01)

In scope, and each gets a negative test in T-049:

- Web content in any browser or in a Hub remote tab reaching Connect, an adapter or a Tauri
  command (CSRF, DNS rebinding, CORS, `fetch` to loopback).
- Other OS user accounts on the same machine.
- A stale or impostor process listening on a port from an old manifest or registration.
- Confused deputies: one AXIS app using a capability that belongs to another (for example Hub
  calling `notes.set-task-completed`, or a remote tab asking Hub to launch a process).
- Replayed requests, duplicated retries, and crashes between two writes.
- AI dispatch to a location the source policy forbids, including localhost gateways.

Out of scope, and stated in the UI and release notes: malicious native code already running as
the same OS user. It can read the vault, the keychain and every per-user file. Scoped app
identities in S2 prevent accidental misuse and remote abuse; they do not isolate one same-user
program from another. Executable signing and caller-process verification are later hardening.
Also out of scope: confidentiality of loopback traffic against packet capture, which needs
administrator rights. S2 signs traffic for authenticity; it does not encrypt bodies (S2-D09).

## 2. Repositories, branches and versions (S2-D02, S2-D03)

- **AXISNotes** stays at `A:/M. PROJECTS/AXIS` (this repository). Its suite board
  (`.agents/TASKS.md`) remains the single source of truth for suite task IDs.
- **New sibling local repositories**, each with its own `git init`, `main` branch, `AGENTS.md`
  and `CLAUDE.md` pointing back to this working agreement, and its own `.agents/briefs`,
  `handoffs` and `reviews`:
  - `A:/M. PROJECTS/AXIS-Protocol`: v1 JSON Schemas, shared acceptance vectors, the Rust
    crate `axis-suite-protocol` (types, validation, request signing) and the client crate
    `axis-connect-client` (launch, readiness, pairing and heartbeat for native apps).
    Created by T-044.
  - `A:/M. PROJECTS/AXIS-Connect`: the Connect service binary `axis-connect`. Created by T-044.
  - `A:/M. PROJECTS/AXIS-Hub`: the Hub Tauri app. Created by T-047.
  - Later: `A:/M. PROJECTS/AXIS-Deck` (T-053) and `A:/M. PROJECTS/AXIS-Calendar` (T-056).
- **Athena and ULAP** stay in their existing sibling repositories and paths. S2 does not touch
  them. T-050/T-051 record their exact paths in their own local briefs.
- Before a task edits a new repository, that repository's first commit on `main` must exist.
  The task then creates a worktree beside it, for example
  `git -C "A:/M. PROJECTS/AXIS-Connect" worktree add ../axis-connect-T-044 -b agent/claude/T-044`.
  The pattern is
  `../axis-<repo>-T-###` for new repositories and `../axis-T-###` for this one. One task, one
  branch and one worktree per repository it touches. A task spanning two repositories uses the
  same task ID and branch name in both.
- **No remotes.** Publishing GitHub repositories, CI runners or releases for the new repositories
  needs a later explicit human instruction. Until then, "green CI" for those repositories means
  the task's documented local command list ran and passed, recorded in the handoff. The lead
  must not describe that as hosted CI.
- **Versions.** Three separate version lines, never mixed:
  - **Apps** each keep their own semantic version and release cadence. Notes stays on 0.1.x;
    the new apps, Connect (`axis-connect`) and Hub, start at `0.1.0`.
  - **Protocol crates** (`axis-suite-protocol` and `axis-connect-client`, in the
    AXIS-Protocol repository) share one semver line whose first tag is `protocol-v1.0.0`
    (crate version `1.0.0`). There is no 0.x protocol release.
  - **Wire version** is the integer `protocolVersion: 1` under `/axis/v1`, independent of
    both.

  Consumers **vendor** a tagged copy into
  `vendor/axis-suite-protocol/` with a `VENDORED_FROM` file (`tag`, commit SHA, SHA-256 of the
  tree listing) and use a Cargo path dependency. Vendoring works offline and in any future CI
  without publishing. Updating a vendored copy is its own commit, `T-###: vendor protocol vX`.
  Python (S3) consumes the same JSON Schemas and vectors from the vendored copy.

- The TypeScript reference in `src/suite/**` of this repository stays the human-readable
  reference. T-045 aligns it with the refinements in SUITE_PROTOCOL.md and runs the same JSON
  vectors in Vitest, so the TypeScript, Rust and later Python implementations agree.

## 3. AXIS Connect process (S2-D04 – S2-D08)

**Language and packaging (S2-D04).** Connect is a headless Rust binary (`axis-connect.exe`,
`windows_subsystem = "windows"`, no console, no webview, no tray). Build it from the vetted
crate families Notes already uses: `tiny_http` (server), `reqwest` with rustls (client for
adapter calls), `serde`/`serde_json`, `ring` (random numbers, SHA-256, HMAC), `rusqlite` with
bundled SQLite and its `backup` feature, and `keyring`. Each use in the new repository still
needs a DECISIONS.md line in that repository with its exact version and license. T-044 verifies
licenses with `cargo metadata --format-version 1` license fields and the crate sources, not from
this document. No async runtime is required. Adapter fan-out uses a bounded worker pool of
`std::thread`s with per-call timeouts.

**Install location (S2-D05).** A per-user install without admin rights:
`%LOCALAPPDATA%\Programs\AXIS Connect\axis-connect.exe`. Apps locate it through
`AXIS_CONNECT_EXE` (development and tests), then this default path. They never use a PATH
search or a location a registration supplies. A missing binary means "Connect not installed".
Integration features show that state, and the standalone app keeps working.

**Per-user data layout (S2-D06).** `AXIS_CONNECT_HOME` overrides the root for tests. The
default root is `%LOCALAPPDATA%\AXIS\Connect\`:

- `data\connect.db`: authoritative projects, memberships, tombstones, change log, operation
  records and pairing records (not secrets). SQLite, WAL mode, schema versioned by
  `PRAGMA user_version`.
- `backups\`: SQLite online backups (see section 5).
- `run\connect.lock`: the single-instance lock file.
- `run\instance.json`: the readiness manifest.
- `secrets\bootstrap.key`: 32 random bytes used only to authenticate (and sign the responses
  to) two requests: the liveness probe `GET /axis/v1/connect/status` and `POST /axis/v1/pair`.
- `logs\connect.log`: metadata only, rotated at 1 MB and keeping 3 files. It never holds
  bodies, snippets, paths, tokens or signatures.

The master key lives in the OS keychain: service `AXIS Connect`, entry `master-key-v1`. If the
keychain is unavailable Connect refuses to start and falls back to nothing. Tests use
`AXIS_CONNECT_MEMORY_KEYS=1`. The profile directory's inherited ACL already denies other
non-admin users. T-044's smoke script checks it with `icacls` and fails if `Everyone`, `Users`
or `Authenticated Users` have access. Explicit DACL hardening through Win32 APIs is a later
dependency decision.

**Startup, single instance and readiness (S2-D07).**

Liveness and authorization are checked separately. Liveness uses the **bootstrap key**, which
every launcher can read and which needs no pairing. The app's own credential is checked only
after Connect is proven alive. An unpaired, revoked or restored app therefore never mistakes
"my credential is invalid" for "Connect is dead", and never spawns a second Connect because
of it.

Service side:

1. `serve` takes an exclusive, non-blocking lock on `run\connect.lock`. It prefers
   `std::fs::File::try_lock`; T-044 checks which Rust release stabilised it and raises
   `rust-version`, or records a lock crate. If the lock is held, the process exits with code 3
   ("already running"). The OS releases the lock when the process dies, so a crash never leaves
   a stale lock.
2. With the lock held, Connect opens and migrates the database. If `secrets\bootstrap.key` is
   absent, it creates it atomically. It binds `127.0.0.1:0` (an ephemeral port, so there are no
   fixed-port collisions), generates a 128-bit `instanceId` and atomically writes
   `run\instance.json` with the fields `protocolVersion` (1), `instanceId`, `pid`, `address`
   (`127.0.0.1`), `port` and `startedAt`. The bootstrap key always exists before the manifest
   does. Only after the
   manifest is written does Connect accept requests.
3. A manifest with a dead PID or a refused port is ignored, never deleted by clients. Only the
   lock holder rewrites it.
4. **Idle exit.** Connect exits 10 minutes after the last request when no app lease is active.
   There is no Windows service, no login autostart and no admin requirement in S2.

Launcher side (the native backend of Notes or Hub, never a webview). Each attempt runs these
steps in order. Every read of `bootstrap.key` and `instance.json` is fresh; neither is cached
between attempts, because restore rotates the key.

- **L1. Liveness probe.** If both files exist, send `GET /axis/v1/connect/status` signed with
  the bootstrap key (`X-Axis-Client: bootstrap`), with the manifest's `instanceId` and a 1 s
  timeout.
  - A 200 response with a valid bootstrap signature and the manifest's `instanceId`: Connect is
    **alive**. Go to L3.
  - A signed 409 `stale-instance`: reread the manifest and repeat L1, at most twice.
  - A refused connection, a timeout, a missing file, or an unsigned or badly signed response:
    not verified. Go to L2. An impostor on an old port lands here, because it cannot sign with
    the current bootstrap key.
- **L2. Spawn.** Spawn `axis-connect.exe serve` with an argument array, passing
  `DETACHED_PROCESS | CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP` through
  `std::os::windows::process::CommandExt`, so Connect outlives the launcher and Hub.
  - A missing binary: status `not-installed`. Stop.
  - The child exits with code 3 (another process holds the lock): do **not** wait for a new
    `instanceId`. Poll every 100 ms, for up to 5 s, for any manifest that passes L1. On
    success go to L3. Otherwise the status is `unavailable` with reason
    `connect-unverifiable` (the lock is held, but nothing answers verifiably; for example
    Connect is hung or still starting).
  - The child keeps running: poll every 100 ms, for up to 5 s, for a manifest whose
    `instanceId` differs from the one read in L1 (or any manifest if there was none) and that
    passes L1. On success go to L3. Otherwise the status is `unavailable` with reason
    `start-timeout`.
  - One spawn per attempt. After `unavailable` the app continues standalone and retries with
    backoff (5 s, 15 s, 60 s, then every 5 min). It never spawns in a tight loop.
- **L3. Credential check.** If the app has a stored credential, send the same status request
  signed with it.
  - A valid signed 200 with `clientState:"active"`: register and heartbeat (S2-D08).
  - A valid signed 200 with `clientState:"pending-approval"`: status `pending-approval`.
    Recheck every 60 s with the same credential; never re-pair while pending.
  - An unsigned 401: L1 has just proven Connect alive, so this means the credential is
    unknown, has a stale generation or is revoked. It never means "dead service". Go to L4.
  - No stored credential: go to L4.
- **L4. Pair** against the running instance (S2-D11). Automatic pairing runs at most once per
  attempt.
  - `active`: store the credential and register.
  - `pending-approval`: store the credential; status `pending-approval`.
  - `revoked`: status `unpaired` with reason `revoked`, and **no automatic retry**. Only the
    user's explicit "Pair again" in the app's native settings sends `/pair` with
    `reactivate:true` (S2-D11).

Resulting cases, each an acceptance test in T-044 (helper level) and T-049 (real apps):

- **First install:** no Connect home, no credential. L1 fails, L2 starts Connect, L4 pairs
  `active`, the app registers.
- **Connect already running, app never paired:** L1 succeeds, L3 finds no credential, L4 pairs.
  Assert that no `serve` child was spawned.
- **Credential invalid while Connect runs** (generation bumped, record deleted): L3 gets 401,
  L4 re-pairs. No spawn, and no exit-3 wait.
- **Revoked in Hub:** L3 gets 401, L4 returns `revoked`, the app shows `unpaired`, and nothing
  retries until the user clicks "Pair again".
- **Restore while the apps are closed:** the new bootstrap key is read fresh, L1 succeeds, L3
  gets 401, and L4 re-pairs automatically. Revoked installations stay revoked (S2-D19).
- **Restore while an app is running:** restore requires Connect stopped, so heartbeats fail
  with a refused connection. The next attempt goes L1 → L2 (new instance) → L3 (401) → L4.
- **Hung lock holder** (a test process holds `connect.lock` and writes no manifest): L2 exits 3,
  and the status is `unavailable`/`connect-unverifiable` within about 5 s, with exactly one
  spawn in that attempt.
- **Impostor on the old manifest port with no lock holder:** L1 fails, L2 starts a real
  instance, and the impostor receives only one signed status request (no secret, no body).

**Leases, heartbeat and stale instances (S2-D08).** `POST /apps/register` returns
`leaseExpiresAt` 30 s ahead. Apps heartbeat every 10 s. When the lease expires, the app's
status becomes `unavailable`. A register with a new `instanceId` replaces the previous instance
for that client. Later heartbeats or signed responses from the replaced instance get
`409 conflict` with message `stale-instance`, and Connect never routes to it again. When
Connect restarts, its new `instanceId` makes every request signed for the old instance fail.
Clients then reread the manifest and register again. Instances and leases live in memory
only; after a restart, apps re-register within one heartbeat interval.

## 4. Pairing, credentials and request authentication (S2-D09 – S2-D13)

**Why HMAC request signing (S2-D09).** Every request, and every response to an
authenticated request, is signed with a per-pairing secret, or with the bootstrap key for
status and pairing (SUITE_PROTOCOL.md "Response signing"). Both directions are authenticated, which gives mutual authentication without TLS on
loopback. Ordinary requests carry only signatures, never the secret, so a port squatter or a
stale service that receives a request cannot forge or reuse one. What this does and does not
protect:

- HMAC gives **integrity and authenticity, not confidentiality**. Request and response bodies
  (project names, search queries, snippets, paths in summaries) are plaintext on loopback. A
  squatter on an old port can read the one status request the launcher sends it, which has no
  body. Reading other loopback traffic requires packet capture, which needs administrator
  rights, or same-user code; both are out of scope (section 1).
- The per-client secret crosses the wire exactly once, in the pairing response, and only
  **sealed** with a key derived from the bootstrap key (S2-D11). Anyone who can read
  `bootstrap.key` and also captured that response can unseal it. There is no forward secrecy.
  Such a reader can already pair on their own, so this adds no new capability for that party.

The approved loopback HTTP/JSON transport stays.
Windows named pipes were considered and not chosen: the human approved loopback HTTP, and
Python adapters (S3) need the simpler transport. The exact header and canonical-string format
is normative in SUITE_PROTOCOL.md ("Request signing").

**Keys (S2-D10).**

- `clientSecret = HMAC-SHA256(masterKey, "axis-connect-client-v1|" + clientId + "|" + generation)`.
  Connect stores no per-client secrets, only `clientId`, `appId`, `installationId`,
  `generation`, the granted capabilities and the state. Revoking or re-pairing increments
  `generation`, which instantly invalidates the old secret.
- Apps store `{clientId, clientSecret}` in their own keychain namespace, never in a file,
  webview, URL or log:
  - Notes uses service `AXISNotes` (the retained namespace), entry `suite:connect-client`.
  - Hub uses service `AXIS Hub`, entry `connect-client`.
  - Test override: each app's existing memory-keys variable (`AXIS_AI_MEMORY_KEYS` for Notes;
    `AXIS_HUB_MEMORY_KEYS` for Hub).
- `bootstrap.key` authenticates only two requests, `GET /axis/v1/connect/status` (the
  liveness probe, S2-D07) and `POST /axis/v1/pair`, and Connect signs every response to them
  with it. A pending-approval client's `GET /connect/status` responses are signed with that
  client's secret; pending clients get an unsigned 401 on every other path. The normative
  list is SUITE_PROTOCOL.md "Response signing". It is rotated by `axis-connect revoke-all`
  and by restore.

**Pairing flow (S2-D11).** This is native-only; no webview, DOM or URL ever sees a secret.

1. The app's native backend reads `secrets\bootstrap.key` and sends a bootstrap-signed
   `POST /pair` with `{appId, installationId, displayName, appVersion, reactivate?}`.
   `installationId` is a random ID the app generates once and stores in its own app config
   folder. It sends `/pair` only after the L1 liveness probe has succeeded (S2-D07).
2. Connect grants capabilities from its **built-in table for that `appId`** (below). A request
   cannot ask for more. The outcome depends on the existing record for
   (`appId`, `installationId`):
   - None, and no other active installation of that `appId`: a new record in state `active`.
   - None, while another installation of that `appId` is active: `pending-approval`. It shows
     in Hub's Connected apps list, and the user must approve it. This limits confusion, not
     same-user malware (section 1).
   - `active` or `pending-approval`: the same state, with `generation` incremented and a new
     secret. This is the restore and lost-credential path.
   - `revoked`, without `reactivate:true`: the response is `{state:"revoked"}` with no secret,
     and the record is unchanged.
   - `revoked`, with `reactivate:true`: sent only from an explicit user action in the app's
     native settings. The record becomes `active` (or `pending-approval` under the rule
     above), with a new generation.
3. The response body has `clientId`, `generation`, `grantedCapabilities`, `state`,
   `connectInstanceId` and, except for `revoked`, `sealedSecret`. The response is signed with
   the bootstrap key. `sealedSecret` is
   `{alg:"chacha20poly1305-hkdf-sha256-v1", nonce, ciphertext}` (base64url), where:
   - the key is HKDF-SHA256 with the bootstrap key as input key material, the request's
     `X-Axis-Nonce` bytes as salt, and info `axis-connect-pair-v1|<clientId>|<generation>`;
   - `nonce` is 12 fresh random bytes;
   - the associated data is `<clientId>|<generation>|<installationId>`.

   The app verifies the response signature, unseals the secret, stores the credential and
   zeroes the plaintext buffer. Every primitive is in `ring` (`hkdf`, `aead`), which is already
   a candidate crate; no new dependency is needed. T-044 ships vectors for sealing and for
   rejecting a tampered seal.

4. Unpair from either side increments `generation`, and revoke sets the state to `revoked`.
   Restore rotates `bootstrap.key` and increments every generation, but keeps revocations
   (S2-D19). Active apps therefore re-pair automatically, and revoked apps do not.

**Capability table (S2-D12)**, enforced by Connect per request:

- `hub`: `apps.read`, `apps.approve`, `projects.read`, `projects.write`, `members.write`,
  `search.federated`, `resources.resolve`, `resources.open`.
- `notes`: `apps.register`, `projects.read`, `members.write` (Notes' own resources only:
  `ref.appId` must be `notes`), `resources.resolve` (own app only).
- `deck` and `calendar`: defined by T-053/T-056. Mutation capabilities such as
  `calendar → notes.task-completion` are added then, not in S2.
- Connect → adapter calls carry `X-Axis-On-Behalf-Of: <appId>`. Each adapter enforces its own
  allowlist per originating app. In S2, Notes allows `describe`, `resolve`, `search`, `open`
  and `changes` on behalf of `hub` and `connect`, and **no mutation on behalf of `hub`**.

**Endpoint validation (S2-D13).** A registration endpoint must be exactly
`http://127.0.0.1:<port>` with a port from 1024 to 65535: no hostname, path, userinfo, IPv6
or other scheme in S2. Connect then challenges it with a signed `GET /axis/v1/describe`. It
accepts the registration only if the response signature verifies with that client's secret,
`X-Axis-Instance` equals the registered `instanceId`, and the descriptor's
`appId`/`installationId` equal the pairing's. Connect never follows redirects and never calls
any other endpoint for that app.

**HTTP hygiene** (Connect and every adapter server, S2-D13 continued):

- Bind `127.0.0.1` only.
- `Host` must equal `127.0.0.1:<bound port>` exactly; anything else gets 403.
- Any `Origin`, `Referer`, `Sec-Fetch-Site` or `Sec-Fetch-Mode` header gets 403, before any
  other processing and before authentication.
- `OPTIONS` gets 403 and no CORS headers are ever sent.
- POST requires `Content-Type: application/json`.
- Limits: 256 KiB body, 16 KiB headers, 10 s read timeout.
- No redirects and no content sniffing: `X-Content-Type-Options: nosniff`,
  `Cache-Control: no-store`.
- Error bodies use only SuiteError codes and fixed messages, never paths, secrets or content.

## 5. Connect storage, revisions, idempotency and deletion (S2-D14 – S2-D18)

**Schema (S2-D14)**:

- `meta(key, value)`
- `clients(client_id PK, app_id, installation_id, display_name, generation, capabilities_json,
state[active|pending-approval|revoked], paired_at, revoked_at)`
- `projects(project_id PK, name, color, icon, revision INTEGER, created_at, updated_at,
created_by)`
- `project_members(project_id, app_id, collection_id, resource_id, added_at, added_by,
PK(project_id, app_id, collection_id, resource_id))`
- `project_tombstones(project_id PK, deleted_at, deleted_by, last_revision)`
- `project_changes(seq INTEGER PK AUTOINCREMENT, project_id, kind, revision, at)`
- `operations(client_id, operation_id, payload_sha256, status, result_json, created_at,
PK(client_id, operation_id))`

Each project mutation, its change row and its operation record commit in **one SQLite
transaction**.

**Revisions (S2-D15).** Project revisions are strings `r<n>`, where `n` increments on every
successful write to that project, including membership changes. Clients treat them as opaque.
Every write except create requires `expectedRevision`. A mismatch returns `409 conflict` and
the current project.

**Idempotency (S2-D16).** Operation records are keyed by (authenticated `clientId`,
`operationId`), where `operationId` is 16–64 characters of `[A-Za-z0-9_-]`. The record also
holds the SHA-256 of the canonical JSON of the mutation.

- Same key and same digest: replay the stored result.
- Same key and a different digest: `409 conflict`.
- Records are kept for at least 30 days, are included in backups, and are pruned only by age.
- Create is insert-only. Using an existing or tombstoned `projectId` is a conflict unless it is
  the identical replay.
- Project IDs are caller-issued `prj_` + 26 characters of `[a-z0-9]` (Hub generates 128 random
  bits).

**Limits (S2-D17)**:

- At most 1,000 projects and 5,000 members per project.
- Name: 1–80 characters after trimming, with no control characters.
- Colour: `#RRGGBB`.
- Icon: `builtin:<id>` from a list the Protocol crate ships, or `emoji:<one grapheme>`.
- `members.add` requires the owner adapter to resolve the ref to `ready` at add time.
  Otherwise the result is `unavailable` (`missing` when the owner answers missing). Later
  missing members stay listed and show as missing in Hub.

**Project deletion (S2-D18).** `delete` removes the project row and its member rows and writes
a tombstone and a `deleted` change, all in one transaction. It never calls any adapter
mutation, never deletes, moves or edits app content, and has no flag that could. Hub item
`projectIds` are Hub-owned data: Hub removes a deleted project's ID from its own items when it
reads the change. Notes has no project data in the vault; its badges come from Connect only.

**Change feed.** `POST /projects/changes {cursor?}` returns `{status:"ready", changes:[{kind:
"created"|"updated"|"members"|"deleted", projectId, revision}], nextCursor}`, or
`resync-required` when the cursor is older than the 30-day retention. Apps poll every 15 s
while one of their windows is visible, and immediately after their own writes.

**Backups (S2-D19).**

- Taken with the SQLite online backup API to `backups\connect-<UTC yyyyMMddTHHmmssZ>.db`:
  before every schema migration, on the first write of each UTC day, and on
  `axis-connect backup --out <file>`. The last 14 are kept.
- `axis-connect export --out <file.json>` writes a portable JSON of projects, members,
  tombstones and operation records. It excludes clients and secrets.
- `axis-connect restore --from <file>` works only while Connect is stopped (it takes the lock).
  It checks the backup's schema version and moves the current database aside to
  `backups\pre-restore-*.db`. It restores projects, members, tombstones, changes and operation
  records from the backup. The `clients` table is taken from the **current** database, so a
  revocation made after the backup survives the restore. Only if the current database is
  unreadable does it use the backup's `clients` table, and it reports that on stdout. It then
  rotates the bootstrap key and increments every generation. Apps re-pair through S2-D07 L4.

## 6. Federated search (S2-D20)

- Connect sends `POST /search` to each registered, available adapter whose descriptor
  advertises the requested mode. Unregistered or expired apps immediately produce
  `unavailable` groups, and adapters without the mode produce `unsupported` groups.
- Timing: the per-adapter timeout is 1,500 ms, the overall deadline is 2,500 ms, and at most
  6 calls run concurrently (one per app). v1 in S2 returns one JSON array of groups at
  completion or at the deadline, and slow adapters become `unavailable` with message
  `timeout`. Streaming NDJSON is a later optional capability `search.stream`, not required
  in S2.
- For project search, Connect loads the project and passes `memberFilter: {projectId,
projectRevision, refs}` containing only that app's refs (at most 5,000). The owner filters
  its own results. `projectId` alone is never sent as a database key.
- Group order is fixed (notes, deck, calendar, athena, ulap, hub). Scores are never compared
  across apps. Snippets are plain text of at most 200 characters.
- Hub native forwards groups to its UI. The UI shows ready groups, and `unavailable` or
  `unsupported` as explicit states, never as empty results.

## 7. AXISNotes durable identity (S2-D21 – S2-D26, T-045)

**Where identity lives (S2-D21).** The identity lives in the vault, so it travels with the vault
and survives index rebuilds, and outside `index.db`, which stays disposable. It is stored as
JSON, which is diffable and sync-friendly:

- `.axisnotes/suite/vault.json`: `{version:1, vaultId:"vlt_<26>", createdAt}`. `vaultId` is the
  suite `collectionId`.
- `.axisnotes/suite/identity.json`: `{version:1, revision:<n>, resources:{…}}`. Each resource
  entry is `{kind, path, noteId?, blockId?, state, lastSeen, createdAt, moves}`, where
  `moves` keeps the last 10 moves and `state` is `active`, `missing`, `removed` or
  `ambiguous`. `lastSeen` is the continuity evidence of S2-D24: `fingerprint`, `size`,
  `sketch`, `blockIds` and `at`.
- `.axisnotes/suite/provenance.json`: persistent derivative provenance (S2-D33).
- `.axisnotes/suite/journal.jsonl`: an intent journal for crash-safe renames and mutations.
- `.axisnotes/suite/operations.json`: idempotency records, kept 90 days and at most 5,000.
- `.axisnotes/suite/backups/identity-<ts>.json`: the last 10 snapshots, written before each
  compaction or migration.

The existing "everything in `.axisnotes/` is rebuildable" rule now has a documented exception:
`.axisnotes/suite/` and `.axisnotes/ai-policy.json` are authoritative. They are never deleted by
index rebuilds or schema resets. Generic `write_file`, `create_file`, `rename_entry` and
`trash_entry` commands refuse paths under `.axisnotes/suite/` and `.axisnotes/ai-policy.json`.
Only the native suite code writes them, atomically, with a process mutex. `.axisnotes/config.json`
stays writable by the generic commands, but its `ai.folders` key is native-owned (S2-D29). While a vault is
open, Notes holds `.axisnotes/suite/lock`, a non-blocking OS lock. A second AXISNotes process
opening the same vault runs the suite adapter read-only and says so.

**Minting (S2-D22).** Note, grid and canvas IDs are `res_<26>` (128 random bits from `ring`).
They are minted **lazily**: the first time a resource is returned by the adapter (search hit,
resolve, open), added to a project, or used as the source or destination of an applied AI
run (S2-D33). The AI case needs no Connect. The map therefore only grows with suite use, and no user
file is rewritten to hold an ID. The IDs are not embedded in Markdown. Fingerprints (SHA-256 of
bytes) are recorded as version evidence only, never as identity.

**Known renames (S2-D23).**

1. App rename or move (`rename_entry`, a folder rename or a link-rewriting rename): append
   `{op:"move", from, to, ids}` to the journal, rename, update `identity.json`, then mark the
   journal entry committed. On open, a pending entry is completed if `to` exists and `from`
   does not; otherwise it is discarded.
2. Watcher `renamed [from, to]` events while running are also known renames. The existing
   watcher logic that classifies atomic replaces as `modified` keeps identities across editor
   saves.
3. A folder rename updates every descendant entry's path by prefix.

**Unknown changes and continuity evidence (S2-D24).** A path plus a content hash cannot tell
"edited while Notes was closed" from "deleted and recreated while Notes was closed". S2 does
not claim to tell them apart. It keeps an ID bound to a file only on the evidence below, and
otherwise marks the entry `ambiguous` for the user to decide.

Evidence recorded in `lastSeen` whenever Notes writes, indexes or verifies an entry's file:

- `fingerprint`: SHA-256 of the bytes; `size`.
- `sketch`: a bottom-64 sketch of the distinct line hashes (the first 8 bytes of SHA-256) of
  non-blank, whitespace-trimmed lines. It keeps the 64 smallest values and stores no
  plaintext. A guessable short line can be confirmed from its hash. That is acceptable,
  because `identity.json` sits in the same vault as the note itself.
- `blockIds`: up to 64 `^blockId` markers present in the file.

Rules:

1. **Watched changes** (Notes running and its watcher healthy):
   - Modify events, and atomic replaces that the existing watcher classifies as `modified`,
     keep the ID. `lastSeen` is refreshed.
   - `renamed [from, to]` moves the ID (S2-D23).
   - A `removed` event marks the entry `missing`. A file created later at that path is a
     different resource and gets a **new** ID when it is minted. This is the only case in
     which S2 claims a fresh identity for a new file at an old path.
2. **Unwatched changes** (checked at vault open, and after a watcher error or overflow
   rescan). For each `active` entry:
   - The file is gone: `missing`.
   - The fingerprint is equal: continuity, and the ID is kept.
   - The fingerprint differs: continuity only if at least one `lastSeen.blockIds` marker is
     still present, or the estimated Jaccard similarity of the old and new sketches is at
     least 0.5, where each sketch has at least 3 distinct lines. Otherwise the entry becomes
     **`ambiguous`**, with the file at that path as its single candidate. The ID is not
     silently reused and is not silently dropped.
   - A different kind at the same path (for example `.md` changed to a folder): `missing`.
3. **Resolution:**
   - `ambiguous` entries resolve `ambiguous`, with `relinkCandidates`.
   - `missing` and `removed` entries resolve `missing`, with `relinkCandidates`: active files
     with the same fingerprint, or with the same file name and kind.
   - "Same note" is the explicit native command
     `suite_relink(resourceId, path, expectedIdentityRevision)`.
   - "Different note" is `suite_detach(resourceId, expectedIdentityRevision)`. The old ID
     becomes `missing` with no path, and the file is free to be minted as a new resource.
   - There is never automatic rebinding, even on a unique fingerprint match.
4. **Known limits, stated in the docs:**
   - A file deleted and recreated offline with mostly the same lines, or with a surviving
     block ID, keeps the old ID.
   - A heavily rewritten note that was edited offline becomes `ambiguous` and needs one click.
   - Both outcomes are visible, and neither is silent: continuity is decided only by the
     evidence above.

Tests (T-045 M1): the offline cases are run with the watcher stopped. They cover: an append
edit (kept); a delete-and-recreate with unrelated content (`ambiguous`); a delete-and-recreate
with a retained `^blockId` (kept); a tiny file under 3 lines that changed (`ambiguous`); a
watched delete then create (a new ID, with the old ID `missing`); relink and detach; and
`lastSeen` containing no plaintext (assert that canary lines are absent from
`identity.json`).

**Copied vaults and duplicated block IDs (S2-D25).** The per-device app config file
`suite-vaults.json` maps `vaultId` to the last known path.

- If a vault opens with a known `vaultId` at a different path while the old path still has the
  same `vault.json`, the vault is a copy, and its refs resolve `ambiguous`. The user chooses
  either "This is a copy: new identity" (reissue `vaultId`, keeping resource IDs under the new
  collection) or "This is the original".
- If the old path is gone, the vault is recorded as moved, with a visible notice.
- For tasks: when a `blockId` is found on more than one task line, that task ref resolves
  `ambiguous` until it is relinked.

**Stable task anchors (S2-D26).** A task resource is `{kind:"task", noteId, blockId}` with
ID `tsk_<26>`, resolved by finding `^blockId` in the note that `noteId` currently points to.

- Minting requires a block ID on the task line. If one exists it is reused. Otherwise the
  explicit command `suite_task_anchor(path, line, raw, expectedRevision)` appends ` ^xxxxxx`
  (the existing 6-character base-36 block ID convention from T-013). Nothing is written
  unless the line still equals `raw` and the note revision matches.
- This is the only content write T-045 introduces. It is opt-in per task and uses standard
  Obsidian block syntax.
- Revisions:
  - A note's revision is `sha256:<hex of file bytes>`.
  - A task's revision is `sha256:<hex of the task line>`, so unrelated edits elsewhere in
    the note do not conflict.
  - Clients treat both as opaque.

## 8. AXISNotes exact AI policy (S2-D27 – S2-D33, T-045)

**Policy file (S2-D27).** `.axisnotes/ai-policy.json` is written only by native commands:

```json
{
  "version": 1,
  "revision": "p7",
  "rules": {
    "School": {
      "mode": "allow",
      "operations": ["read", "suggest", "apply"],
      "executions": ["cloud", "on-device"],
      "models": [
        { "providerId": "openai", "endpointId": "ep_…", "modelId": "gpt-6-sol" },
        { "providerId": "ollama", "endpointId": "ep_…", "modelId": "llama3.3:8b" }
      ]
    },
    "Medical": {
      "mode": "allow",
      "operations": ["read", "suggest"],
      "executions": ["on-device"],
      "models": [{ "providerId": "ollama", "endpointId": "ep_…", "modelId": "llama3.3:8b" }]
    },
    "Private": { "mode": "deny" }
  }
}
```

Parsing is strict: unknown fields, unknown versions, unknown enum values, duplicate keys or a
non-string revision make **that rule** invalid. An invalid rule denies its subtree, and an
invalid top level denies the whole vault. An empty list allows nothing. `models:"any"` must be
explicit.

**Inheritance is intersection (S2-D28).** A source's effective policy is the intersection of
every rule on its ancestor chain (root to file), not "most specific wins". The only way to
widen a child is a rule with `"inherit": false`. It can be created only by the native command
with `confirmWidening: true` after the UI shows the diff, and it records `reviewedAt`.
Migration never creates such a rule.

**Legacy rules are kept and intersected (S2-D29).** Legacy `ai.folders` in
`.axisnotes/config.json` stays in place, is still read, and is never rewritten or erased by
migration. It translates as follows: `any` allows all operations, executions and models;
`local` allows only `on-device`; `never` denies. The effective policy is **legacy ∩ new
policy**. Two behaviour changes follow, both stricter, both reported in the Notes UI's
migration notice and neither applied silently to files:

- Legacy child widening (`Journal: local`, `Journal/Public: any`) now intersects, so
  `Journal/Public` becomes local-only.
- `local` no longer accepts arbitrary localhost gateways (S2-D31).

Fail-closed cases:

- Unreadable or invalid `config.json`: status `unavailable`, and all AI is denied for the
  vault. Today it fails open; T-045 fixes this.
- An unknown legacy value such as `"sometimes"` denies that subtree. Today it is dropped.
- A deleted `ai-policy.json` that `suite-vaults.json` recorded as present denies until the
  user explicitly resets.

**Legacy rule writes are native-only (S2-D29a).** Today the webview changes `ai.folders` by
writing the whole `config.json` through `writeFile`. The config store serialises its full
in-memory copy (`src/app/config.ts` `update`), and on an invalid file it falls back to
defaults. So a stale copy, or one save after a failed load, can silently remove a `never` or
`local` rule. T-045 closes this in the native commands, and T-046 migrates the two UI writers:

- **Generic writes preserve `ai.folders`.** `write_file` and `create_file` targeting
  `.axisnotes/config.json`:
  - parse the incoming bytes. If they are not a JSON object, the write is refused with the typed
    error `InvalidConfig`, and the file is unchanged.
  - read the current file. If it exists but is unreadable or invalid, the write is refused with
    `ConfigUnreadable`, and the file is unchanged. AI is already denied (below), and this
    prevents a defaults-only save from erasing the legacy rules. The user repairs the file
    outside Notes. AI settings (T-046) show the `unavailable` policy status and its reason.
  - otherwise replace the incoming `ai.folders` value with the current on-disk value (absent
    stays absent), and write atomically. Every other key is written as sent. If the incoming
    `ai.folders` differed, Notes emits `suite://ai-rules-preserved`, so the UI reloads config
    instead of showing a rule that was not saved.

  Preserving the key, rather than rejecting the write, keeps unrelated settings (hotkeys,
  folder icons, the personal dictionary) working when the store holds a stale copy. Generic
  writes can neither widen nor narrow a legacy rule.

- `rename_entry` and `trash_entry` on `.axisnotes/config.json` are refused with
  `ProtectedPath`.
- **Native rule command.** `suiteAiSetLegacyRule` takes `expectedConfigRevision`, `path`,
  `value` (`any`, `local`, `never` or null) and `confirmWidening`. The revision is
  `sha256:<hex of the file bytes>`.
  - Narrowing (adding `local` or `never`, `any` → `local`/`never`, `local` → `never`) needs no
    confirmation.
  - Widening (removing a `local` or `never` rule, `never` → `local`/`any`, `local` → `any`)
    returns `WideningNeedsConfirmation {diff}` unless `confirmWidening` is true. The file is
    left unchanged.
  - A stale revision returns `Conflict`.
  - It rewrites only `ai.folders[path]` under the process mutex, atomically. Other keys keep
    their values (key order may change).
- **Writer migration (T-046):** the Settings folder-rules list (`AiSettings.tsx`) and the file
  tree "AI access" menu (`FileTree.tsx`) call `suiteAiSetLegacyRule`, then reload the config
  store. No UI path writes `ai.folders` through `writeFile` afterwards.
- `memoryBackend` mirrors the preservation behaviour and reports `enforcement:"demo"`.
- **Out of reach, stated in the docs:** programs other than Notes (a text editor, a sync
  client) can still change `config.json`. Notes treats those edits as the user's own, and they
  take effect the next time the file is read. The strictness rules below still apply, so an
  invalid result denies all AI.

Tests (T-045 unit tests on the native commands; T-049 E2E through the real webview):

- A generic write that deletes `ai.folders.Medical:"never"` and changes a hotkey: the hotkey is
  saved, `never` remains on disk, AI for Medical stays denied, and the event fires.
- A generic write that changes `never` to `any`, or `local` to `any`: the on-disk rule is
  unchanged.
- A generic write while the current `config.json` is malformed: refused, and the bytes are
  unchanged.
- Stale store: narrowing through the native command, then a generic write carrying the old
  `ai.folders` plus a folder-icon change. The narrowed rule survives, and the icon is saved.
- The native command removes `never` without confirmation: `WideningNeedsConfirmation`, and the
  bytes are unchanged. With confirmation: removed, and other keys keep their values.
- The native command narrows without confirmation: applied.

**Exact identity (S2-D30).**

- `providerId` = `ProviderConfig.id`.
- `endpointId` = `ep_` + the first 16 hex characters of SHA-256 of the normalised effective
  base URL (lower-case scheme and host, default port removed, trailing `/` removed). Changing a
  base URL therefore changes `endpointId`, and old allowlist entries stop matching (fail
  closed).
- `modelId` = the exact model string sent. Aliases are not resolved. A provider-reported model
  that differs from the requested one is logged as a mismatch in the request log (metadata).

**Execution evidence (S2-D31).** The backend produces `AiCandidate.execution` from evidence,
never from a hostname or user agent:

- `cloud`, verified: the built-in cloud kinds (OpenAI, Anthropic, Gemini, OpenRouter), and any
  `custom` endpoint on a non-loopback host unless the user declares it `private-server` for
  that exact `endpointId`. A declaration applies only to policies that list that `endpointId`
  exactly.
- `on-device`, verified: only when all of these hold:
  - the provider kind is Ollama or LM Studio on a `127.0.0.1` or `::1` endpoint;
  - a runner probe with recorded HTTP fixtures (Ollama `/api/version` plus model details;
    the LM Studio equivalent) identifies the runner;
  - the selected model is present locally, with a digest or path;
  - no remote or cloud marker is present. T-045 must identify from fixtures which fields
    mark cloud-proxied models, such as Ollama cloud models. Absent or unrecognised evidence
    means unverified.

  The probe result is cached for 10 minutes and invalidated by any change to endpoint, model
  or settings. It is re-probed immediately before dispatch when the cache is older than 60 s.

- `unknown`, unverified: any other loopback endpoint (LiteLLM, custom gateways, proxies) and
  any failed probe. It is denied by every policy. Denial persists until the user explicitly
  reclassifies the endpoint as `cloud`; there is no "treat as on-device" option.

**Where checks happen (S2-D32).** A check runs:

- at `ai_plan`;
- **immediately before each dispatch**, including every fallback candidate, each evaluated
  independently;
- in `suiteAiApply` (S2-D33), before the write.

A policy or source revision that changed between plan and apply invalidates the run.

Sources are the UI-declared `sources`, plus `attach`, plus the Rust-computed closure of
embeds (`![[…]]`), block embeds and canvas note cards, to depth 5. A cycle or an unresolved
embed makes the source set incomplete, and the request is denied. Nothing is sent before the
check; the request log records only decision metadata.

**Effective policy of a resource** is the intersection of three things:

- its ancestor chain (S2-D28);
- the legacy rules (S2-D29);
- for each provenance source recorded for it (S2-D33), that source's **current** effective
  policy, computed recursively.

The recursion runs over the provenance graph to a fixed point. Intersection is idempotent, so
cycles terminate. Every check above uses this definition, and `suiteAiEffective` shows the
provenance entries in `chain` with `origin:"provenance"`.

**Persistent derivative provenance (S2-D33).** A check against the destination's current
policy at apply time is not enough. For example, a summary of a Medical note is applied into a
local-only note, that note's folder is later widened to cloud, and the summary is sent to the
cloud without Medical ever being checked. S2 therefore records conservative, per-resource
provenance in the vault and rechecks it on every later run.

- **Native apply commits provenance before any insert.** `ai_run` keeps a run record in
  native memory: `{runId, sourceIds, policyRevisions, finishedAt}`, held for 30 minutes.
  `suiteAiApply(runId, destinationPath)`:
  - rechecks the run's sources and the destination's current effective policy for the `apply`
    operation;
  - mints the destination's resource ID if it has none (S2-D22), and for a new file mints it
    when the file is created;
  - appends the run's source IDs to the destination's entry in
    `.axisnotes/suite/provenance.json` (atomic, under the process mutex);
  - only then returns `{applied:true, notice?}`.

  The UI performs the insert only after that success, through its existing mechanisms (editor
  transaction, `editNote`, canvas scene), so undo and canvas behaviour are unchanged. If the
  insert later fails or the user undoes it, the provenance stays. That over-restricts but
  never under-restricts. An unknown or expired `runId`, or a denied check, returns an error,
  and the UI must not insert. The same holds for `ProvenanceLimit` (below).

- **The prompt names the effect.** When the run's source intersection is narrower than the
  destination's own policy, the UI must show a native-provided sentence before apply, for
  example "Cell Biology.md will also follow Medical's AI rules: on-device model llama3.3:8b
  only". Declining cancels the apply. Confirming never widens anything; it accepts the
  narrowing.
- **Record format.** `provenance.json` holds `version` (1), `revision` and `resources`, which
  maps each destination ID to `{sources:[…]}`. Each source is
  `{resourceId, lastPath, snapshot, addedAt, runId}`. `snapshot` is the source's
  effective policy at apply time, in the `AiPolicyV1` shape (no content). Every entry carries
  a real source `resourceId`; there are no merged, synthetic or snapshot-only entries, because
  a record without an identity could no longer follow later tightening of that source.
- **Unique-source cap (fail closed).** A destination holds at most 256 entries, one per
  unique source `resourceId`. Entries are never removed except by `suiteAiClearProvenance`.
  - Reapplying a source already recorded for the destination deduplicates: no new entry is
    added. The existing entry keeps its `resourceId`, `lastPath`, `addedAt` and `runId`, and
    its `snapshot` becomes old ∩ new (never wider).
  - Under the process mutex, and before minting any ID or writing any file, `suiteAiApply`
    counts the union of the destination's recorded source IDs and the run's source IDs. If
    that union exceeds 256, it returns `ProvenanceLimit {limit:256, recorded, requested}`.
    Nothing is minted, `provenance.json` (bytes and `revision`) and `identity.json` are
    unchanged, and the UI inserts nothing. A run whose own source set exceeds 256 is refused
    the same way.
  - A `provenance.json` holding more than 256 entries for a destination, or an entry without a
    `resourceId`, is invalid and denies all AI for the vault (below).
  - The user's options are to apply into a different destination or to clear the
    destination's provenance with a confirmed widening. S2 never compacts provenance.
- **Resolving a source at check time:**
  - `active`: use its current effective policy. If the user deliberately widens Medical, the
    derivative follows.
  - `missing`, `removed` or `ambiguous`: use `snapshot` ∩ the current ancestor chain of
    `lastPath` ∩ (for `ambiguous`) every candidate's effective policy. A deleted source never
    loosens its derivatives.
  - An unreadable or invalid `provenance.json`, or one recorded as present in
    `suite-vaults.json` but now missing: deny all AI for the vault (status `unavailable`).
- **The destination's own identity:**
  - Provenance follows the resource ID through renames and moves (S2-D23).
  - If the destination entry becomes `ambiguous` (S2-D24), the file at that path still gets
    the restrictions until the user chooses.
  - If the destination is trashed, its entry is kept with the tombstone.
- **Clearing provenance is a widening.**
  `suiteAiClearProvenance(resourceId, expectedProvenanceRevision, confirmWidening)` removes a
  destination's sources only with `confirmWidening:true`, after the UI shows the diff. Editing
  or deleting the applied text does **not** clear provenance; the rule is deliberately
  conservative.
- **Apply paths.** Every UI path that inserts AI output into the vault calls `suiteAiApply`
  first. T-046 migrates these call sites:
  - Ask AI insert (`AskAi.tsx`);
  - Fix text apply (`FixText.tsx`);
  - note handwriting insert (`NoteHandwriting.tsx`);
  - note diagram insert (`NoteDiagram.tsx`);
  - the canvas handwriting and diagram inserts (`Canvas.tsx`, insert call sites only).

  This is an engineering rule for Notes' own UI, tested per call site. The Notes main webview
  is trusted code, and remote content has no IPC in Notes. The rule does not defend against a
  compromised webview.

- **Stated limitations:**
  - Output the user copies to the clipboard and pastes by hand is not tracked.
  - Provenance is per resource, not per span. A derivative restricts the whole destination
    file.
  - Span-level Markdown provenance, and provenance for cards, summaries, OCR and embeddings
    (S3/S4), are out of S2 scope.

Tests (T-045 native tests; T-049 E2E):

- **Destination widening:** apply a Medical-derived summary into `Local/Summary.md`
  (local-only). Widen `Local` to cloud with confirmation. Ask AI with `Summary.md` and a cloud
  model: blocked with reason `provenance`, and the mock cloud server receives zero requests.
- **Source tightening:** change Medical to `deny`. `Summary.md` is then denied for every model.
- **Source deleted, renamed or ambiguous:** still restricted by the snapshot or the current
  chain.
- **Destination renamed:** still restricted.
- **Clear provenance:** refused without `confirmWidening`; after it, the destination's own
  policy applies.
- **Unique-source cap boundary** (native vectors in T-045, acceptance in T-049), with sources
  `S001`–`S257`, each initially allowing the mock cloud model:
  - Apply runs until `Summary.md` records exactly 256 unique sources: all 256 entries are
    present, each with its own `resourceId`.
  - Reapplying a run over already-recorded sources succeeds and keeps 256 entries.
  - An apply whose run adds `S257`: `ProvenanceLimit`; `provenance.json` bytes and
    `revision` and `identity.json` are unchanged, and the UI inserts nothing.
  - Tighten `S001` (the first recorded) to `deny`: `Summary.md` is denied for every model.
    Restore it, then tighten `S256` (the last recorded): denied again. The mock cloud server
    receives zero requests.
  - A `provenance.json` with 257 entries for one destination, or an entry without a
    `resourceId`: all AI denied.
- **Refusals:** a stale or unknown `runId`, a denied check or `ProvenanceLimit` returns an
  error with no provenance or identity change, and the UI inserts nothing. T-046 asserts this
  for each call site and each refusal kind.
- `provenance.json` is refused by generic `write_file`. An invalid `provenance.json` denies
  all AI.

## 9. Notes IPC for T-046 (S2-D34 – S2-D36)

**Contract, owned by T-045.** The existing Backend interface
(`src/ipc/types.ts`) gets additive methods, with Rust commands of the same snake_case names:

- `suiteAiPolicy(): AiPolicyView`
  - `AiPolicyView` fields: `enforcement` (`"native-v1"` or `"demo"`), `status` (`"ok"` or
    `"unavailable"`), `message?`, `fileRevision` (string or null), `rules: RuleView[]`,
    `legacy: RuleView[]` and `migration: MigrationNote[]`.
  - `RuleView = {path, origin:"policy"|"legacy", valid, error?, rule}`
- `suiteAiEffective(paths: string[]): EffectivePolicyView[]`
  - `{path, ref?:ResourceRef, policy:AiPolicyV1, chain:{path, origin, rule}[]}`, where
    `origin` is `"policy"`, `"legacy"` or `"provenance"` (S2-D33)
- `suiteAiSetRule(expectedRevision, path, rule|null, confirmWidening:boolean): AiPolicyView`
  - errors: `Conflict` (stale revision), `WideningNeedsConfirmation {diff}`, `InvalidRule`
- `suiteAiSetLegacyRule(expectedConfigRevision, path, value, confirmWidening)`, where `value`
  is `"any"`, `"local"`, `"never"` or null: returns `AiPolicyView`, with the same errors
  (S2-D29a)
- `suiteAiApply(runId, destinationPath): {applied:true, notice?}`; its errors include
  `ProvenanceLimit {limit, recorded, requested}`. Also
  `suiteAiClearProvenance(resourceId, expectedProvenanceRevision, confirmWidening)` (S2-D33)
- Typed errors from the generic `writeFile`/`createFile` on `.axisnotes/config.json`:
  `InvalidConfig` and `ConfigUnreadable`. Event `suite://ai-rules-preserved` (S2-D29a).
- `suiteAiCandidates(): AiCandidateView[]`
  - Fields: `identity: AiModelIdentity`, `providerName`, `declaredLocation?` and
    `execution: {location, verified, evidence}`, where `evidence` is
    `{method, runner?, runnerVersion?, modelDigest?, checkedAt}`.
- `suiteAiProbe(endpointId)` and `suiteAiDeclareLocation(providerId, "private-server"|"cloud"|null)`
- `AiPlan` gains `decision`, `blocked:{identity, reason}[]` and `policyRevisions`. These are
  additive, so existing callers keep working.
- `suiteStatus()` returns `{enabled, connect, reason?, vaultId, readOnly}`. `connect` is one of
  `not-installed`, `disabled`, `starting`, `ready`, `unavailable`, `unpaired` or
  `pending-approval`. `reason` is `start-timeout` or `connect-unverifiable` for `unavailable`,
  and `revoked` for `unpaired` (S2-D07). `vaultId` may be null.
- `suitePairAgain()`: the explicit user action after revocation (sends `reactivate:true`).
- `suiteSetEnabled(enabled)`: Settings → AXIS Connect. It is **off by default in S2**, so the
  standalone app is unchanged unless the user turns it on.
- `suiteProjects(): ProjectBadge[]` and `suiteProjectsFor(paths): {path, projects:ProjectBadge[]}[]`
  - `ProjectBadge = {id, name, color, icon, revision}`
- `suiteProjectAddMember(projectId, expectedRevision, path)` and
  `suiteProjectRemoveMember(...)`. Notes native mints the ref and calls Connect.
- `suiteRelink(resourceId, path, expectedIdentityRevision)`,
  `suiteDetach(resourceId, expectedIdentityRevision)` (S2-D24) and `suiteTaskAnchor(...)`.
- Event `suite://projects-changed {revision}` is emitted after the poll or a write detects a
  change. Event `suite://status` is emitted on Connect state changes.

**Badge lifecycle (S2-D35).**

1. Badges load when the vault opens, if the integration is enabled and Connect is ready.
2. They refresh on `suite://projects-changed`.
3. While Connect is unavailable, the last loaded set is shown with a "stale" marker. It is
   in-memory only and never written to the vault.
4. A deleted project's badge disappears on the next refresh.
5. With the integration disabled, the UI shows no badges.
6. No badge action can edit note content.

**Demo honesty (S2-D36).**

- `memoryBackend` implements these methods with `enforcement:"demo"`. The UI must show
  "Demo: AI permissions are not enforced" for `demo`.
- The UI may show "Enforced by AXISNotes" only for `native-v1`, which only the Rust backend
  returns.
- T-046 must not start before T-045's IPC commit exists, and must not merge before T-045's
  enforcement is approved. A frontend-only build is never described as protecting Notes AI.

## 10. Notes adapter server (T-045)

- It runs only when the integration is enabled.
- It uses `tiny_http` on `127.0.0.1:0` in its own thread, with the same hygiene as Connect
  (S2-D13), and registers with Connect.
- It serves only the open vault. Refs for another `vaultId` resolve `unavailable` with message
  `collection-not-open`.
- `open` focuses the Notes window and opens the resource. If the ref belongs to a different
  vault, Notes asks the user before switching vaults, and never switches silently while there
  are unsaved changes.
- `search` uses the existing FTS index and applies `memberFilter`.
- `changes` is served from the journal-backed change log, with a 30-day cursor retention.
- Mutations: `notes.set-task-completed` is implemented and tested for idempotency and
  revision conflicts. In S2 it is allowed for no caller; Calendar is granted it in S5.

## 11. Hub native launch, sessions and AI (S2-D37 – S2-D42, T-047)

**App and storage (S2-D37).** The Hub is Tauri 2 + React/TypeScript + Vite, like Notes, with
bundle ID `app.axis.hub`. Hub has **no** HTTP server. Data lives in `%LOCALAPPDATA%\AXIS\Hub\`
(overridable by `AXIS_HUB_HOME`):

- `library.json`: sections and items with portable fields only (name, icon, colour, order,
  `projectIds`, website URL, `axis-resource` target), with a revision.
- `device.json`: per-item device mappings (executable path, args, `.lnk` path, file or folder
  path, browser ID, profile ID, session ID) and browser registrations. It is device-local and
  never synced.
- `sessions\<sessionId>\`: website session data folders. Device-local secrets; never backed up.
- `backups\`: the last 10 copies of `library.json` and `device.json`, taken before each write
  batch.

**Launch rules (S2-D38).**

- Only items the user configured can launch. The process API takes an **item ID**, never a
  path, argument or URL from the webview at launch time. The native side loads the mapping and
  launches it.
- `application`: `std::process::Command::new(exe).args(args)` with no shell. The executable
  must be an absolute path to an existing `.exe`; `.bat`, `.cmd`, `.ps1`, `.vbs`, `.js`,
  `.wsf`, `.hta`, `.msi`, `.scr` and `.com` are refused. It is detached, so Hub closing never
  closes it.
- `shortcut` (`.lnk`) and `file`/`folder` open with the OS default handler through the opener.
  An executable or script extension given as `file` is refused; it must be configured as
  `application`.
- `registered-uri`: the scheme must be in the user's registered allowlist, confirmed at setup.
  A built-in denylist can never be registered: `file`, `javascript`, `vbscript`, `data`,
  `ms-msdt`, `search-ms`, `search`, `ms-officecmd`, `ms-appinstaller`, `mk` and `its`.
- `website`: only `http` and `https` URLs with a host, no userinfo, at most 2,048 characters,
  and no reserved app/dev origin (S2-D39).
- `axis-resource`: resolved through Connect. If the owner is unavailable, Hub offers "Start
  AXISNotes" using its own configured Notes shortcut, then retries `open` for up to 15 s.
- Remote tabs, adapter responses and AI output can never create or change launch mappings.

**Examples (manual QA, not CI).** Gaming contains:

- Spotify: website `https://open.spotify.com`, opened in a Hub session.
- Discord: application `%LOCALAPPDATA%\Discord\Update.exe`, args
  `["--processStart","Discord.exe"]`.
- VALORANT: application `RiotClientServices.exe`, args
  `["--launch-product=valorant","--launch-patchline=live"]`.

These paths and flags are verified on the user's machine during QA. CI uses fixture executables.

**Website sessions and remote-tab isolation (S2-D39).**

- Each Hub session opens as a separate child webview labelled `site-<uuid>`, whose data
  directory is `sessions\<sessionId>` (Tauri's WebView `data_directory`, which is a separate
  WebView2 user-data folder on Windows). Two shortcuts with two sessions therefore never share
  cookies.
- T-047 starts with a spike that proves cookie isolation between two data directories on
  Windows before building the UI, and records the result.
- **Labels.** The Hub window is labelled `hub-window`. Inside it, the trusted UI is the child
  webview labelled `main`, and each site is a sibling child webview labelled `site-<uuid>`. No
  other label is ever given to the trusted UI.
- **Capability scope (webviews, not windows).** Tauri's capability reference states that a
  capability's `windows` list applies to _every_ webview in a matching window, regardless of
  its `webviews` list
  ([Capability reference](https://v2.tauri.app/reference/acl/capability/)). A
  `windows: ["main"]` (or `["hub-window"]`) entry would therefore grant the trusted UI's
  permissions to every sibling site webview. Hub's only capability file
  (`src-tauri/capabilities/main.json`) therefore sets `"webviews": ["main"]`, omits `windows`
  (or leaves it empty), has no `remote` key, and uses no wildcard labels. Site webviews match
  no capability.
- **Explicit command permissions.** Tauri's capabilities guide states that custom app commands
  are accessible to all windows and webviews by default unless they are declared through
  `AppManifest::commands`
  ([Capabilities](https://v2.tauri.app/security/capabilities/)). Hub's `build.rs` therefore
  lists every command registered in `invoke_handler` in
  `tauri_build::Attributes::new().app_manifest(AppManifest::new().commands(&[...]))`. The
  capability grants each generated `allow-<command>` permission explicitly to `main`, and only
  the plugin/core permissions the UI actually uses (no `core:default`-style bundles that were
  not reviewed). A Rust test parses the capability files and the command list, and it fails
  in these cases:
  - a registered command has no manifest entry or permission grant;
  - a capability names `windows`, `remote` or a wildcard;
  - any capability targets a label other than `main`.
- **Native guard on the invoking webview.** Every Hub command takes the invoking
  `tauri::Webview` and first rejects the call with `Forbidden` unless `webview.label() ==
"main"` and the webview's current URL has the app origin (below). The check uses the
  _Webview_ label, never the `Window` label, because a site webview's window label is
  `hub-window`, the same as the trusted UI's. The guard is defence in depth. The ACL is still
  the primary control, and a mis-scoped capability must not become a working exploit.
  Rejections are logged with metadata only (command name, webview label, time).
- **Reserved origins.** These origins belong to the app and are never loadable in a site
  webview:
  - `tauri://localhost` and any `tauri:` URL;
  - `http://tauri.localhost` and `https://tauri.localhost`;
  - any other `*.localhost` custom-protocol host Tauri serves on Windows (for example
    `ipc.localhost` and `asset.localhost`);
  - the configured dev app origin (`build.devUrl`, exact scheme, host and port), which is
    blocked in every build.

  Hosts are compared after URL parsing and normalisation (lower case, trailing dot removed,
  IDNA).

- **Navigation.**
  - `main`'s navigation handler allows only the app origin (the bundled origin, or `devUrl` in
    debug builds).
  - A site webview's handler allows only `http`/`https` URLs whose origin is not reserved. It
    refuses everything else, including `file:`, `data:`, `javascript:`, `blob:`, `about:`
    and every custom scheme.
  - The same check applies to the initial URL, redirects and new-window requests. Allowed
    new windows open in the same session's tab.
  - Saving a `website` item with a reserved origin is refused (S2-D38).
  - Downloads are denied in S2.
- This section specifies Hub only. It changes no runtime code and no existing Notes
  capability; Notes' `src-tauri/capabilities/default.json` is untouched by S2 design work.
- **Open in browser** is always visible and uses the item's chosen external browser or the
  default browser.
- "Clear session" closes the session's webviews and then deletes its folder.

**External browsers and profiles (S2-D40).**

- Browser kinds: `edge`, `chrome`, `brave`, `firefox` and `custom`. The executable path is
  detected from known install paths or chosen by the user.
- Profiles are read (read-only) from Chromium `Local State` `profile.info_cache` and Firefox
  `profiles.ini`.
- Profile IDs must match `^[A-Za-z0-9 ._-]{1,64}$`.
- Arguments are built as arrays from a template per kind: Chromium
  `["--profile-directory=<id>", <url>]`; Firefox `["-P", <id>, "-new-tab", <url>]`. T-047
  checks each flag against the vendor's documentation and records the sources.
- `default-browser` uses the OS opener with the URL only.

**Hub AI organisation suggestions (S2-D41).**

- AI is off by default. Hub has its own settings and keys (keychain service `AXIS Hub`, entry
  `ai-provider:<id>`).
- In S2 it ships only the OpenAI-compatible Chat Completions format, which covers BYOK
  endpoints, OpenRouter, Ollama and LM Studio. The same on-device evidence rules as S2-D31
  label the execution location.
- Input: section and item names and kinds, plus website **domains only** if the user opts in.
  Never paths, arguments, full URLs, session or profile IDs, or project membership details.
- Output must validate against a strict JSON schema with two arrays:
  - `moves`: `{itemId, toSectionId}` or `{itemId, newSectionRef}`.
  - `newSections`: `{ref, name, parentRef or parentId, icon?, color?}`.

  It is rejected if it has unknown fields, unknown IDs, cycles or names over 80 characters,
  or icons outside the allowlist.

- The user reviews every change. Applying uses the normal library mutations, and AI output can
  never add or modify targets.

**Hub ↔ Connect (S2-D42).** Hub native pairs and holds its credential. It follows the same
launcher steps L1–L4 (S2-D07) through `axis-connect-client`. The UI uses Tauri
commands such as `hub_projects`, `hub_project_mutate`, `hub_search`, `hub_open_resource`,
`hub_apps` and `hub_approve_app`. It never sees tokens or endpoints. `hub_search` returns
Connect's groups plus a local `hub` group built from Hub's own section and item names, so Hub
search still works while Connect is unavailable. The UI never builds Connect requests itself.

## 12. Task split, ownership and gates (S2-D43)

- **T-044** (Claude): AXIS-Protocol and AXIS-Connect repositories. Milestone M1 is the
  Protocol crate, signed-request helpers and vectors, tagged `protocol-v1.0.0`. M2 is the
  Connect service.
- **T-045** (Claude, this repository):
  - M1: identity and journal.
  - M2: adapter server and Connect client, after T-044 M1.
  - M3: AI policy, evidence and IPC contract.
  - Also aligns `src/suite/**`.
- **T-046** (Codex, this repository): AI settings, policy and project-badge UI, the migration
  of the legacy rule writers (S2-D29a), and the AI-output insert call sites (S2-D33). It starts
  after T-045's M3 IPC commit and merges only after T-045 is approved.
- **T-047** (Claude, AXIS-Hub): scaffold, IPC contract, memory backend (M1), then native
  launch, sessions, Connect client and AI. T-048 starts after M1.
- **T-048** (Codex, AXIS-Hub): frontend only.
- **T-049** (Claude): real-Tauri acceptance across both apps and Connect, cross-reviews of
  T-046/T-048, QA screenshots and the S2 checkpoint report. It starts after T-044 through
  T-048 are approved.

File ownership is exact in `.agents/TASKS.md`. No two tasks own the same file, with two
append-only exceptions: `docs/DECISIONS.md` (each task adds its own dated entry) and its own
row in `.agents/TASKS.md`. A task that needs a change in another task's file writes the
request in its handoff.

## 13. Unresolved, needing human input

1. Code signing for Connect, Hub and Notes (needed before caller-executable verification).
2. Publishing remotes and hosted CI for the new repositories.
3. Whether the Connect integration in Notes stays opt-in after S2.
4. Whether suite search should let users hide folders from Hub search (not required by S2).
5. IPv6 loopback and non-Windows packaging of Connect (after S2 acceptance on Windows).
