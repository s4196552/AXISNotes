# AXIS Connect protocol v1

Status: proposed implementation contract for suite phases S2–S5. The types and executable
reference helpers are in [src/suite](../src/suite/contracts.ts). No HTTP server or adapter
is implemented by T-042. All backend payloads require runtime validation; TypeScript types
alone provide no trust boundary. Rust/Python ports must share these acceptance vectors.
T-043 added the concrete S2 refinements in the "v1 refinements" section below; the rationale
and storage design are in [S2_FOUNDATION.md](S2_FOUNDATION.md). Where they differ from an
earlier sentence, the refinement governs.

## Transport, discovery and trust

- Native backends bind only to loopback, never 0.0.0.0 or LAN interfaces. In S2 they bind
  IPv4 `127.0.0.1` only; IPv6 loopback is a later optional addition. Validate Host against the service's advertised address/port to prevent
  DNS rebinding. No unauthenticated endpoints, including discovery/health.
- Persist a local endpoint/instance manifest protected by the user's filesystem ACL. A
  trusted native launcher starts Connect under a single-instance lock and reads readiness.
  The manifest contains an address and instance ID, never a transferable remote login.
- Generate high-entropy per-installation pairing credentials. Connect and each adapter
  authenticate both sides; registrations cannot supply arbitrary remote URLs. Connect
  challenges the loopback endpoint and binds app ID/installation/capabilities to the paired
  identity. Scope credentials by caller and supported operation; Hub cannot impersonate Notes.
- Pairing secrets belong in native process memory or the OS keychain, never in web code,
  query strings or logs. Ordinary requests and responses carry only HMAC signatures (see
  "Request signing"), never the secret. The secret crosses the wire once, AEAD-sealed in the
  pairing response (see "Pairing"). HMAC gives authenticity and integrity, not confidentiality:
  bodies are plaintext on loopback. Rotate/revoke credentials on unpair/restore. Reject
  browser Origin requests and deny CORS/preflight. An Origin header is not authentication.
  A web client uses a distinct future pairing channel; never grant it these native tokens.
- Every URL is under /axis/v1. Unknown version returns unsupported-version; do not silently
  downgrade. Version 1 can add optional fields/capabilities; incompatible semantics require v2.
- All requests have bounded bodies/timeouts. Search limits are 1–100, pagination is owner-local,
  and remote text is plain text. Structured errors must not include paths, keys or source text.
  Recheck pairing, caller identity and operation capability for each request.

## Adapter endpoints

All operations return SuiteResult, with an ok value or structured error. Void values are
JSON null on the wire. Ready resolution is metadata only; no raw content-transfer API is
implicitly granted by search/resolve. Each adapter validates that refs belong to its app.

| Method/path (under /axis/v1) | Input                  | Result             | Required capability               |
| ---------------------------- | ---------------------- | ------------------ | --------------------------------- |
| GET /describe                | none                   | AppDescriptor      | paired caller                     |
| POST /resources/resolve      | ResourceRef            | ResourceResolution | resources.resolve                 |
| POST /resources/open         | ResourceTarget         | null               | resources.open                    |
| POST /search                 | SearchRequest          | SearchPage         | search.keyword or search.semantic |
| POST /changes                | optional opaque cursor | ChangePage         | resources.changes                 |
| POST /mutations              | MutationRequest        | ResourceSummary    | exact mutation capability         |

Open is a trusted native action. Adapter responses may not contain arbitrary launch commands,
shell arguments or URLs to execute. Notes opens its own known resource; Hub website/process
launch is a separate local user configuration capability, not an adapter mutation.

Connect endpoints: POST /apps/register (AppRegistration: paired descriptor, instance ID and
challenged loopback endpoint), POST /apps/heartbeat (AppHeartbeat: paired app ID, installation
ID and instance ID); GET /apps; POST /projects/list; POST /projects/create;
POST /projects/update; POST /projects/delete; POST /projects/members/add and /remove;
POST /search/federated; POST /resources/resolve and /open. Project create supplies an operation
ID, caller-issued project ID and name/colour/icon; all later writes supply operation ID,
project ID and expectedRevision. Create is insert-only: an existing project ID is conflict
unless the authenticated caller retries the identical persisted operation ID/payload.
Membership writes supply a ResourceRef. Delete has no content-delete flag or cascading app write.
Each response is versioned SuiteResult; reject duplicate IDs with different payloads.
Project listing uses a bounded limit and opaque cursor. Validate colours, icons and membership
limits; icons use a built-in ID or owned asset reference, never executable markup.

HTTP mapping: 200/201 success; 400 invalid-request; 401 unauthenticated; 403 blocked;
404 not-found; 409 conflict; 422 unsupported-operation; 426 unsupported-version;
503 unavailable. Missing resources are successful resolution status missing, not authentication
failure. Unsupported semantic search is explicit; never quietly reinterpret the user's mode.

