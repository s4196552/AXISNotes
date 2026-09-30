import { describe, expect, it } from "vitest";
import type { AiCandidate, AiPolicyV1, ResourceRef } from "./contracts";
import { authorizeAi, isAiPolicy, legacyAiPolicy } from "./policy";
import { isResourceRef, resourceKey, sameResource } from "./references";

const cloud: AiCandidate = {
  identity: { providerId: "openai-study", endpointId: "openai-direct", modelId: "study-model" },
  execution: { location: "cloud", verified: true },
};
const local: AiCandidate = {
  identity: { providerId: "ollama-medical", endpointId: "this-device", modelId: "medical-model" },
  execution: { location: "on-device", verified: true },
};
const study: AiPolicyV1 = {
  version: 1,
  mode: "allow",
  revision: "study-r1",
  operations: ["read", "suggest"],
  executions: ["on-device", "cloud"],
  models: [cloud.identity, local.identity],
};
const medical: AiPolicyV1 = {
  ...study,
  revision: "medical-r1",
  executions: ["on-device"],
  models: [local.identity],
};
const ref: ResourceRef = { appId: "notes", collectionId: "vault-1", resourceId: "note-1" };

describe("durable resource identity", () => {
  it("survives renames and rebuilt index IDs", () => {
    const before = { ...ref, title: "Biology", rowId: 8 };
    const after = { ...ref, title: "Biology revision", rowId: 99 };
    expect(sameResource(before, after)).toBe(true);
  });
  it("distinguishes owners, collections and punctuation in IDs", () => {
    expect(sameResource(ref, { ...ref, appId: "athena" })).toBe(false);
    expect(sameResource(ref, { ...ref, collectionId: "vault-2" })).toBe(false);
    expect(resourceKey({ ...ref, collectionId: "a:b", resourceId: "c" })).not.toBe(
      resourceKey({ ...ref, collectionId: "a", resourceId: "b:c" }),
    );
  });
  it.each([
    null,
    [],
    {},
    { ...ref, appId: "unknown" },
    { ...ref, resourceId: "" },
    { ...ref, collectionId: " " },
  ])("rejects malformed references: %j", (value) => {
    expect(isResourceRef(value)).toBe(false);
  });
});

describe("source-specific AI permission contract", () => {
  it("allows cloud study access and local medical access", () => {
    expect(authorizeAi([study], cloud, "suggest")).toEqual({ allowed: true });
    expect(authorizeAi([medical], local, "suggest")).toEqual({ allowed: true });
  });
  it("intersects restrictions for mixed sources and derivative provenance", () => {
    expect(authorizeAi([study, medical], cloud, "read").allowed).toBe(false);
    expect(authorizeAi([study, medical], local, "read").allowed).toBe(true);
  });
  it.each(["providerId", "endpointId", "modelId"] as const)("requires the exact %s", (key) => {
    const proposed = { ...local, identity: { ...local.identity, [key]: "different" } };
    expect(authorizeAi([medical], proposed, "read")).toEqual({
      allowed: false,
      reason: "model-denied",
    });
  });
  it("does not grant write access from read/suggest or apply without read", () => {
    expect(authorizeAi([medical], local, "apply").allowed).toBe(false);
    expect(authorizeAi([{ ...medical, operations: ["apply"] }], local, "apply").allowed).toBe(
      false,
    );
  });
  it("treats an empty model allowlist as no allowed models", () => {
    expect(authorizeAi([{ ...medical, models: [] }], local, "read").allowed).toBe(false);
  });
  it("checks fallbacks independently", () => {
    expect(authorizeAi([medical], local, "read").allowed).toBe(true);
    expect(authorizeAi([medical], cloud, "read").allowed).toBe(false);
  });
  it("denies a localhost gateway forwarding inference to the cloud", () => {
    const gateway = { ...local, execution: { location: "cloud", verified: true } };
    expect(authorizeAi([medical], gateway, "read")).toEqual({
      allowed: false,
      reason: "execution-denied",
    });
  });
  it.each([
    { location: "on-device", verified: false },
    { location: "unknown", verified: true },
  ])("denies execution without backend evidence: %j", (execution) => {
    expect(authorizeAi([medical], { ...local, execution }, "read")).toEqual({
      allowed: false,
      reason: "unverified-execution",
    });
  });
  it("denies source-free operations without an explicit prompt policy", () => {
    expect(authorizeAi([], local, "read")).toEqual({ allowed: false, reason: "missing-policy" });
  });
  it.each([
    undefined,
    null,
    {},
    { ...medical, version: 2 },
    { ...medical, models: [{}] },
    { ...medical, models: new Array(1) },
    { ...medical, executions: ["local"] },
  ])("fails closed on invalid policy: %j", (policy) => {
    expect(isAiPolicy(policy)).toBe(false);
    expect(authorizeAi([policy], local, "read")).toEqual({
      allowed: false,
      reason: "invalid-policy",
    });
  });
  it("denies unreadable and never-AI source rules", () => {
    expect(
      authorizeAi(
        [{ version: 1, mode: "unavailable", message: "Unreadable rules" }],
        local,
        "read",
      ),
    ).toEqual({
      allowed: false,
      reason: "policy-unavailable",
    });
    expect(authorizeAi([legacyAiPolicy("never", "r1")], local, "read")).toEqual({
      allowed: false,
      reason: "ai-denied",
    });
  });
  it("rejects malformed candidates and unsupported actions", () => {
    expect(authorizeAi([medical], {}, "read")).toEqual({
      allowed: false,
      reason: "invalid-candidate",
    });
    expect(authorizeAi([medical], local, "delete")).toEqual({
      allowed: false,
      reason: "operation-denied",
    });
  });
  it("keeps private servers distinct from on-device execution", () => {
    expect(
      authorizeAi(
        [medical],
        { ...local, execution: { location: "private-server", verified: true } },
        "read",
      ).allowed,
    ).toBe(false);
  });
  it("translates legacy rules explicitly without changing the runtime", () => {
    expect(authorizeAi([legacyAiPolicy("any", "r1")], cloud, "read").allowed).toBe(true);
    expect(authorizeAi([legacyAiPolicy("local", "r1")], cloud, "read").allowed).toBe(false);
    expect(authorizeAi([legacyAiPolicy("local", "r1")], local, "read").allowed).toBe(true);
    expect(() => legacyAiPolicy("local", "")).toThrow();
  });
});
