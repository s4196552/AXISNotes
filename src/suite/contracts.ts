/** Proposed AXIS Connect v1 contracts. Backends enforce these; no service is started here. */
export const SUITE_PROTOCOL_VERSION = 1 as const;
export const SUITE_APP_IDS = ["hub", "notes", "deck", "calendar", "athena", "ulap"] as const;
export type SuiteAppId = (typeof SUITE_APP_IDS)[number];
export type ClientPlatform = "windows" | "macos" | "linux" | "android" | "ios" | "web";

/** Owner-issued opaque IDs, independent of paths and rebuildable SQLite row IDs. */
export interface ResourceRef {
  appId: SuiteAppId;
  collectionId: string;
  resourceId: string;
}
export type ResourceAnchor =
  { kind: "block"; blockId: string } | { kind: "media-time"; milliseconds: number };
export interface ResourceTarget {
  ref: ResourceRef;
  anchor?: ResourceAnchor;
}
export type ResourceKind =
  | "note"
  | "grid"
  | "canvas"
  | "task"
  | "deck"
  | "card"
  | "calendar-block"
  | "document"
  | "image"
  | "video"
  | "tool";
export interface ResourceSummary {
  ref: ResourceRef;
  kind: ResourceKind;
  title: string;
  revision: string;
}
export type ResourceResolution =
  | { status: "ready"; resource: ResourceSummary }
  | { status: "missing"; ref: ResourceRef }
  | { status: "ambiguous"; ref: ResourceRef; candidates: ResourceSummary[] }
  | { status: "blocked" | "unavailable"; ref: ResourceRef; message: string };
export interface SuiteProject {
  id: string;
  name: string;
  /** Validated #RRGGBB; item-level explicit colours override this display default. */
  color: string;
  icon: string;
  revision: string;
  members: ResourceRef[];
}

export type WebsiteOpening =
  | { kind: "hub-session"; sessionId: string }
  | { kind: "default-browser" }
  | { kind: "browser-profile"; browserId: string; profileId: string };
/** Native paths, launch arguments and session/profile mappings are device-local. */
export type HubLaunchTarget =
  | { kind: "website"; url: string; opening: WebsiteOpening }
  | { kind: "application"; executable: string; args: string[] }
  | { kind: "shortcut"; path: string }
  | { kind: "registered-uri"; uri: string }
  | { kind: "file"; path: string; viewerId?: string }
  | { kind: "folder"; path: string }
  | { kind: "axis-resource"; target: ResourceTarget };
export interface HubSection {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  color?: string;
  icon?: string;
}
export interface HubItem {
  id: string;
  sectionId: string;
  name: string;
  icon: string;
  order: number;
  projectIds: string[];
  target: HubLaunchTarget;
}

export type AiOperation = "read" | "suggest" | "apply";
export type AiExecutionLocation = "on-device" | "private-server" | "cloud";
export interface AiModelIdentity {
  providerId: string;
  endpointId: string;
  modelId: string;
}
/** Execution evidence must come from the owning backend, never the web client. */
export interface AiCandidate {
  identity: AiModelIdentity;
  execution: { location: AiExecutionLocation | "unknown"; verified: boolean };
}
/** Effective source policy, including inherited restrictions and derivative provenance. */
export type AiPolicyV1 =
  | {
      version: 1;
      mode: "allow";
      revision: string;
      operations: AiOperation[];
      executions: AiExecutionLocation[];
      models: "any" | AiModelIdentity[];
    }
  | { version: 1; mode: "deny"; revision: string }
  | { version: 1; mode: "unavailable"; message: string };
export interface SourceProvenance {
  target: ResourceTarget;
  sourceRevision: string;
  policyRevision: string;
}
export type AiDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "missing-policy"
        | "invalid-policy"
        | "policy-unavailable"
        | "ai-denied"
        | "invalid-candidate"
        | "unverified-execution"
        | "execution-denied"
        | "model-denied"
        | "operation-denied";
    };

export type AdapterCapability =
  | "resources.resolve"
  | "resources.open"
  | "resources.changes"
  | "search.keyword"
  | "search.semantic"
  | "notes.task-completion"
  | "deck.source-cards"
  | "deck.study-workload"
  | "calendar.study-blocks"
  | "ai.byok"
  | "ai.on-device"
  | "ai.private-server";
export interface AppDescriptor {
  protocolVersion: typeof SUITE_PROTOCOL_VERSION;
  appId: SuiteAppId;
  installationId: string;
  displayName: string;
  appVersion: string;
  platform: ClientPlatform;
  capabilities: AdapterCapability[];
}
export interface SearchRequest {
  query: string;
  mode: "keyword" | "semantic";
  projectId?: string;
  limit: number;
  cursor?: string;
}
export interface SearchHit {
  resource: ResourceSummary;
  /** Plain text; never render adapter-supplied HTML. */
  snippet: string;
  target: ResourceTarget;
}
export interface SearchPage {
  hits: SearchHit[];
  nextCursor: string | null;
}
export type SearchGroup =
  | { appId: SuiteAppId; status: "ready"; page: SearchPage }
  | { appId: SuiteAppId; status: "unavailable" | "unsupported"; message: string };