## Identity and lifecycle

ResourceRef is the tuple appId/collectionId/resourceId. IDs are non-empty, case-sensitive
opaque strings. The reference key helper uses JSON tuple encoding to avoid separator
collisions. It is an internal map key, not a new URI that replaces existing Notes axis: links.
Anchors are a stable owner block ID or a non-negative finite millisecond offset. Adapters
validate that an anchor is supported by the resource kind and resolve missing anchors visibly.

Owner-maintained authoritative identity metadata survives derived-index rebuilds. A known
rename emits relocated with the same ref. Removal emits removed and leaves a tombstone or
missing resolution. A new object at the old path receives a new identity. A copied object
with duplicated embedded ID resolves ambiguous until an explicit owner-side relink selects
identity. Content fingerprints do not collapse distinct objects. Back up the identity map.

Revisions are owner-issued opaque concurrency tokens. Clients must not compare them as
timestamps or derive them from row IDs. Changes use opaque durable cursors; expired history
returns resync-required. Reconcile all existing refs after resync rather than assigning new
identities. Policy-changed invalidates pending AI decisions and derivative access caches.

## Federated search and failures

Connect queries eligible adapters concurrently, with independent request timeouts and a
bounded overall deadline. In v1 (S2) the response is one array of groups returned at
completion or at the deadline; streaming groups as they arrive is a later optional capability.
One failed, stopped or timed-out app produces an unavailable group. Unsupported modes produce unsupported. An empty successful
page is different from an unavailable service. Group by app and kind; do not compare
unrelated keyword/semantic scores across engines. Cursors are app-scoped.

For project search, Connect resolves the member set and each owner applies its allowed
members as a filter. projectId alone is not a backend database key. Confirm the project
revision when resolving membership. Owners may withhold restricted snippets or resources;
Connect does not reconstruct them from stale caches. Search/Open remain available standalone.

## Supported writes and retries

Mutation requests contain a caller-generated operationId. Owners transactionally persist
operation ID, authenticated caller, payload digest and outcome beside the owned data. Same
ID/same payload returns the original outcome; same ID/different payload is conflict. This
is required for restart recovery. Keep retry records backed up as authoritative metadata.
expectedRevision is mandatory for existing objects; stale requests are conflict. For
Calendar creation, expectedRevision:null means create only, never overwrite an existing ID.

| Mutation                    | Owner and capability             | Behaviour                                                                                                                      |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| notes.set-task-completed    | Notes / notes.task-completion    | Update the identified stable task at the supplied revision; Calendar never edits Markdown directly                             |
| deck.create-from-source     | Deck / deck.source-cards         | Review source snapshot at requested revision; preserve source provenance and permissions; owner authenticates source retrieval |
| calendar.upsert-study-block | Calendar / calendar.study-blocks | Create/update explicit blockId referencing Deck workload and revision; never alter review history                              |

There is no generic SQL, filesystem write or unrestricted content mutation. Reviewed card
refresh is a Deck-owned UI action in the first iteration. Source content acquisition for
cards is a separately authorized owner-to-owner operation with source/policy revision checks;
search capability is not permission to export source text. Cancellation cannot roll back an
already committed mutation; report the committed operation outcome.

## AI and provenance

AiPolicyV1 is the owner's resolved effective restriction. allow requires a policy revision,
execution allowlist, exact provider/endpoint/model allowlist (or explicitly any) and operation
allowlist. An empty list allows nothing. deny is AI:never. unavailable represents unreadable
rules; unknown versions/malformed lists deny. On-device, private-server and cloud are distinct.

For every source and derivative ancestor, owners return current effective policy and revision
through an explicitly authorized future provenance/read API. This baseline does not expose
medical content via Connect. The executing owner resolves these restrictions itself and
intersects them. Explicit widening requires reviewed owner-side action. No prompt, log,
snapshot, embedding or model input may be sent before permission is checked. Changed or
unavailable policies invalidate cached permissions. Local fallback is checked independently.

Backend-owned AiCandidate evidence identifies actual execution, not URL hostname. A proxy
or runner with unknown cloud behaviour is unverified; on-device-only operations deny it.
Policy recheck is mandatory immediately before dispatch and before applying output. The
reference authorizeAi function cannot discover missing sources or authenticate a caller:
source completeness, execution attestation and concurrency are backend responsibilities.
Legacy mapping is explicit: Any permits configured execution locations, Local only on-device,
Never denies. Existing user edit-approval controls remain independent from policy read/apply.

## Shared acceptance vectors

