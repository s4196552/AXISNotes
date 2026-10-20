import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { docKind } from "../../lib/fileKinds";
import { noteName } from "../../lib/markdown";
import { HOME, makeWidget } from "../dashboard/dashboardModel";
import { saveWidgets } from "../dashboard/setDashboard";
import { remapIcons, renameEntry } from "../files/renameEntry";
import { createUniqueNote } from "./actions";
import { registerCommands } from "./registry";
import { useUi } from "./ui";

// Commands for the file open in the active tab: rename, move, duplicate, delete, copy a
// link, pin to Home, show in the file manager.

const report = (e: unknown) =>
  useAppStore.getState().setError(isBackendError(e) ? e.message : String(e));

/** The file the active tab shows, or null on Home, the graph, tasks and so on. */
export function openFilePath(): string | null {
  const s = useAppStore.getState();
  return s.mainView === "note" ? s.activePath : null;
}

const hasOpenFile = () => openFilePath() !== null;
const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const extOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".")) : "");

/** How a link to `path` is written: `[[Name]]` for notes, the file name otherwise. */
export function linkTo(path: string): string {
  return `[[${path.toLowerCase().endsWith(".md") ? noteName(path) : fileName(path)}]]`;
}

/** Rename the open file: in the note's title field, else by asking for a name. */
export async function renameOpenFile() {
  const path = openFilePath();
  if (!path) return;
  const title = document.querySelector<HTMLInputElement>("input.editor-title");
  if (title && docKind(path) === "markdown") {
    title.focus();
    title.select();
    return;
  }
  const name = fileName(path);
  const ext = extOf(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  const answers = await useUi.getState().ask("Rename", ["Name"], { Name: base });
  const next = answers?.["Name"]?.trim();
  if (!next || next === base) return;
  const dir = parentOf(path);
  try {
    await renameEntry(path, `${dir ? dir + "/" : ""}${next}${ext}`);
  } catch (e) {
    report(e);
  }
}

/** Move `path` into `folder` ("" is the vault root), keeping its name. */
export async function moveFile(path: string, folder: string) {
  if (parentOf(path) === folder) return;
  try {
    await renameEntry(path, `${folder ? folder + "/" : ""}${fileName(path)}`);
    useAppStore.getState().notify(`Moved to ${folder || "the vault folder"}`);
  } catch (e) {
    report(e);
  }
}

/** Copy the open file next to it as "Name copy", and open the copy. */
export async function duplicateOpenFile() {
  const path = openFilePath();
  if (!path) return;
  try {
    const { content } = await backend.readFile(path);
    const name = fileName(path);
    const ext = extOf(name) || ".md";
    const base = name.slice(0, name.length - extOf(name).length);
    const copy = await createUniqueNote(parentOf(path), `${base} copy`, content, ext);
    const store = useAppStore.getState();
    await store.refreshTree();
    store.openFile(copy);
  } catch (e) {
    report(e);
  }
}

/** Move the open file to the trash, after asking. */
export async function deleteOpenFile() {
  const path = openFilePath();
  if (!path) return;
  if (!window.confirm(`Move "${noteName(fileName(path))}" to the trash?`)) return;
  try {
    await backend.trashEntry(path);
    const store = useAppStore.getState();
    await store.refreshTree();
    store.onEntryRemoved(path);
    await remapIcons(path, null);
  } catch (e) {
    report(e);
  }
}

export async function copyLinkToOpenFile() {
  const path = openFilePath();
  if (!path) return;
  const link = linkTo(path);
  try {
    await navigator.clipboard.writeText(link);
    useAppStore.getState().notify(`Copied ${link}`);
  } catch (e) {
    report(e);
  }
}

/** Add the open file to Home's first Pinned widget (adding one if Home has none). */
export function pinOpenFileToHome() {
  const path = openFilePath();
  if (!path) return;
  saveWidgets(HOME, (widgets) => {
    const i = widgets.findIndex((w) => w.type === "links");
    if (i === -1) return [...widgets, { ...makeWidget("links"), links: [path] }];
    const links = widgets[i]!.links ?? [];
    if (links.includes(path)) return widgets;
    return widgets.map((w, j) => (j === i ? { ...w, links: [...links, path] } : w));
  });
  useAppStore.getState().notify("Pinned to Home");
}

export function revealOpenFile() {
  const path = openFilePath();
  if (path) void backend.revealEntry(path).catch(report);
}

registerCommands([
  {
    id: "rename-note",
    label: "Rename note",
    available: hasOpenFile,
    run: () => void renameOpenFile(),
  },
  {
    id: "move-note",
    label: "Move note to…",
    available: hasOpenFile,
    run: () => {
      const path = openFilePath();
      if (path) useUi.getState().open({ kind: "move", path });
    },
  },
  {
    id: "duplicate-note",
    label: "Duplicate note",
    available: hasOpenFile,
    run: () => void duplicateOpenFile(),
  },
  {
    id: "delete-note",
    label: "Delete note",
    available: hasOpenFile,
    run: () => void deleteOpenFile(),
  },
  {
    id: "copy-note-link",
    label: "Copy link to note",
    available: hasOpenFile,
    run: () => void copyLinkToOpenFile(),
  },
  { id: "pin-to-home", label: "Pin to Home", available: hasOpenFile, run: pinOpenFileToHome },
  {
    id: "reveal-note",
    label: "Reveal in File Explorer",
    available: hasOpenFile,
    run: revealOpenFile,
  },
  {
    id: "choose-theme",
    label: "Choose theme…",
    run: () => useUi.getState().open({ kind: "themes" }),
  },
]);