export interface ResourceChange {
  kind: "created" | "updated" | "relocated" | "removed" | "policy-changed";
  ref: ResourceRef;
  revision: string;
}
export type ChangePage =
  | { status: "ready"; changes: ResourceChange[]; nextCursor: string }
  | { status: "resync-required" };
export type SuiteErrorCode =
  | "unauthenticated"
  | "blocked"
  | "invalid-request"
  | "unsupported-version"
  | "unsupported-operation"
  | "conflict"
  | "not-found"
  | "unavailable";
export interface SuiteError {
  code: SuiteErrorCode;
  message: string;
}
export type SuiteResult<T> = { ok: true; value: T } | { ok: false; error: SuiteError };

/** Deck owns the due state; Calendar owns allocation of time to that workload. */
export interface StudyWorkload {
  id: string;
  deck: ResourceRef;
  revision: string;
  window: { start: string; end: string; timeZone: string };
  dueCount: number;
  estimatedMinutes: number;
}
export interface StudyBlockInput {
  workloadId: string;
  workloadRevision: string;
  deck: ResourceRef;
  start: string;
  end: string;
  timeZone: string;
}
export type SuiteMutation =
  | {
      kind: "notes.set-task-completed";
      task: ResourceRef;
      expectedRevision: string;
      completed: boolean;
    }
  | {
      kind: "deck.create-from-source";
      deck: ResourceRef;
      expectedRevision: string;
      source: ResourceTarget;
      sourceRevision: string;
    }
  | {
      kind: "calendar.upsert-study-block";
      blockId: string;
      expectedRevision: string | null;
      block: StudyBlockInput;
    };
export interface MutationRequest {
  /** Owner persists the operation ID and payload digest for idempotent retry. */
  operationId: string;
  mutation: SuiteMutation;
}
export interface SuiteAdapterV1 {
  describe(): Promise<SuiteResult<AppDescriptor>>;
  resolve(ref: ResourceRef): Promise<SuiteResult<ResourceResolution>>;
  search(request: SearchRequest): Promise<SuiteResult<SearchPage>>;
  open(target: ResourceTarget): Promise<SuiteResult<null>>;
  changes(cursor?: string): Promise<SuiteResult<ChangePage>>;
  mutate(request: MutationRequest): Promise<SuiteResult<ResourceSummary>>;
}

/** Create IDs are caller-issued; create is insert-only and operationId retries are idempotent. */
export type ProjectMutation =
  | { kind: "create"; projectId: string; name: string; color: string; icon: string }
  | {
      kind: "update";
      projectId: string;
      expectedRevision: string;
      name: string;
      color: string;
      icon: string;
    }
  | { kind: "delete"; projectId: string; expectedRevision: string }
  | {
      kind: "members.add" | "members.remove";
      projectId: string;
      expectedRevision: string;
      ref: ResourceRef;
    };
export interface ProjectMutationRequest {
  operationId: string;
  mutation: ProjectMutation;
}
export interface ProjectPage {
  projects: SuiteProject[];
  nextCursor: string | null;
}
export interface RegisteredApp {
  descriptor: AppDescriptor;
  status: "available" | "unavailable";
}
/** Native-only registration, authenticated and endpoint-challenged before acceptance. */
export interface AppRegistration {
  descriptor: AppDescriptor;
  endpoint: string;
  instanceId: string;
}
/** Authenticated liveness for the already-paired app/installation/service instance. */
export interface AppHeartbeat {
  appId: SuiteAppId;
  installationId: string;
  instanceId: string;
}
export interface SuiteConnectV1 {
  heartbeat(request: AppHeartbeat): Promise<SuiteResult<RegisteredApp>>;
  register(registration: AppRegistration): Promise<SuiteResult<RegisteredApp>>;
  apps(): Promise<SuiteResult<RegisteredApp[]>>;
  projects(limit: number, cursor?: string): Promise<SuiteResult<ProjectPage>>;
  mutateProject(request: ProjectMutationRequest): Promise<SuiteResult<SuiteProject | null>>;
  search(request: SearchRequest): Promise<SuiteResult<SearchGroup[]>>;
  resolve(ref: ResourceRef): Promise<SuiteResult<ResourceResolution>>;
  open(target: ResourceTarget): Promise<SuiteResult<null>>;
}

/** A content hash identifies a version, not the owning object's identity. */
export interface ContentFingerprint {
  algorithm: "sha256";
  digest: string;
  byteLength: number;
}
export interface MediaAnalysisLink {
  source: ResourceRef;
  analysis: ResourceRef;
  fingerprint: ContentFingerprint;
  pipelineVersion: string;
  modelIdentity?: AiModelIdentity;
  provenance: SourceProvenance[];
  status: "queued" | "running" | "ready" | "failed" | "stale" | "cancelled";
}