Use the TypeScript tests as initial vectors for Rust/Python implementations: punctuation-safe
stable identity, rename/index rebuild continuity, exact model/endpoint/provider checks,
medical+study intersection, no implicit apply, localhost cloud denial, unknown execution
denial, empty allowlists, invalid/unreadable rules and explicit legacy conversion. Add runtime
tests for unauthorized requests, pairing/revocation, hostile Origin/Host, scoped registrations,
remote Tauri denial, resync, races and mutation replay in their owning integration tasks.

## v1 refinements (T-043, normative for S2)

These are additive to v1. Older clients see no change in existing payload shapes, apart from
the new required authentication headers. The Protocol crate (`axis-suite-protocol`, see
[S2_FOUNDATION.md](S2_FOUNDATION.md) section 2) implements them and ships JSON vectors for
every rule below.

### Request pre-checks (before authentication)

Servers reject a request in this order, with fixed messages:

1. `Origin`, `Referer`, `Sec-Fetch-Site` or `Sec-Fetch-Mode` is present: 403 `blocked`.
2. The method is `OPTIONS`: 403 `blocked`. No CORS header is ever emitted.
3. `Host` is not exactly `127.0.0.1:<bound port>`: 403 `blocked`.
4. The path is not under `/axis/v1/`: 426 `unsupported-version` for `/axis/v<n>/`, otherwise
   404 `not-found`.
5. A POST whose `Content-Type` is not `application/json`, a body over 256 KiB or headers over
   16 KiB: 400 `invalid-request`.

### Request signing

Every request, including status, describe and health, carries:

- `X-Axis-Client`: the `clientId`, or `bootstrap` for `GET /connect/status` and `POST /pair`
  only. Connect signs responses to `bootstrap` requests with the bootstrap key.
- `X-Axis-Instance`: the `instanceId` of the service the caller believes it is addressing.
- `X-Axis-Timestamp`: Unix milliseconds.
- `X-Axis-Nonce`: 16 random bytes, base64url without padding.
- `X-Axis-Signature`: `v1=` + base64url(HMAC-SHA256(secret, canonical)).
- `X-Axis-On-Behalf-Of`: optional; set by Connect on adapter calls to the originating `appId`.

The canonical request string joins these fields with `\n` (LF), with no trailing newline:

1. `AXIS-v1-req`
2. The direction: `a2c` (app to Connect) or `c2a` (Connect to adapter).
3. The upper-case method.
4. The path, without a query string (v1 uses no query strings).
5. The `Host` value.
6. The `X-Axis-Instance` value.
7. The timestamp.
8. The nonce.
9. The `X-Axis-On-Behalf-Of` value, or an empty string.
10. Lower-case hex of SHA-256 of the exact body bytes (the digest of the empty string for GET).

The server rejects the request with 401 `unauthenticated` if:

- the client is unknown or revoked, or is pending approval and the request is anything other
  than `GET /connect/status`;
- the signature does not verify (compared in constant time);
- the timestamp is more than 60 s away from the server's clock; or
- the nonce was already seen from that client in the last 120 s.

If `X-Axis-Instance` does not equal the server's current instance, the result is 409
`conflict` with message `stale-instance`.

**Response signing (normative).** The server signs every response, success or error, to a
request whose key it has selected and whose signature verified. That covers exactly these
cases:

- a known, `active` client, on any path: signed with that client's secret;
- a `pending-approval` client, on `GET /axis/v1/connect/status` only: the 200 (with
  `clientState:"pending-approval"`) and any 409 `stale-instance`, signed with that client's
  secret, so a pending app can verify the state it shows;
- `bootstrap`, on `GET /axis/v1/connect/status` and `POST /axis/v1/pair` only: the status
  200, the pair result (`active`, `pending-approval` or `revoked`) and their errors, signed
  with the bootstrap key, so discovery (S2_FOUNDATION.md S2-D07 L1) and pairing can verify
  them.

A pending client on any other path, and `bootstrap` on any other path, gets an unsigned 401
`unauthenticated`; pending clients stay denied everywhere else. A signed response carries
`X-Axis-Instance` and `X-Axis-Signature: v1=` + base64url(HMAC-SHA256(key, canonical
response)), where the key is the one that signed the request. The canonical response string is
`AXIS-v1-res`, the direction, the request nonce, the decimal status and the hex SHA-256 of
the body, joined by LF. Clients discard any response whose signature does not verify and
treat the service as unavailable.

Pre-check errors and 401s for unknown or revoked clients are unsigned, because no secret has
been selected. Clients treat an unsigned 403 as `blocked`, and any other unsigned response as
`unavailable` or `unauthenticated`. They never trust its body.

### Pairing

`POST /axis/v1/pair`, signed with `bootstrap.key`, takes the body
`{appId, installationId, displayName, appVersion, reactivate?}`. Clients send it only after a
bootstrap-signed `GET /connect/status` has proven the instance alive (S2_FOUNDATION.md
S2-D07). It returns
`clientId`, `generation`, `grantedCapabilities`, `state`, `connectInstanceId` and an optional
`sealedSecret`, signed with the bootstrap key. `state` is `active`, `pending-approval` or `revoked`.

