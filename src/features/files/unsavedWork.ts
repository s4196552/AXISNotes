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

interface Registered {
  flush: Flush;
  /** Names the document if its flush throws. */
  path: () => string;
}

const documents = new Set<Registered>();
/** Final writes of documents that have closed, still in flight. */
const closing = new Set<Promise<void>>();
/** Final writes that failed, by path: tried again by `saveAll` until one succeeds. */
const failed = new Map<string, () => Promise<unknown>>();

/** Register an open document; returns the function that unregisters it. A flush that
 *  throws counts as unsaved, so it never lets the app close. */
export function registerDocument(path: () => string, flush: Flush): () => void {
  const doc = { flush, path };
  documents.add(doc);
  return () => documents.delete(doc);
}

/**
 * Run (and track) the final write of a document that is closing, so `saveAll` waits for
 * it. `write` must reject when the changes didn't reach the disk; it is kept and tried
 * again by every `saveAll` until it succeeds or the file is saved another way.
 */
export function trackClosingWrite(path: string, write: () => Promise<unknown>): Promise<void> {
  const op = write().then(
    () => void failed.delete(path),
    (e: unknown) => {
      failed.set(path, write);
      throw e;
    },
  );
  const tracked = op.catch(() => {});
  closing.add(tracked);
  void tracked.finally(() => closing.delete(tracked));
  return op;
}

/** A document saved `path` completely: an earlier failed final write to it is settled. */
export function markSaved(path: string) {
  failed.delete(path);
}

/** How many times a document is saved again when it keeps changing while it saves. */
export const SAVE_ATTEMPTS = 3;

/**
 * Save every open document now and wait for the writes, including those of documents
 * that closed (failed ones are tried again). Returns the documents whose changes are
 * still not on disk — an unresolved conflict, a moved/deleted file, or a failed write —
 * at most one per path.
 */
export async function saveAll(): Promise<UnsavedDocument[]> {
  const open = await Promise.all(
    [...documents].map(({ flush, path }) =>
      flush().catch((): UnsavedDocument => ({ path: path(), reason: "failed" })),
    ),
  );
  await Promise.all(closing);
  for (const [path, write] of [...failed]) {
    try {
      await write();
      failed.delete(path);
    } catch {
      // still unsaved; reported below
    }
  }
  const byPath = new Map<string, UnsavedDocument>();
  for (const r of open) if (r && !byPath.has(r.path)) byPath.set(r.path, r);
  for (const path of failed.keys())
    if (!byPath.has(path)) byPath.set(path, { path, reason: "failed" });
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
  documents.clear();
  closing.clear();
  failed.clear();
}
