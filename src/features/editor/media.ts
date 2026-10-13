import { EditorView } from "@codemirror/view";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { attachmentDir, embedFor, mediaKind, pastedFileName } from "../../lib/attachments";
import { isNotePath } from "../../lib/markdown";
import { PATH_MIME } from "../../lib/fileKinds";
import { currentVault } from "../files/unsavedWork";
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

/** Insert `lines` at `at` (else the cursor), each on a line of its own. */
export function insertLines(view: EditorView, lines: string[], at?: number) {
  if (!lines.length) return;
  const pos = at ?? view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  const before = pos > line.from ? "\n" : "";
  const after = pos < line.to ? "\n" : "";
  const text = before + lines.join("\n") + after;
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length - after.length },
    userEvent: "input.paste",
  });
  view.focus();
}

/** Embed attachments just saved at `paths` (the file tree is refreshed first, so the
 *  embeds find them). */
async function embedSaved(view: EditorView, paths: string[], at?: number) {
  if (!paths.length) return;
  await useAppStore.getState().refreshTree();
  const tree = useAppStore.getState().tree;
  insertLines(
    view,
    paths.map((p) => embedFor(p, tree)),
    at,
  );
}

/** Save pasted files into the attachment folder and embed them at the cursor. */
export async function pasteFiles(view: EditorView, files: File[], now = new Date()) {
  const dir = folderFor(view);
  const vault = currentVault() ?? undefined;
  const saved: string[] = [];
  try {
    for (const file of files) {
      const name = pastedFileName(file, now);
      if (!name) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      saved.push(await backend.saveAttachment(dir, name, bytes, vault));
    }
  } catch (e) {
    useAppStore.getState().setError(`Couldn't save the pasted file: ${describe(e)}`);
  }
  await embedSaved(view, saved);
}

/** Pick images, video or audio from disk and embed them at the cursor. */
export async function pickAndEmbed(view: EditorView) {
  try {
    const paths = await backend.pickAttachments(folderFor(view), currentVault() ?? undefined);
    await embedSaved(view, paths);
  } catch (e) {
    useAppStore.getState().setError(`Couldn't add the files: ${describe(e)}`);
  }
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
      try {
        const paths = await backend.importDropped(folderFor(view), currentVault() ?? undefined);
        await embedSaved(view, paths, at);
      } catch (e) {
        useAppStore.getState().setError(`Couldn't add the dropped files: ${describe(e)}`);
      }
    })
    .then((u) => (gone ? u() : (stop = u)));
  return () => {
    gone = true;
    stop?.();
  };
}