- Capabilities come from Connect's fixed per-app table (S2_FOUNDATION.md S2-D12), and a
  request cannot widen them.
- A repeated pair request for an `active` or `pending-approval` record with the same `appId`
  and `installationId` keeps its state, returns a new `generation` and invalidates the
  previous secret.
- For a `revoked` record, the response is `{state:"revoked"}` with no secret, unless the
  request sets `reactivate:true`. Clients set that only from an explicit user action.
- `sealedSecret` is `{alg:"chacha20poly1305-hkdf-sha256-v1", nonce, ciphertext}` (base64url):
  - the key is HKDF-SHA256 with the bootstrap key as input keying material, the request's
    `X-Axis-Nonce` bytes as salt, and info `axis-connect-pair-v1|<clientId>|<generation>`;
  - `nonce` is 12 random bytes;
  - the associated data is `<clientId>|<generation>|<installationId>`.
- This hides the secret from anyone without `bootstrap.key`. It gives no forward secrecy:
  anyone who later reads `bootstrap.key` and recorded the response can unseal it.
- Vectors cover sealing, a tampered seal, and each record state.

`POST /axis/v1/apps/approve {clientId}` and `/apps/revoke {clientId}` require the
`apps.approve` capability, which only Hub holds in S2.

### Registration, heartbeat and status

- `AppRegistration.endpoint` must be exactly `http://127.0.0.1:<port>`, with a port from 1024
  to 65535. Connect challenges it with a signed `GET /describe` (direction `c2a`). It accepts
  the registration only when the response signature verifies with that pairing's secret,
  `X-Axis-Instance` equals `instanceId`, and the descriptor's `appId`/`installationId` match
  the pairing. Connect never follows redirects.
- The registration and heartbeat results add `leaseExpiresAt` (ISO 8601 UTC). The lease is
  30 s and apps heartbeat every 10 s. A new `instanceId` replaces the previous one. Heartbeats
  from a replaced instance get 409 `conflict` with message `stale-instance`.
- `GET /axis/v1/connect/status` (any paired or pending client, or `bootstrap`) returns
  `protocolVersion`, `instanceId`, `connectVersion`, `protocolCrateVersion`, `startedAt` and
  an optional `clientState`. `clientState` (`active` or `pending-approval`) is present only for a
  client-signed request. A bootstrap-signed success proves liveness only. A client-signed 401
  after a bootstrap-signed success means the credential is invalid, never that the service is
  down.

### Projects

- Project IDs are caller-issued, `prj_` followed by 26 characters of `[a-z0-9]`. Revisions are
  opaque strings. A tombstoned ID cannot be created again, except by the identical replay of
  the original create operation.
- Operation IDs are 16–64 characters of `[A-Za-z0-9_-]`. Idempotency is keyed by the
  authenticated `clientId` plus the `operationId`, and compares the SHA-256 of the canonical
  JSON of the mutation. Records are retained for at least 30 days.
- `members.add` succeeds only when the owner resolves the ref to `ready`. When the owner is not
  running the result is `unavailable`; when the owner reports the ref missing, the result is
  `not-found`.
- `POST /projects/changes {cursor?}` returns `{status:"ready", changes, nextCursor}` or
  `{status:"resync-required"}`. Each change is `{kind, projectId, revision}`, where `kind` is
  `created`, `updated`, `members` or `deleted`. The retention is 30 days.
- Limits: 1,000 projects; 5,000 members per project; names of 1–80 characters with no control
  characters; colour `#RRGGBB`; icon `builtin:<id>` (an allowlist shipped in the crate) or
  `emoji:<one grapheme>`.

### Adapter search input

Connect → adapter `SearchRequest` may carry
`memberFilter: {projectId, projectRevision, refs: ResourceRef[]}`. It holds at most 5,000
refs, all belonging to the receiving app. The adapter returns only hits within `refs`. The
timing is fixed in S2: 1,500 ms per adapter, a 2,500 ms overall deadline, and group order
notes, deck, calendar, athena, ulap, hub.

### Resolution additions

`missing` and `ambiguous` resolutions may include `relinkCandidates: ResourceSummary[]` for
the owner's UI. Notes returns `ambiguous` when a file at a known path changed without enough
continuity evidence (S2_FOUNDATION.md S2-D24). Clients
must not rebind to a candidate automatically. The explicit relink happens in the owning app. An
adapter answering a ref for a collection that is not currently open returns `unavailable`
with message `collection-not-open`, not `missing`.

### Mutation authorization

Adapters enforce mutations per originating app (`X-Axis-On-Behalf-Of`), not only per
capability name. In S2 no originating app may call `notes.set-task-completed`; Calendar
receives it in S5. Hub never receives content mutations.
