import { EditorView } from "@codemirror/view";
import { backend, type Imported, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { attachmentDir, embedFor, mediaKind, pastedFileName } from "../../lib/attachments";
import { isNotePath } from "../../lib/markdown";
import { PATH_MIME } from "../../lib/fileKinds";
import { editNote } from "../files/editNote";
import { currentVault, keepForRetry, trackClosingWrite, trackPending } from "../files/unsavedWork";
import { getActiveEditor } from "./activeEditor";
import { notePath } from "./embeds";
import { linkTargetFor } from "./triggers";

// Getting images, video and audio into a note (T-075): paste, drag from the file tree,
// drop files from outside the app, or pick them from the command menu. New files go to
// the attachment folder (Settings → Files & links) and are embedded like Obsidian does,
// `![[Pasted image 20261013211845.png]]`.

const describe = (e: unknown) => (isBackendError(e) ? e.message : String(e));

/** The folder new attachments for the note in `view` go to. */
function folderFor(view: EditorView): string {
  return attachmentDir(useConfig.getState().config.attachments.folder, view.state.facet(notePath));
}

/** `lines` inserted into `text` at `pos`, each on a line of its own; and where the
 *  cursor goes after them. */
export function withLines(text: string, pos: number, lines: string[]) {
  const lineFrom = text.lastIndexOf("\n", pos - 1) + 1;
  const nl = text.indexOf("\n", pos);
  const lineTo = nl === -1 ? text.length : nl;
  const before = pos > lineFrom ? "\n" : "";
  const after = pos < lineTo ? "\n" : "";
  const insert = before + lines.join("\n") + after;
  return {
    text: text.slice(0, pos) + insert + text.slice(pos),
    insert,
    cursor: pos + insert.length - after.length,
  };
}

/** Insert `lines` at `at` (else the cursor), each on a line of its own. */
export function insertLines(view: EditorView, lines: string[], at?: number) {
  if (!lines.length) return;
  const pos = at ?? view.state.selection.main.head;
  const { insert, cursor } = withLines(view.state.doc.toString(), pos, lines);
  view.dispatch({
    changes: { from: pos, insert },
    selection: { anchor: cursor },
    userEvent: "input.paste",
  });
  view.focus();
}

/** The note an import is for, and where in it, as it was when the import started. */
interface Target {
  view: EditorView;
  note: string;
  vault: string | null;
  dir: string;
  at: number;
  text: string;
}

function targetOf(view: EditorView, at?: number): Target {
  return {
    view,
    note: view.state.facet(notePath),
    vault: currentVault(),
    dir: folderFor(view),
    at: at ?? view.state.selection.main.head,
    text: view.state.doc.toString(),
  };
}

/**
 * Embed attachments just saved at `paths` in the note the import was for. Usually its
 * editor is still showing it; if the user moved on meanwhile, the note's file gets the
 * embeds instead (where they were meant to go if it hasn't changed since, else at the
 * end). That write is tracked like a closing document's (`trackClosingWrite`): if it
 * fails, the note's new text is kept in an "(unsaved …)" file next to it, and if even
 * that fails, closing or updating the app is held back and the note is reported.
 */
async function embedSaved(t: Target, paths: string[]) {
  if (!paths.length) return;
  await useAppStore.getState().refreshTree();
  const tree = useAppStore.getState().tree;
  const lines = paths.map((p) => embedFor(p, tree));
  const place = (text: string) => withLines(text, text === t.text ? t.at : text.length, lines);
  const { view } = t;
  if (view.dom.isConnected && view.state.facet(notePath) === t.note) {
    insertLines(view, lines, view.state.doc.toString() === t.text ? t.at : undefined);
    return;
  }
  // Open again in a new editor: the change goes through it (and its saving).
  if (getActiveEditor()?.path === t.note && t.vault === currentVault()) {
    await editNote(t.note, (text) => place(text).text);
    return;
  }
  let next: string;
  let write: () => Promise<unknown>;
  try {
    if (t.vault !== currentVault()) throw new Error("another vault is open now");
    const file = await backend.readFile(t.note);
    next = place(file.content).text;
    write = () => backend.writeFile(t.note, next, file.modifiedMs, t.vault ?? undefined);
  } catch (e) {
    // Can't read the note (gone, or another vault): keep just the embeds.
    next = lines.join("\n");
    write = () => Promise.reject(e instanceof Error ? e : new Error(describe(e)));
  }
  trackClosingWrite(t.note, next, t.vault, write);
}

/**
 * Run an import for `view`: `save` brings the files into the target's folder, each on its
 * own. Those that made it in are embedded even when others failed; the failures are
 * reported. Closing the app or installing an update waits for it (see `trackPending`),
 * so its embeds always reach the note.
 */
function runImport(
  view: EditorView,
  failure: string,
  save: (t: Target) => Promise<Imported>,
  at?: number,
): Promise<void> {
  const t = targetOf(view, at);
  return trackPending(
    (async () => {
      try {
        const { paths, failed } = await save(t);
        await embedSaved(t, paths);
        if (failed.length) {
          const which = failed.map((f) => `${f.name} (${f.error})`).join(", ");
          useAppStore.getState().setError(`${failure}: ${which}`);
        }
      } catch (e) {
        useAppStore.getState().setError(`${failure}: ${describe(e)}`);
      }
    })(),
  );
}

/**
 * Save pasted files into the attachment folder and embed them at the cursor. Only the
 * app has a pasted screenshot's bytes, so one that can't be saved is kept: it's tried
 * again before the app closes or updates, which waits until it's saved (`keepForRetry`).
 */
export function pasteFiles(view: EditorView, files: File[], now = new Date()) {
  return runImport(
    view,
    "Couldn't save the pasted file (it's kept and tried again before AXISNotes closes)",
    async (t) => {
      const out: Imported = { paths: [], failed: [] };
      for (const file of files) {
        const name = pastedFileName(file, now);
        if (!name) continue;
        let bytes: Uint8Array;
        try {
          bytes = new Uint8Array(await file.arrayBuffer());
        } catch (e) {
          out.failed.push({ name, error: describe(e) }); // nothing could be read to keep
          continue;
        }
        const save = () => backend.saveAttachment(t.dir, name, bytes, t.vault ?? undefined);
        try {
          out.paths.push(await save());
        } catch (e) {
          out.failed.push({ name, error: describe(e) });
          keepForRetry([t.dir, name].filter(Boolean).join("/"), async () => {
            if (t.vault !== currentVault()) return false; // only into its own vault
            await embedSaved(t, [await save()]);
            return true;
          });
        }
      }
      return out;
    },
  );
}

/** Pick images, video or audio from disk and embed them at the cursor. */
export function pickAndEmbed(view: EditorView) {
  return runImport(view, "Couldn't add", (t) =>
    backend.pickAttachments(t.dir, t.vault ?? undefined),
  );
}

/** Pasted media files to save, or [] to let the paste go ahead as usual. Text copied
 *  from Excel or Word also carries a picture of itself ("image.png"); that stays text. */
export function pastedMedia(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = [...data.files].filter((f) => pastedFileName(f) !== null);
  if (!files.length) return [];
  const generic = files.every((f) => /^image\.\w+$/i.test(f.name));
  if (generic && data.getData("text/plain").trim()) return [];
  return files;
}

/** What dropping a vault file from the file tree inserts: an embed for media, a link
 *  for a note or anything else. */
export function textForTreeDrop(path: string): string {
  const { tree, notes } = useAppStore.getState();
  if (mediaKind(path)) return embedFor(path, tree);
  if (isNotePath(path)) return `[[${linkTargetFor(path, notes)}]]`;
  return `[[${path}]]`;
}

export const mediaInput = EditorView.domEventHandlers({
  paste(e, view) {
    const files = pastedMedia(e.clipboardData);
    if (!files.length) return false;
    e.preventDefault();
    void pasteFiles(view, files);
    return true;
  },
  dragover(e) {
    if (!e.dataTransfer?.types.includes(PATH_MIME)) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = "link";
    return true;
  },
  drop(e, view) {
    const path = e.dataTransfer?.getData(PATH_MIME);
    if (!path) return false;
    e.preventDefault();
    const at = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? undefined;
    insertLines(view, [textForTreeDrop(path)], at);
    return true;
  },
});

/** The note editor at a point in the window (the outer one, not an embed inside it). */
function editorAt(x: number, y: number): EditorView | null {
  let el = document.elementFromPoint(x, y)?.closest(".cm-editor") ?? null;
  for (
    let up = el?.parentElement?.closest(".cm-editor");
    up;
    up = up.parentElement?.closest(".cm-editor")
  )
    el = up;
  return el instanceof HTMLElement ? EditorView.findFromDOM(el) : null;
}

/**
 * Files dropped on the window from outside (Explorer, Finder): when they land on a note,
 * copy them into the vault and embed them where they were dropped. Returns a stop function.
 */
export function installFileDrops(): () => void {
  let stop: (() => void) | undefined;
  let gone = false;
  void backend
    .onFilesDropped(async ({ x, y }) => {
      // The window reports physical pixels; the page works in CSS pixels.
      const cx = x / window.devicePixelRatio;
      const cy = y / window.devicePixelRatio;
      const content = document.elementFromPoint(cx, cy)?.closest(".content");
      const view = editorAt(cx, cy) ?? (content ? (getActiveEditor()?.view ?? null) : null);
      if (!view) return;
      const at = view.posAtCoords({ x: cx, y: cy }) ?? undefined;
      await runImport(
        view,
        "Couldn't add",
        (t) => backend.importDropped(t.dir, t.vault ?? undefined),
        at,
      );
    })
    .then((u) => (gone ? u() : (stop = u)));
  return () => {
    gone = true;
    stop?.();
  };
}
