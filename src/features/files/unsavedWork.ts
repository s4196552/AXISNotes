// Every open document (notes, grids, canvases, editable embeds) registers here so that
// something about to close the app — installing an update (T-073) — can save them all
// first and find out what could not be saved.

/** Why a document still has changes that aren't on disk. */
export type UnsavedReason = "conflict" | "removed" | "failed";

export interface UnsavedDocument {
  /** Vault-relative path of the file the changes belong to. */
  path: string;
  reason: UnsavedReason;
}

/** Saves now (skipping the autosave delay) and reports what is still unsaved, if anything. */
export type Flush = () => Promise<UnsavedDocument | null>;

const flushes = new Set<Flush>();
/** Writes started by documents that have already closed (their unmount flush). */
const closing = new Set<Promise<UnsavedDocument | null>>();

/** Register an open document; returns the function that unregisters it. */
export function registerDocument(flush: Flush): () => void {
  flushes.add(flush);
  return () => flushes.delete(flush);
}

/** Track a final write made while a document closes, so `saveAll` waits for it. */
export function trackClosingWrite(path: string, write: Promise<unknown>) {
  const op: Promise<UnsavedDocument | null> = write.then(
    () => null,
    () => ({ path, reason: "failed" }),
  );
  closing.add(op);
  void op.finally(() => closing.delete(op));
}

/** How many times a document is saved again when it keeps changing while it saves. */
export const SAVE_ATTEMPTS = 3;

/**
 * Save every open document now and wait for the writes, including those of documents
 * that just closed. Returns the documents whose changes are still not on disk (an
 * unresolved conflict, a moved/deleted file, or a failed write), at most one per path.
 */
export async function saveAll(): Promise<UnsavedDocument[]> {
  const results = await Promise.all([
    ...[...flushes].map((flush) => flush().catch((): UnsavedDocument | null => null)),
    ...closing,
  ]);
  const byPath = new Map<string, UnsavedDocument>();
  for (const r of results) if (r && !byPath.has(r.path)) byPath.set(r.path, r);
  return [...byPath.values()];
}

const REASON_TEXT: Record<UnsavedReason, string> = {
  conflict: "changed on disk",
  removed: "moved or deleted",
  failed: "couldn’t be saved",
};

function displayName(path: string) {
  return path.toLowerCase().endsWith(".md") ? path.slice(0, -3) : path;
}

/** "“School/Biology” (changed on disk), “Budget.axgrid” (couldn’t be saved)" */
export function describeUnsaved(docs: UnsavedDocument[]): string {
  return docs.map((d) => `“${displayName(d.path)}” (${REASON_TEXT[d.reason]})`).join(", ");
}

/** For tests. */
export function resetUnsavedWork() {
  flushes.clear();
  closing.clear();
}
