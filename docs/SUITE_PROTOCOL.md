# AXIS Connect protocol v1

Status: proposed implementation contract for suite phases S2–S5. The types and executable
reference helpers are in [src/suite](../src/suite/contracts.ts). No HTTP server or adapter
is implemented by T-042. All backend payloads require runtime validation; TypeScript types
alone provide no trust boundary. Rust/Python ports must share these acceptance vectors.

## Transport, discovery and trust

- Native backends bind only to loopback, never 0.0.0.0 or LAN interfaces. Support IPv4/IPv6
  loopback explicitly. Validate Host against the service's advertised address/port to prevent
  DNS rebinding. No unauthenticated endpoints, including discovery/health.
- Persist a local endpoint/instance manifest protected by the user's filesystem ACL. A
  trusted native launcher starts Connect under a single-instance lock and reads readiness.
  The manifest contains an address and instance ID, never a transferable remote login.
- Generate high-entropy per-installation pairing credentials. Connect and each adapter
  authenticate both sides; registrations cannot supply arbitrary remote URLs. Connect
  challenges the loopback endpoint and binds app ID/installation/capabilities to the paired
  identity. Scope credentials by caller and supported operation; Hub cannot impersonate Notes.
- Bearer tokens belong in native process memory/keychain or user-only credential files, not
  web code, query strings or logs. Rotate/revoke credentials on unpair/restore. Reject
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

Connect endpoints: POST /apps/register and POST /apps/heartbeat (paired installation identity,
descriptor and challenged local endpoint); GET /apps; POST /projects/list; POST /projects/create;
POST /projects/update; POST /projects/delete; POST /projects/members/add and /remove;
POST /search/federated; POST /resources/resolve and /open. Project create supplies an operation
ID and name/colour/icon; all later writes supply operation ID, project ID and expectedRevision.
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
bounded overall deadline. Emit groups as they become available; one failed/stopped app
produces an unavailable group. Unsupported modes produce unsupported. An empty successful
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
