import { backend, isBackendError, type VaultEntry } from "../../ipc";
import { useAppStore } from "../../app/store";
import { createUniqueNote } from "../commands/actions";
import { remapIcons } from "../files/renameEntry";

// Drafts: files the AI makes (an answer, a mind map, a quiz page) that aren't part of the
// user's notes until they choose to keep them. They live in the vault's hidden
// `.axisnotes/drafts/` folder, so they're out of the file tree, search and links, and the
// user saves them into a folder (a plain move) or discards them (to the OS trash).

export const DRAFTS_DIR = ".axisnotes/drafts";

export const isDraft = (path: string) => path.startsWith(`${DRAFTS_DIR}/`);

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** A file name from a title: no path or reserved characters, not too long. */
export function draftName(title: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|#^[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return clean || "AI draft";
}

const extOf = (path: string) => {
  const m = /\.[A-Za-z0-9]+$/.exec(path);
  return m ? m[0] : "";
};

export const baseName = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const ext = extOf(name);
  return ext ? name.slice(0, -ext.length) : name;
};

// ---- Where each draft was made (its suggested save folder), this device only ----

const ORIGINS_KEY = (root: string) => `axis.drafts.origins:${root}`;

function readOrigins(): Record<string, string> {
  const root = useAppStore.getState().vault?.root;
  if (!root) return {};
  try {
    return JSON.parse(localStorage.getItem(ORIGINS_KEY(root)) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeOrigins(map: Record<string, string>) {
  const root = useAppStore.getState().vault?.root;
  if (!root) return;
  try {
    localStorage.setItem(ORIGINS_KEY(root), JSON.stringify(map));
  } catch {
    // Without storage the suggestion falls back to the vault's top level.
  }
}

/** The folder a draft should be saved into by default. */
export function suggestedFolder(path: string): string {
  return readOrigins()[path] ?? "";
}

export interface DraftOptions {
  title: string;
  content: string;
  /** ".md" (default) or ".html". */
  ext?: string;
  /** The folder the draft belongs with (usually the note the AI ran in). */
  folder?: string;
  /** Open it in a tab (default true). */
  open?: boolean;
}

/** Write a draft and (by default) open it. Returns its path. */
export async function createDraft(o: DraftOptions): Promise<string> {
  const path = await createUniqueNote(DRAFTS_DIR, draftName(o.title), o.content, o.ext ?? ".md");
  if (o.folder) writeOrigins({ ...readOrigins(), [path]: o.folder });
  if (o.open !== false) useAppStore.getState().openFile(path);
  return path;
}

/** The folder of a vault path ("" for the top level). */
export const folderOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/** Keep a draft: move it into `folder` as `name`, picking a free name, and follow it. */
export async function saveDraft(path: string, folder: string, name: string): Promise<string> {
  const ext = extOf(path);
  const base = draftName(name);
  for (let i = 0; i < 1000; i++) {
    const to = join(folder, `${i === 0 ? base : `${base} ${i}`}${ext}`);
    try {
      await backend.renameEntry(path, to);
      await remapIcons(path, to);
      const store = useAppStore.getState();
      await store.refreshTree();
      store.onEntryRenamed(path, to);
      const origins = readOrigins();
      delete origins[path];
      writeOrigins(origins);
      return to;
    } catch (e) {
      if (!(isBackendError(e) && e.code === "AlreadyExists")) throw e;
    }
  }
  throw new Error("Couldn't find a free name for the draft.");
}

/** Throw a draft away (to the OS trash) and close it. */
export async function discardDraft(path: string) {
  await backend.trashEntry(path);
  const origins = readOrigins();
  delete origins[path];
  writeOrigins(origins);
  useAppStore.getState().onEntryRemoved(path);
}

/** Every folder in the vault, for the "Save to" choice ("" = top level). */
export function vaultFolders(tree: VaultEntry | null): string[] {
  const out: string[] = [""];
  const walk = (e: VaultEntry) => {
    for (const c of e.children ?? [])
      if (c.kind === "dir") {
        out.push(c.path);
        walk(c);
      }
  };
  if (tree) walk(tree);
  return out;
}
