import { SUITE_APP_IDS, type ResourceRef } from "./contracts";

export function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isResourceRef(value: unknown): value is ResourceRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const ref = value as Record<string, unknown>;
  return (
    SUITE_APP_IDS.some((id) => id === ref.appId) &&
    isOpaqueId(ref.collectionId) &&
    isOpaqueId(ref.resourceId)
  );
}

/** Tuple encoding avoids collisions from punctuation in opaque IDs. */
export function resourceKey(ref: ResourceRef): string {
  if (!isResourceRef(ref)) throw new TypeError("Invalid AXIS resource reference");
  return JSON.stringify([ref.appId, ref.collectionId, ref.resourceId]);
}

export function sameResource(a: ResourceRef, b: ResourceRef): boolean {
  return resourceKey(a) === resourceKey(b);
}
