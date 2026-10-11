// Every open document (notes, grids, canvases, editable embeds) registers here so that
// something about to close the app — installing an update (T-073) — can save them all
// first and find out what could not be saved.

import { useAppStore } from "../../app/store";
import { backend, isBackendError } from "../../ipc";

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

/** Changes from a closed document whose final write failed. */
interface Unrecovered {
  /** The vault they belong to: they are only ever written while it is open. */
  vault: string | null;
  path: string;
  content: string;
}

const documents = new Set<Registered>();
/** Final writes of documents that have closed, still in flight. */
const closing = new Set<Promise<void>>();
/** Closed documents' changes that couldn't be written anywhere yet. */
const unrecovered = new Set<Unrecovered>();

/** The open vault's root. Documents note it when they load: by the time one closes, the
 *  app may already have switched to another vault. */
export const currentVault = () => useAppStore.getState().vault?.root ?? null;
const describe = (e: unknown) => (isBackendError(e) || e instanceof Error ? e.message : String(e));

/** Register an open document; returns the function that unregisters it. A flush that
 *  throws counts as unsaved, so it never lets the app close. */
export function registerDocument(path: () => string, flush: Flush): () => void {
  const doc = { flush, path };
  documents.add(doc);
  return () => documents.delete(doc);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `School/Biology.md` → `School/Biology (unsaved 2026-10-10 14-03-22).md` */
export function recoveryPath(path: string, now = new Date(), n = 1): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const [stem, ext] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${stem} (unsaved ${stamp}${n > 1 ? ` ${n}` : ""})${ext}`;
}

/** Keep `u.content` in a new file next to `u.path`. Never overwrites, and never writes
 *  into another vault. Returns the new file's path, or null if it couldn't be written. */
async function recover(u: Unrecovered): Promise<string | null> {
  if (u.vault !== currentVault()) return null;
  const now = new Date();
  for (let n = 1; n <= 5; n++) {
    const target = recoveryPath(u.path, now, n);
    try {
      await backend.createFile(target, u.content, u.vault ?? undefined);
      useAppStore.getState().bumpIndex();
      return target;
    } catch (e) {
      if (!(isBackendError(e) && e.code === "AlreadyExists")) return null;
    }
  }
  return null;
}

/**
 * Run (and track) the final write of a document that is closing, so `saveAll` waits for
 * it; `write` must reject when `content` didn't reach the disk. Then the changes are kept
 * in a new "(unsaved …)" file next to the original instead of being lost, and the user is
 * told. If even that fails, `saveAll` tries again and reports them until it works.
 * `vault` is the one the document was loaded from: nothing is written while another
 * vault is open.
 */
export function trackClosingWrite(
  path: string,
  content: string,
  vault: string | null,
  write: () => Promise<unknown>,
): void {
  const u: Unrecovered = { vault, path, content };
  const op = (async () => {
    if (vault !== currentVault()) throw new Error("another vault is open now");
    await write();
  })().then(
    () => {},
    async (e: unknown) => {
      const kept = await recover(u);
      const name = `“${displayName(path)}”`;
      if (kept) {
        useAppStore
          .getState()
          .setError(
            `${name} couldn’t be saved (${describe(e)}), so your last changes were saved as “${displayName(kept)}”.`,
          );
      } else {
        unrecovered.add(u);
        useAppStore.getState().setError(`${name} couldn’t be saved: ${describe(e)}`);
      }
    },
  );
  closing.add(op);
  void op.finally(() => closing.delete(op));
}

/** How many times a document is saved again when it keeps changing while it saves. */
export const SAVE_ATTEMPTS = 3;

/**
 * Save every open document now and wait for the writes, including those of documents
 * that closed (changes not yet kept anywhere are tried again). Returns the
 * documents whose changes are still not on disk — an unresolved conflict, a moved/deleted
 * file, or a failed write — at most one per path.
 */
export async function saveAll(): Promise<UnsavedDocument[]> {
  const open = await Promise.all(
    [...documents].map(({ flush, path }) =>
      flush().catch((): UnsavedDocument => ({ path: path(), reason: "failed" })),
    ),
  );
  await Promise.all(closing);
  for (const u of [...unrecovered]) if (await recover(u)) unrecovered.delete(u);
  const byPath = new Map<string, UnsavedDocument>();
  for (const r of open) if (r && !byPath.has(r.path)) byPath.set(r.path, r);
  for (const { path } of unrecovered)
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
  unrecovered.clear();
}
