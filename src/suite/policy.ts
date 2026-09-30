import type { AiCandidate, AiDecision, AiModelIdentity, AiPolicyV1 } from "./contracts";
import { isOpaqueId } from "./references";

const operations = ["read", "suggest", "apply"] as const;
const locations = ["on-device", "private-server", "cloud"] as const;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function model(value: unknown): value is AiModelIdentity {
  return (
    record(value) &&
    isOpaqueId(value.providerId) &&
    isOpaqueId(value.endpointId) &&
    isOpaqueId(value.modelId)
  );
}
/** Array.from exposes holes, so malformed sparse lists cannot evade validation. */
function list(value: unknown, check: (entry: unknown) => boolean): value is unknown[] {
  return Array.isArray(value) && Array.from(value).every(check);
}
export function isAiPolicy(value: unknown): value is AiPolicyV1 {
  if (!record(value) || value.version !== 1) return false;
  if (value.mode === "unavailable") return typeof value.message === "string";
  if (!isOpaqueId(value.revision)) return false;
  if (value.mode === "deny") return true;
  return (
    value.mode === "allow" &&
    list(value.operations, (op) => operations.some((known) => known === op)) &&
    list(value.executions, (loc) => locations.some((known) => known === loc)) &&
    (value.models === "any" || list(value.models, model))
  );
}
function candidate(value: unknown): value is AiCandidate {
  if (!record(value) || !model(value.identity) || !record(value.execution)) return false;
  const execution = value.execution;
  return (
    typeof execution.verified === "boolean" &&
    (execution.location === "unknown" || locations.some((known) => known === execution.location))
  );
}
function sameModel(a: AiModelIdentity, b: AiModelIdentity): boolean {
  return a.providerId === b.providerId && a.endpointId === b.endpointId && a.modelId === b.modelId;
}

/**
 * Reference policy evaluator for backend implementations, not a frontend security boundary.
 * Owners must supply every effective source/ancestor/provenance restriction, attest execution
 * location and recheck policy revisions before each dispatch, fallback and content write.
 * A source-free prompt requires an explicit user prompt policy rather than an empty list.
 */
export function authorizeAi(
  policies: readonly unknown[],
  proposed: unknown,
  requestedOperation: unknown,
): AiDecision {
  if (policies.length === 0) return { allowed: false, reason: "missing-policy" };
  if (!operations.some((known) => known === requestedOperation)) {
    return { allowed: false, reason: "operation-denied" };
  }
  if (!candidate(proposed)) return { allowed: false, reason: "invalid-candidate" };
  const location = proposed.execution.location;
  if (!proposed.execution.verified || location === "unknown") {
    return { allowed: false, reason: "unverified-execution" };
  }
  for (const policy of policies) {
    if (!isAiPolicy(policy)) return { allowed: false, reason: "invalid-policy" };
    if (policy.mode === "unavailable") return { allowed: false, reason: "policy-unavailable" };
    if (policy.mode === "deny") return { allowed: false, reason: "ai-denied" };
    if (!policy.executions.includes(location))
      return { allowed: false, reason: "execution-denied" };
    if (
      policy.models !== "any" &&
      !policy.models.some((entry) => sameModel(entry, proposed.identity))
    ) {
      return { allowed: false, reason: "model-denied" };
    }
    if (
      !policy.operations.includes("read") ||
      !policy.operations.some((op) => op === requestedOperation)
    ) {
      return { allowed: false, reason: "operation-denied" };
    }
  }
  return { allowed: true };
}

/** Explicit translation only; does not migrate or alter the existing Notes AI runtime. */
export function legacyAiPolicy(rule: "any" | "local" | "never", revision: string): AiPolicyV1 {
  if (!isOpaqueId(revision)) throw new TypeError("Policy revision is required");
  if (rule === "never") return { version: 1, mode: "deny", revision };
  if (rule !== "any" && rule !== "local") throw new TypeError("Unknown legacy AI policy");
  return {
    version: 1,
    mode: "allow",
    revision,
    operations: ["read", "suggest", "apply"],
    executions: rule === "local" ? ["on-device"] : [...locations],
    models: "any",
  };
}
