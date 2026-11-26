import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppWindow,
  ArrowDownAZ,
  Ban,
  ChevronRight,
  ChevronsDownUp,
  ClipboardPaste,
  Columns2,
  Copy,
  CopyPlus,
  Cpu,
  File,
  FolderInput,
  Grid3x3,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Film,
  Globe,
  Image,
  LayoutDashboard,
  ListChecks,
  Lock,
  type LucideIcon,
  MessageSquare,
  Palette,
  Pencil,
  Scissors,
  Search,
  Shapes,
  Sheet,
  ShieldCheck,
  Smile,
  Sparkles,
  SquarePlus,
  Star,
  StarOff,
  Trash2,
  Wand2,
} from "lucide-react";
import { ContextMenu, MenuGroup, MenuItem, SubMenu } from "./ContextMenu";
import { type AiRule, backend, isBackendError, type VaultEntry } from "../../ipc";
import { CANVAS_EXT, docKind, GRID_EXT } from "../../lib/fileKinds";
import { emptySheet, serializeSheet } from "../../lib/formula/sheet";
import { emptyCanvas, serializeCanvas } from "../../lib/canvas";
import { useAppStore } from "../../app/store";
import { useFitToViewport } from "../../app/menuPosition";
import { type EntryColors, type FolderIcon, useConfig } from "../../app/config";
import { useUi } from "../commands/ui";
import { isNotePath } from "../../lib/markdown";
import { EntryIcon } from "../icons/EntryIcon";
import { hasDashboard } from "../dashboard/dashboardModel";
import { remapIcons } from "../files/renameEntry";
import { setDashboard } from "../dashboard/setDashboard";
import {
  baseName,
  canMove,
  displayName,
  type DropSide,
  dropSide,
  findEntry,
  folderQuery,
  isOpenable,
  joinPath,
  orderedChildren,
  outermost,
  parentPath,
  placeName,
  remapPaths,
  renamedName,
  uniqueName,
  visibleRows,
} from "./treeModel";
import { rowColorProps, rowColors } from "./rowColorsModel";
import { useExpanded } from "./useExpanded";
import { ancestorsOf, useRevealRequest } from "./reveal";
import { addFavorites, removeFavorite } from "../panels/favorites";
import { useSkills } from "../skills/skills";
import { skillIcon } from "../skills/skillIcons";
import { runSkillOnPicked, skillsForPicked } from "../skills/skillOnFiles";
import { sendFilesToSidebar } from "../ai/sidebarChatState";
import { clipFor, itemsLabel, useTreeClipboard } from "./clipboard";
import {
  batch,
  beforeDelete,
  changeSetting,
  copiesMade,
  created,
  record,
  redoTree,
  renamed,
  undoTree,
  isRedoKey,
  isUndoKey,
} from "./undo";
import "./filetree.css";

interface MenuState {
  x: number;
  y: number;
  /** null = the empty area / vault root. */
  entry: VaultEntry | null;
}

/** Where a dragged item would land: before, after or into a row ("" into = top level). */
interface DropAt {
  path: string;
  side: DropSide;
}

/** Pointer travel (px) before a press on a row becomes a drag. */
const DRAG_START = 5;
/** Hovering over a closed folder this long (ms) while dragging opens it. */
const OPEN_DELAY = 600;
/** Long enough (ms) for an opened folder's last row to drop in: 12 × 14 ms delay + 180 ms. */
const DROP_MS = 500;

/** Everything a row can trigger. Kept in one stable object so rows can be memoized. */
interface RowActions {
  select(path: string): void;
  /** Shift+click: select every row from the anchor to `path`. */
  extend(path: string): void;
  /** Open a file (in a new tab with `newTab`), or expand/collapse a folder. */
  activate(entry: VaultEntry, newTab?: boolean): void;
  toggle(path: string): void;
  openMenu(e: React.MouseEvent, entry: VaultEntry | null): void;
  commitRename(entry: VaultEntry, input: string): void;
  cancelRename(): void;
  /** A press that may become a drag. Pointer events, not HTML drag and drop, which the
   *  desktop app's webview swallows on Windows. */
  press(e: React.PointerEvent, path: string): void;
}

const errorMessage = (e: unknown) => (isBackendError(e) ? e.message : String(e));
const rowId = (path: string) => `filetree-row-${encodeURIComponent(path)}`;

export function FileTree() {
  const vault = useAppStore((s) => s.vault);
  const tree = useAppStore((s) => s.tree);
  const folderIcons = useConfig((s) => s.config.folderIcons);
  const entryColors = useConfig((s) => s.config.entryColors);
  const aiFolders = useConfig((s) => s.config.ai.folders);
  const dashboards = useConfig((s) => s.config.dashboards);
  const fileOrder = useConfig((s) => s.config.fileOrder);
  const activePath = useAppStore((s) => s.activePath);
  // `root`: the vault `expanded` belongs to, which trails a vault switch by one render.
  const {
    expanded,
    root,
    toggle,
    collapseAll,
    update: updateExpanded,
  } = useExpanded(vault?.root ?? "");

  const [selected, setSelected] = useState<string | null>(null);
  // Rows picked with Shift+click or Shift+↑/↓, from `anchor` to `focus` (the selected row).
  // Any other change of the selected row drops back to that one row (see below).
  const [picked, setPicked] = useState<{ anchor: string; focus: string; paths: string[] } | null>(
    null,
  );
  if (picked && picked.focus !== selected) setPicked(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Near the bottom or right of the window the menu opens above or left of the pointer.
  useFitToViewport(menuRef, menu?.x ?? 0, menu?.y ?? 0, menu);
  /** Close the menu; focus used in it goes back to the tree. */
  const closeMenu = useCallback(() => {
    if (menuRef.current?.contains(document.activeElement)) treeRef.current?.focus();
    setMenu(null);
  }, []);
  /** When the menu key or Shift+F10 last opened the menu (its own contextmenu event follows). */
  const keyMenuAt = useRef(0);
  const pasteCount = useTreeClipboard((s) => clipFor(s.clip, vault?.root)?.paths.length ?? 0);
  /** The item pressed, everything dragged with it, where it would land, and the pointer. */
  const [drag, setDrag] = useState<{
    path: string;
    paths: string[];
    over: DropAt | null;
    x: number;
    y: number;
  }>();
  const pressed = useRef<{
    path: string;
    paths: string[];
    x: number;
    y: number;
    pointerId: number;
    element: Element;
  } | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const rootDropRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => visibleRows(tree, expanded, fileOrder), [tree, expanded, fileOrder]);
  // The folder just opened by a click or key, so its rows can drop into place. Several
  // opening at once (revealing the open note) don't animate, nor do the folders a vault
  // opens with.
  const [last, setLast] = useState({ root, expanded });
  const [opened, setOpened] = useState<string | null>(null);
  if (last.root !== root || last.expanded !== expanded) {
    // Adjusting state while rendering (as useExpanded does), so the rows animate at once.
    const added = [...expanded].filter((p) => !last.expanded.has(p));
    setLast({ root, expanded });
    setOpened(last.root === root && added.length === 1 ? added[0]! : null);
  }
  // Once its rows have dropped in, the folder is no longer "just opened": a row added or
  // renamed in it later doesn't drop in again.
  useEffect(() => {
    if (opened === null) return;
    const t = window.setTimeout(() => setOpened(null), DROP_MS);
    return () => window.clearTimeout(t);
  }, [opened]);
  const openedAt = opened === null ? -1 : rows.findIndex((r) => r.entry.path === opened);

  // Latest state for the stable action callbacks below.
  const latest = useRef({ tree, selected, picked, rows, fileOrder, expanded });
  useLayoutEffect(() => {
    latest.current = { tree, selected, picked, rows, fileOrder, expanded };
  }, [tree, selected, picked, rows, fileOrder, expanded]);

  /** The chosen paths in tree order (just the selected row unless several are picked). */
  const chosen = useCallback((): string[] => {
    const { picked: p, selected: sel } = latest.current;
    return p ? p.paths : sel !== null ? [sel] : [];
  }, []);

  /** Select every visible row from the anchor (the last row chosen without Shift) to `path`. */
  const extendTo = useCallback((path: string) => {
    const { rows: all, picked: p, selected: sel } = latest.current;
    const at = (q: string | null) => all.findIndex((r) => r.entry.path === q);
    const to = at(path);
    if (to < 0) return;
    let anchor = p?.anchor ?? sel ?? path;
    if (at(anchor) < 0) anchor = path;
    const from = at(anchor);
    const paths = all.slice(Math.min(from, to), Math.max(from, to) + 1).map((r) => r.entry.path);
    setSelected(path);
    setPicked(paths.length > 1 ? { anchor, focus: path, paths } : null);
  }, []);

  const run = useCallback(async (op: () => Promise<void>) => {
    try {
      await op();
      return true;
    } catch (e) {
      useAppStore.getState().setError(errorMessage(e));
      return false;
    }
  }, []);

  /** Folder that new items go into: the selected folder, the selected file's folder, or root. */
  const targetDir = useCallback((): string => {
    const { tree: t, selected: sel } = latest.current;
    if (sel === null) return "";
    const entry = findEntry(t, sel);
    if (!entry) return "";
    return entry.kind === "dir" ? entry.path : parentPath(entry.path);
  }, []);

  const childNames = (dir: string) =>
    (findEntry(latest.current.tree, dir)?.children ?? []).map((c) => c.name);

  const createNote = useCallback(
    (dir: string, kind: "note" | "grid" | "canvas" = "note") =>
      run(async () => {
        const [ext, content] =
          kind === "grid"
            ? [GRID_EXT, serializeSheet(emptySheet())]
            : kind === "canvas"
              ? [CANVAS_EXT, serializeCanvas(emptyCanvas())]
              : [".md", ""];
        const path = joinPath(dir, uniqueName(childNames(dir), "Untitled", ext));
        await backend.createFile(path, content);
        record(created(path, content));
        if (dir) toggle(dir, true);
        const store = useAppStore.getState();
        await store.refreshTree();
        store.openFile(path);
        setSelected(path);
        setRenaming(path);
      }),
    [run, toggle],
  );

  const createFolder = useCallback(
    (dir: string) =>
      run(async () => {
        const path = joinPath(dir, uniqueName(childNames(dir), "Untitled folder"));
        await backend.createDir(path);
        record(created(path, null));
        if (dir) toggle(dir, true);
        await useAppStore.getState().refreshTree();
        setSelected(path);
        setRenaming(path);
      }),
    [run, toggle],
  );

  const move = useCallback(
    (from: string, to: string) =>
      run(async () => {
        await backend.renameEntry(from, to);
        record(renamed(from, to));
        updateExpanded((prev) => {
          const next = remapPaths(prev, from, to);
          for (const folder of ancestorsOf(to)) next.add(folder);
          return next;
        });
        await remapIcons(from, to);
        const store = useAppStore.getState();
        await store.refreshTree();
        store.onEntryRenamed(from, to);
        setSelected(to);
      }),
    [run, updateExpanded],
  );

  const trash = useCallback(
    (entry: VaultEntry) =>
      run(async () => {
        const what = entry.kind === "dir" ? "folder" : "note";
        if (!window.confirm(`Move the ${what} "${displayName(entry)}" to the trash?`)) return;
        const recordDelete = beforeDelete([entry.path]);
        await backend.trashEntry(entry.path);
        recordDelete([entry.path]);
        const store = useAppStore.getState();
        await store.refreshTree();
        store.onEntryRemoved(entry.path);
        await remapIcons(entry.path, null);
        setSelected((s) => (s && (s === entry.path || s.startsWith(entry.path + "/")) ? null : s));
      }),
    [run],
  );

  /** Trash several items after one confirmation (a folder takes its own items with it). */
  const trashMany = useCallback(
    (paths: string[]) => {
      const t = latest.current.tree;
      const entries = outermost(paths)
        .map((p) => findEntry(t, p))
        .filter((e): e is VaultEntry => !!e);
      if (entries.length <= 1) return entries[0] ? trash(entries[0]) : Promise.resolve(false);
      return run(async () => {
        const names = entries.slice(0, 10).map(displayName);
        if (entries.length > 10) names.push(`…and ${entries.length - 10} more`);
        if (!window.confirm(`Move ${entries.length} items to the trash?\n\n${names.join("\n")}`))
          return;
        const done: string[] = [];
        const recordDelete = beforeDelete(entries.map((e) => e.path));
        try {
          for (const e of entries) {
            await backend.trashEntry(e.path);
            done.push(e.path);
          }
        } finally {
          recordDelete(done);
          const store = useAppStore.getState();
          await store.refreshTree();
          for (const p of done) {
            store.onEntryRemoved(p);
            await remapIcons(p, null);
          }
          setSelected(null);
        }
      });
    },
    [run, trash],
  );

  /** Names in `dir`, in the order shown. Read from the stores, which a move or a saved
   *  order updates at once, so several items dropped together see each other. */
  const shownNames = useCallback((dir: string) => {
    const t = useAppStore.getState().tree;
    const order = useConfig.getState().config.fileOrder;
    return orderedChildren(findEntry(t, dir)?.children ?? [], order[dir]).map((c) => c.name);
  }, []);

  const saveOrder = useCallback(
    (dir: string, names: string[]) =>
      changeSetting(
        `Reorder ${dir ? `“${baseName(dir)}”` : "the top level"}`,
        "fileOrder",
        dir,
        () =>
          useConfig
            .getState()
            .update((c) => ({ ...c, fileOrder: { ...c.fileOrder, [dir]: names } })),
      ),
    [],
  );

  /** Put `src` before or after `target`, moving it into `target`'s folder first if needed. */
  const place = useCallback(
    (src: string, target: string, side: "before" | "after") =>
      run(() =>
        batch(`Move “${baseName(src)}”`, async () => {
          const dir = parentPath(target);
          const name = baseName(src);
          const names = shownNames(dir);
          if (parentPath(src) !== dir) {
            if (names.some((n) => n.toLowerCase() === name.toLowerCase())) {
              const where = dir ? `"${baseName(dir)}"` : "the top level";
              useAppStore.getState().setError(`"${name}" already exists in ${where}.`);
              return;
            }
            if (!(await move(src, joinPath(dir, name)))) return;
          }
          await saveOrder(dir, placeName(names, name, baseName(target), side));
          setSelected(joinPath(dir, name));
        }),
      ),
    [run, move, shownNames, saveOrder],
  );

  /** Move an item one place up (-1) or down (1) among its neighbours. */
  const nudge = useCallback(
    (path: string, by: -1 | 1) => {
      const dir = parentPath(path);
      const names = shownNames(dir);
      const i = names.indexOf(baseName(path));
      const j = i + by;
      if (i === -1 || j < 0 || j >= names.length) return;
      const order = placeName(names, names[i]!, names[j]!, by < 0 ? "before" : "after");
      void run(() => saveOrder(dir, order));
    },
    [run, shownNames, saveOrder],
  );

  /** Back to A–Z (folders first) in `dir`. */
  const resetOrder = useCallback(
    (dir: string) =>
      run(() =>
        changeSetting("Sort A–Z", "fileOrder", dir, () =>
          useConfig.getState().update((c) => {
            const fileOrder = { ...c.fileOrder };
            delete fileOrder[dir];
            return { ...c, fileOrder };
          }),
        ),
      ),
    [run],
  );

  // ---- Copy, cut and paste (T-194) ----

  /** Put `paths` (a folder takes its items along) on the tree's clipboard. */
  const copyOrCut = useCallback((paths: string[], mode: "copy" | "cut") => {
    const store = useAppStore.getState();
    const list = outermost(paths).filter((p) => findEntry(latest.current.tree, p));
    if (!store.vault || !list.length) return;
    useTreeClipboard.getState().set({ root: store.vault.root, mode, paths: list });
    const name = (p: string) => {
      const e = findEntry(latest.current.tree, p);
      return e ? displayName(e) : baseName(p);
    };
    const verb = mode === "copy" ? "Copied" : "Cut";
    store.notify(`${verb} ${itemsLabel(list, name)}. Select a folder and press Ctrl+V to paste.`);
  }, []);

  /** The menu's first "Copy": a copy beside the item, named "Name copy" (T-287). */
  const duplicate = useCallback(
    (path: string) =>
      run(async () => {
        const dir = parentPath(path);
        const copy = await backend.copyEntry(path, dir);
        await useAppStore.getState().refreshTree();
        const made = await copiesMade([copy.path]);
        if (made) record(made);
        setSelected(copy.path);
      }),
    [run],
  );

  /** "Paste 3 items", for undo. */
  const pasteLabel = () => {
    const n = clipFor(useTreeClipboard.getState().clip, useAppStore.getState().vault?.root)?.paths
      .length;
    return n && n > 1 ? `Paste ${n} items` : "Paste";
  };

  /** Paste what was copied (as copies, under free names) or cut (moved) into `dir`. */
  const paste = useCallback(
    (dir: string) =>
      run(() =>
        batch(pasteLabel(), async () => {
          const store = useAppStore.getState();
          const clipboard = useTreeClipboard.getState();
          const c = clipFor(clipboard.clip, store.vault?.root);
          if (!c) return;
          const items = c.paths.filter((p) => findEntry(store.tree, p));
          if (!items.length) {
            clipboard.set(null);
            store.setError("Nothing to paste: the copied items are no longer in the vault.");
            return;
          }
          const problems: string[] = [];
          const landed: string[] = [];
          const left: string[] = [];
          try {
            for (const p of items) {
              const name = baseName(p);
              const to = joinPath(dir, name);
              if (dir === p || dir.startsWith(p + "/")) {
                problems.push(`"${name}" into itself`);
                left.push(p);
              } else if (c.mode === "copy") {
                try {
                  landed.push((await backend.copyEntry(p, dir)).path);
                } catch (e) {
                  problems.push(`"${name}" (${errorMessage(e)})`);
                }
              } else if (parentPath(p) === dir) {
                landed.push(p); // already there
              } else if (shownNames(dir).some((n) => n.toLowerCase() === name.toLowerCase())) {
                const where = dir ? `"${baseName(dir)}"` : "the top level";
                problems.push(`"${name}" (it already exists in ${where})`);
                left.push(p);
              } else if (await move(p, to)) {
                landed.push(to);
              } else left.push(p);
            }
          } finally {
            if (c.mode === "copy") await useAppStore.getState().refreshTree();
            // What was cut but couldn't move stays cut, to paste somewhere else.
            else clipboard.set(left.length ? { ...c, paths: left } : null);
          }
          if (c.mode === "copy") {
            const made = await copiesMade(landed);
            if (made) record(made);
          }
          if (dir && landed.length) toggle(dir, true);
          const focus = landed[landed.length - 1];
          if (focus) {
            setSelected(focus);
            setPicked(landed.length > 1 ? { anchor: landed[0]!, focus, paths: landed } : null);
          }
          if (problems.length)
            useAppStore.getState().setError(`Couldn't paste ${problems.join(", ")}.`);
        }),
      ),
    [run, move, shownNames, toggle],
  );

  // ---- Dragging rows ----

  /** Where `srcs` would land with the pointer at x, y, or null if they can't go there. */
  const dropAt = useCallback((srcs: string[], x: number, y: number): DropAt | null => {
    // Into a folder: each item must be able to go there (one already in it stays put).
    const canInto = (dir: string) =>
      srcs.every((s) => canMove(s, dir) || (srcs.length > 1 && parentPath(s) === dir)) &&
      srcs.some((s) => canMove(s, dir));
    const body = treeRef.current;
    const el = document.elementFromPoint(x, y);
    if (el && rootDropRef.current?.contains(el))
      return canInto("") ? { path: "", side: "into" } : null;
    if (!body || !el || !body.contains(el)) return null;
    const rowEl = el.closest<HTMLElement>("[role=treeitem]");
    // Empty space below the rows: the top level.
    if (!rowEl) return canInto("") ? { path: "", side: "into" } : null;
    const path = rowEl.dataset.path ?? "";
    const isDir = findEntry(latest.current.tree, path)?.kind === "dir";
    const r = rowEl.getBoundingClientRect();
    const side = dropSide(y, r.top, r.height, isDir);
    if (side === "into") return canInto(path) ? { path, side } : null;
    const dir = parentPath(path);
    // Not next to itself, nor anywhere inside itself.
    if (srcs.some((src) => path === src || dir === src || dir.startsWith(src + "/"))) return null;
    return { path, side };
  }, []);

  /** Drop several items: into a folder, or before/after a row, keeping their order. */
  const dropMany = useCallback(
    (srcs: string[], over: DropAt) =>
      batch(`Move ${srcs.length} items`, async () => {
        // A clash or a failed move is reported and leaves that item where it was.
        const exists = (p: string) => !!findEntry(useAppStore.getState().tree, p);
        const moved = (src: string, to: string) => exists(to) && (to === src || !exists(src));
        const landed: string[] = [];
        if (over.side === "into") {
          for (const src of srcs) {
            const to = joinPath(over.path, baseName(src));
            if (parentPath(src) !== over.path) await move(src, to);
            if (moved(src, to)) landed.push(to);
          }
        } else {
          // Each goes right after the one placed before it (or before the target, in order).
          const side = over.side;
          let target = over.path;
          for (const src of srcs) {
            const to = joinPath(parentPath(target), baseName(src));
            await place(src, target, side);
            if (!moved(src, to)) break;
            landed.push(to);
            if (side === "after") target = to;
          }
        }
        const focus = landed[landed.length - 1];
        if (!focus) return;
        setSelected(focus);
        setPicked(landed.length > 1 ? { anchor: landed[0]!, focus, paths: landed } : null);
      }),
    [move, place],
  );

  useEffect(() => {
    let current: {
      path: string;
      paths: string[];
      over: DropAt | null;
      x: number;
      y: number;
    } | null = null;
    let opening: { path: string; timer: ReturnType<typeof setTimeout> } | null = null;
    let frame: number | undefined;
    let lastFrame = 0;
    const stopOpening = () => {
      if (opening) clearTimeout(opening.timer);
      opening = null;
    };
    const end = () => {
      stopOpening();
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      lastFrame = 0;
      const p = pressed.current;
      pressed.current = null;
      current = null;
      if (p?.element.hasPointerCapture?.(p.pointerId)) p.element.releasePointerCapture(p.pointerId);
      document.body.classList.remove("filetree-dragging");
      setDrag(undefined);
    };
    const updateTarget = () => {
      if (!current) return;
      const over = dropAt(current.paths, current.x, current.y);
      // Hovering over a closed folder opens it after a moment.
      const folder = over?.side === "into" && over.path !== "" ? over.path : null;
      if (folder !== (opening?.path ?? null)) {
        stopOpening();
        if (folder && !latest.current.expanded.has(folder))
          opening = { path: folder, timer: setTimeout(() => toggle(folder, true), OPEN_DELAY) };
      }
      const changed = over?.path !== current.over?.path || over?.side !== current.over?.side;
      current.over = over;
      if (changed) setDrag({ ...current });
    };
    // Keep scrolling and re-hit-testing while held at an edge, even without another
    // pointermove. Re-hit-testing also follows folders that open under a still pointer.
    const tick = (time: number) => {
      if (!current) return;
      const dt = lastFrame ? Math.min(time - lastFrame, 32) : 16;
      lastFrame = time;
      const body = treeRef.current;
      if (body) {
        const r = body.getBoundingClientRect();
        const { x, y } = current;
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          const edge = Math.min(28, r.height / 3);
          const direction = y < r.top + edge ? -1 : y > r.bottom - edge ? 1 : 0;
          // scrollTop is in unzoomed units; pointer coordinates are in viewport units.
          const scale = body.offsetHeight > 0 ? r.height / body.offsetHeight : 1;
          body.scrollTop += (direction * dt * 0.5) / (scale || 1);
        }
      }
      updateTarget();
      frame = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      const p = pressed.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (e.pointerType === "mouse" && (e.buttons & 1) === 0) {
        end();
        return;
      }
      if (!current) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_START) return;
        current = { path: p.path, paths: p.paths, over: null, x: e.clientX, y: e.clientY };
        document.body.classList.add("filetree-dragging");
        setMenu(null);
        frame = requestAnimationFrame(tick);
      }
      e.preventDefault();
      current.x = e.clientX;
      current.y = e.clientY;
      updateTarget();
      setDrag({ ...current });
    };
    const onUp = (e: PointerEvent) => {
      if (!pressed.current || e.pointerId !== pressed.current.pointerId) return;
      const done = current;
      // Hit-test while the drag-only root target is still mounted and before
      // releasing pointer capture can dispatch another event and flush a render.
      const over = done ? dropAt(done.paths, e.clientX, e.clientY) : null;
      end();
      if (!done) return;
      // The click that ends a drag doesn't also open the row under the pointer.
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener("click", swallow, true);
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      // A final move event is not guaranteed before release (or a hover-open
      // folder may have changed the rows). Hit-test the actual drop position.
      // A selected folder absorbs its selected children, including the row pressed.
      const src = done.paths[0]!;
      if (!over) return;
      if (done.paths.length > 1) void dropMany(done.paths, over);
      else if (over.side === "into") void move(src, joinPath(over.path, baseName(src)));
      else void place(src, over.path, over.side);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !current) return;
      e.preventDefault();
      e.stopPropagation();
      end();
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerId === pressed.current?.pointerId) end();
    };
    const onLostCapture = (e: PointerEvent) => {
      // Losing capture alone need not end a held gesture. Keep tracking it through
      // the window listeners; pointercancel, blur or a released button still cancels.
      if ((e.buttons & 1) === 0) onCancel(e);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("lostpointercapture", onLostCapture);
    window.addEventListener("blur", end);
    window.addEventListener("keydown", onKey, true);
    return () => {
      end();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("lostpointercapture", onLostCapture);
      window.removeEventListener("blur", end);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [dropAt, dropMany, move, place, toggle, vault?.root]);

  const actions = useMemo<RowActions>(
    () => ({
      select(path) {
        setSelected(path);
        setPicked(null);
      },
      extend: extendTo,
      activate(entry, newTab) {
        setSelected(entry.path);
        setPicked(null);
        if (entry.kind === "dir") toggle(entry.path);
        else if (isOpenable(entry))
          useAppStore.getState().openFile(entry.path, undefined, { newTab });
      },
      toggle: (path) => toggle(path),
      openMenu(e, entry) {
        e.preventDefault();
        e.stopPropagation();
        // The contextmenu event after the menu key: the menu is already open.
        if (Date.now() - keyMenuAt.current < 600) return;
        // On a row outside the picked ones, the menu is for that row alone.
        if (entry && !latest.current.picked?.paths.includes(entry.path)) {
          setSelected(entry.path);
          setPicked(null);
        }
        setMenu({ x: e.clientX, y: e.clientY, entry });
      },
      commitRename(entry, input) {
        setRenaming(null);
        const name = renamedName(entry, input);
        if (name) void move(entry.path, joinPath(parentPath(entry.path), name));
        treeRef.current?.focus();
      },
      cancelRename() {
        setRenaming(null);
        treeRef.current?.focus();
      },
      press(e, path) {
        if (pressed.current || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
          return;
        // Keep this gesture in our pointer-based drag path (including touch/stylus),
        // rather than allowing the webview to start text/image dragging or panning.
        e.preventDefault();
        setMenu(null);
        treeRef.current?.focus({ preventScroll: true });
        // Pressing a picked row drags all the picked rows (a folder takes its items along).
        const p = latest.current.picked;
        pressed.current = {
          path,
          paths: p?.paths.includes(path) ? outermost(p.paths) : [path],
          x: e.clientX,
          y: e.clientY,
          pointerId: e.pointerId,
          element: e.currentTarget,
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      },
    }),
    [toggle, move, extendTo],
  );

  // Close the context menu on outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  // Show a file: open the folders it is in, select it and scroll it into view. Selecting
  // also moves the keyboard cursor, so only one row looks current.
  const reveal = useCallback(
    (path: string) => {
      if (!findEntry(latest.current.tree, path)) return;
      const parents = ancestorsOf(path);
      updateExpanded((prev) =>
        parents.every((p) => prev.has(p)) ? prev : new Set([...prev, ...parents]),
      );
      setSelected(path);
      requestAnimationFrame(() =>
        document.getElementById(rowId(path))?.scrollIntoView?.({ block: "nearest" }),
      );
    },
    [updateExpanded],
  );
  // Follow the open file (Settings → Files & links can turn this off)…
  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        if (!s.activePath || s.activePath === prev.activePath) return;
        if (useConfig.getState().config.fileTree.revealActiveFile) reveal(s.activePath);
      }),
    [reveal],
  );
  // …and show a path on request ("Reveal open file in the file tree", a favorite folder),
  // also one asked for just before this tree was shown.
  useEffect(() => {
    const show = () => {
      const p = useRevealRequest.getState().pending;
      if (p === null) return;
      useRevealRequest.setState({ pending: null });
      reveal(p);
      if (findEntry(latest.current.tree, p)?.kind === "dir") toggle(p, true);
    };
    show();
    return useRevealRequest.subscribe(show);
  }, [reveal, toggle]);

  // Ctrl+Z / Ctrl+Y also work when nothing that has its own undo has focus (after a
  // delete's confirmation, say). The editor, text boxes and open dialogs keep theirs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !(isUndoKey(e) || isRedoKey(e))) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable], .cm-editor, iframe")) return;
      if (document.querySelector(".modal-backdrop, [role=dialog]")) return;
      e.preventDefault();
      void (isUndoKey(e) ? undoTree() : redoTree());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keep the selected row in view during keyboard navigation.
  useEffect(() => {
    if (selected === null) return;
    document.getElementById(rowId(selected))?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (renaming !== null || rows.length === 0) return;
    const index = rows.findIndex((r) => r.entry.path === selected);
    const current = index >= 0 ? rows[index]!.entry : null;
    // With Shift, ↑ ↓ Home and End extend the selection instead of moving it.
    const selectAt = (i: number) => {
      const path = rows[Math.max(0, Math.min(rows.length - 1, i))]!.entry.path;
      if (e.shiftKey) extendTo(path);
      else {
        setSelected(path);
        setPicked(null);
      }
    };

    // Ctrl/Cmd + Z undoes the last file-tree change; Ctrl/Cmd + Y or Shift+Z redoes it.
    if (isUndoKey(e) || isRedoKey(e)) {
      e.preventDefault();
      void (isUndoKey(e) ? undoTree() : redoTree());
      return;
    }

    // Ctrl/Cmd + C, X and V copy, cut and paste (into the selected folder, or the
    // selected file's folder).
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const key = e.key.toLowerCase();
      if (key === "c" || key === "x") copyOrCut(chosen(), key === "c" ? "copy" : "cut");
      else if (key === "v") void paste(targetDir());
      else return;
      e.preventDefault();
      return;
    }

    // The menu key or Shift+F10 opens the selected row's menu (or the tree's, with none).
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      keyMenuAt.current = Date.now();
      const r = current
        ? document.getElementById(rowId(current.path))?.getBoundingClientRect()
        : undefined;
      const box = r ?? treeRef.current?.getBoundingClientRect();
      if (current && !picked?.paths.includes(current.path)) setPicked(null);
      setMenu({ x: (box?.left ?? 0) + 24, y: r ? r.bottom : (box?.top ?? 0) + 8, entry: current });
      return;
    }

    // Alt + ↑ / ↓ moves the item among its neighbours.
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      if (current) nudge(current.path, e.key === "ArrowUp" ? -1 : 1);
      e.preventDefault();
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        selectAt(index + 1);
        break;
      case "ArrowUp":
        selectAt(index < 0 ? 0 : index - 1);
        break;
      case "ArrowRight":
        if (current?.kind === "dir") {
          if (!expanded.has(current.path)) toggle(current.path, true);
          else if (current.children?.length) selectAt(index + 1);
        }
        break;
      case "ArrowLeft":
        if (current?.kind === "dir" && expanded.has(current.path)) toggle(current.path, false);
        else if (current && parentPath(current.path) !== "") setSelected(parentPath(current.path));
        break;
      case "Enter":
        if (current) actions.activate(current);
        break;
      case "F2":
        if (current) setRenaming(current.path);
        break;
      case "Delete":
        void trashMany(chosen());
        break;
      case "Escape":
        if (!picked) return;
        setPicked(null);
        break;
      case "Home":
        selectAt(0);
        break;
      case "End":
        selectAt(rows.length - 1);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  if (!tree) return null;

  const dragged = drag ? findEntry(tree, drag.paths[0]!) : null;
  const pickedPaths = new Set(picked?.paths);
  // The context menu of a picked row acts on all the picked rows.
  const many =
    menu?.entry && pickedPaths.has(menu.entry.path) ? outermost(picked?.paths ?? []) : null;

  const menuDir = menu
    ? menu.entry === null
      ? ""
      : menu.entry.kind === "dir"
        ? menu.entry.path
        : parentPath(menu.entry.path)
    : "";

  return (
    <div className="filetree">
      <div className="filetree-toolbar" role="toolbar" aria-label="File actions">
        <button aria-label="New note" title="New note" onClick={() => void createNote(targetDir())}>
          <FilePlus size={16} />
        </button>
        <button
          aria-label="New folder"
          title="New folder"
          onClick={() => void createFolder(targetDir())}
        >
          <FolderPlus size={16} />
        </button>
        <button aria-label="Collapse all" title="Collapse all" onClick={collapseAll}>
          <ChevronsDownUp size={16} />
        </button>
        <button
          aria-label="Rename selected item"
          title="Rename selected file or folder (F2)"
          disabled={!selected || !findEntry(tree, selected) || renaming !== null}
          onClick={() => selected && setRenaming(selected)}
        >
          <Pencil size={16} />
        </button>
      </div>

      <div
        ref={treeRef}
        className={`filetree-body${drag?.over?.path === "" ? " drop-target" : ""}`}
        role="tree"
        aria-label="Vault files"
        aria-multiselectable="true"
        tabIndex={0}
        aria-activedescendant={selected !== null ? rowId(selected) : undefined}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => actions.openMenu(e, null)}
      >
        {rows.length === 0 && <p className="filetree-empty muted">No notes yet</p>}
        {rows.map(({ entry, depth }, i) => (
          <TreeRow
            key={entry.path}
            entry={entry}
            depth={depth}
            entering={
              openedAt >= 0 && entry.path.startsWith(`${opened}/`) ? i - openedAt - 1 : undefined
            }
            expanded={entry.kind === "dir" && expanded.has(entry.path)}
            selected={entry.path === selected || pickedPaths.has(entry.path)}
            active={entry.path === activePath}
            renaming={entry.path === renaming}
            drop={drag?.over?.path === entry.path ? drag.over.side : undefined}
            dragged={!!drag?.paths.includes(entry.path)}
            customIcon={folderIcons[entry.path]}
            colors={entryColors[entry.path]}
            aiRule={aiFolders[entry.path]}
            dashboard={entry.kind === "dir" && hasDashboard(dashboards, entry.path)}
            actions={actions}
          />
        ))}
      </div>

      {drag && (
        <div
          ref={rootDropRef}
          className={`filetree-root-drop${drag.over?.path === "" ? " drop-target" : ""}`}
          aria-label="Move to vault root"
        >
          <FolderOpen size={14} aria-hidden />
          Move to vault root
        </div>
      )}

      {drag && (
        <div
          className="filetree-ghost"
          aria-hidden
          style={{ transform: `translate(${drag.x + 12}px, ${drag.y + 8}px)` }}
        >
          {drag.paths.length > 1
            ? `${drag.paths.length} items`
            : dragged
              ? displayName(dragged)
              : baseName(drag.paths[0]!)}
        </div>
      )}

      {menu && (
        <ContextMenu
          // A new right-click starts a new menu, with no submenu open.
          key={`${menu.x},${menu.y},${menu.entry?.path ?? ""}`}
          x={menu.x}
          y={menu.y}
          label={
            many
              ? `${many.length} selected items`
              : menu.entry
                ? displayName(menu.entry)
                : "Vault files"
          }
          menuRef={menuRef}
          close={closeMenu}
        >
          {many ? (
            <>
              <MenuGroup>
                <SubMenu label="AI" icon={Sparkles}>
                  <MenuItem
                    label="Send selected notes to AI Chat"
                    icon={MessageSquare}
                    onClick={() => void sendFilesToSidebar(many)}
                  />
                  <MenuItem
                    label="Add to comprehension heatmap…"
                    icon={Grid3x3}
                    onClick={() => useUi.getState().open({ kind: "heatmap-topic", paths: many })}
                  />
                  <SkillsMenu paths={many} />
                </SubMenu>
                <MenuItem
                  label={`Add ${many.length} items to favorites`}
                  icon={Star}
                  onClick={() => void addFavorites(many)}
                />
              </MenuGroup>
              <MenuGroup>
                <MenuItem
                  label={`Copy ${many.length} items`}
                  icon={Copy}
                  onClick={() => copyOrCut(many, "copy")}
                />
                <MenuItem
                  label={`Cut ${many.length} items`}
                  icon={Scissors}
                  onClick={() => copyOrCut(many, "cut")}
                />
                <MenuItem
                  label={`Delete ${many.length} items`}
                  icon={Trash2}
                  danger
                  onClick={() => void trashMany(many)}
                />
              </MenuGroup>
            </>
          ) : (
            <>
              {menu.entry && isOpenable(menu.entry) && (
                <MenuGroup>
                  <MenuItem
                    label="Open in new tab"
                    icon={SquarePlus}
                    onClick={() =>
                      useAppStore.getState().openFile(menu.entry!.path, undefined, { newTab: true })
                    }
                  />
                  <MenuItem
                    label="Open in split screen"
                    icon={Columns2}
                    onClick={() => openInSplit(menu.entry!.path)}
                  />
                  {backend.appWindows && (
                    <MenuItem
                      label="Open in new window"
                      icon={AppWindow}
                      onClick={() => void openInWindow(menu.entry!.path)}
                    />
                  )}
                </MenuGroup>
              )}
              <MenuGroup>
                <MenuItem
                  label="New Note"
                  icon={FilePlus}
                  onClick={() => void createNote(menuDir)}
                />
                <MenuItem
                  label="New Grid"
                  icon={Sheet}
                  onClick={() => void createNote(menuDir, "grid")}
                />
                <MenuItem
                  label="New Canvas"
                  icon={Shapes}
                  onClick={() => void createNote(menuDir, "canvas")}
                />
                <MenuItem
                  label="New Folder"
                  icon={FolderPlus}
                  onClick={() => void createFolder(menuDir)}
                />
              </MenuGroup>
              {menu.entry === null ? (
                (pasteCount > 0 || fileOrder[menuDir]) && (
                  <MenuGroup>
                    <PasteItem count={pasteCount} onPaste={() => void paste(menuDir)} />
                    {fileOrder[menuDir] && (
                      <MenuItem
                        label="Sort A–Z"
                        icon={ArrowDownAZ}
                        onClick={() => void resetOrder(menuDir)}
                      />
                    )}
                  </MenuGroup>
                )
              ) : (
                <EntryMenu
                  entry={menu.entry}
                  sorted={!fileOrder[menuDir]}
                  pasteCount={pasteCount}
                  duplicate={() => void duplicate(menu.entry!.path)}
                  copyOrCut={(mode) => copyOrCut([menu.entry!.path], mode)}
                  paste={() => void paste(menuDir)}
                  resetOrder={() => void resetOrder(menuDir)}
                  rename={() => setRenaming(menu.entry!.path)}
                  trash={() => void trash(menu.entry!)}
                />
              )}
            </>
          )}
        </ContextMenu>
      )}
    </div>
  );
}

/**
 * The groups after "New …" in a file's or folder's menu (T-287): make a copy, move,
 * favorite; AI; icon and colors; then delete, the clipboard and rename. A folder adds
 * "Search in folder", its dashboard and Sort A–Z.
 */
function EntryMenu(props: {
  entry: VaultEntry;
  /** The folder's items are in A–Z order (no order of their own). */
  sorted: boolean;
  pasteCount: number;
  duplicate(): void;
  copyOrCut(mode: "copy" | "cut"): void;
  paste(): void;
  resetOrder(): void;
  rename(): void;
  trash(): void;
}) {
  const { entry } = props;
  const dir = entry.kind === "dir";
  const open = useUi.getState().open;
  return (
    <>
      <MenuGroup>
        {/* Duplicates beside the item ("Name copy"); the last group's Copy is the clipboard. */}
        <MenuItem label="Copy" icon={CopyPlus} onClick={props.duplicate} />
        <MenuItem
          label={dir ? "Move folder" : "Move file"}
          icon={FolderInput}
          onClick={() => open({ kind: "move", path: entry.path })}
        />
        {dir && (
          <MenuItem
            label="Search in folder"
            icon={Search}
            onClick={() => useAppStore.getState().search(folderQuery(entry.path))}
          />
        )}
        <FavoriteItem path={entry.path} />
      </MenuGroup>
      <MenuGroup>
        <AiMenu entry={entry} />
      </MenuGroup>
      <MenuGroup>
        <MenuItem
          label="Change Icon"
          icon={Smile}
          onClick={() => open({ kind: "icon", path: entry.path })}
        />
        <MenuItem
          label="Change Colors"
          icon={Palette}
          onClick={() => open({ kind: "colors", path: entry.path })}
        />
      </MenuGroup>
      {dir && (
        <MenuGroup>
          <DashboardItems path={entry.path} />
          {!props.sorted && (
            <MenuItem label="Sort A–Z" icon={ArrowDownAZ} onClick={props.resetOrder} />
          )}
        </MenuGroup>
      )}
      <MenuGroup>
        {/* The human's order (T-290): Rename, Copy, Cut, then Delete last. */}
        <MenuItem label="Rename" icon={Pencil} onClick={props.rename} />
        <MenuItem label="Copy" icon={Copy} onClick={() => props.copyOrCut("copy")} />
        <MenuItem label="Cut" icon={Scissors} onClick={() => props.copyOrCut("cut")} />
        <PasteItem count={props.pasteCount} onPaste={props.paste} />
        <MenuItem label="Delete" icon={Trash2} danger onClick={props.trash} />
      </MenuGroup>
    </>
  );
}

/** "Open in split screen": a new pane on the right showing the file. */
function openInSplit(path: string) {
  useAppStore.getState().splitPane("right");
  // The new pane is the focused one, with the active tab again: show the file there.
  useAppStore.getState().openFile(path);
}

/** "Open in new window": another app window on the file. */
async function openInWindow(path: string) {
  try {
    await backend.appWindows?.openNote(path);
  } catch (e) {
    useAppStore.getState().setError(`Couldn't open a new window: ${errorMessage(e)}`);
  }
}

/** "AI ▸": the AI chat, skills, and who may read this item (the human's layout, T-289). */
function AiMenu({ entry }: { entry: VaultEntry }) {
  const readable = entry.kind === "dir" || isNotePath(entry.path);
  const path = entry.path;
  return (
    <SubMenu label="AI" icon={Sparkles}>
      {readable && (
        <>
          <MenuItem
            label="Send to AI Chat"
            icon={MessageSquare}
            onClick={() => void sendFilesToSidebar([path])}
          />
          <SkillsMenu paths={[path]} />
        </>
      )}
      <AiAccessMenu path={path} />
    </SubMenu>
  );
}

/** Add a file or folder to the sidebar's Favorites, or take it out (T-275). */
function FavoriteItem({ path }: { path: string }) {
  const has = useConfig((s) => s.config.favorites.includes(path));
  return has ? (
    <MenuItem label="Unfavorite" icon={StarOff} onClick={() => void removeFavorite(path)} />
  ) : (
    <MenuItem label="Favorite" icon={Star} onClick={() => void addFavorites([path])} />
  );
}

/** "Paste", while something copied or cut in this vault waits to be pasted. */
function PasteItem({ count, onPaste }: { count: number; onPaste(): void }) {
  if (!count) return null;
  return (
    <MenuItem
      label={count > 1 ? `Paste ${count} items` : "Paste"}
      icon={ClipboardPaste}
      onClick={onPaste}
    />
  );
}

/** Whether `path` was cut and waits to be pasted. */
function useIsCut(path: string) {
  const root = useAppStore((s) => s.vault?.root);
  return useTreeClipboard((s) => {
    const c = clipFor(s.clip, root);
    return c?.mode === "cut" && c.paths.includes(path);
  });
}

/** Open, add or remove a folder's dashboard. */
function DashboardItems({ path }: { path: string }) {
  const has = useConfig((s) => hasDashboard(s.config.dashboards, path));
  const open = () => useAppStore.getState().openDashboard(path);
  return has ? (
    <>
      <MenuItem label="Open dashboard" icon={LayoutDashboard} onClick={open} />
      <MenuItem
        label="Remove dashboard"
        icon={LayoutDashboard}
        onClick={() => setDashboard(path, false)}
      />
    </>
  ) : (
    <MenuItem
      label="Add dashboard"
      icon={LayoutDashboard}
      onClick={() => {
        setDashboard(path, true);
        open();
      }}
    />
  );
}

/** "AI Access ▸" for an entry; the current rule is checked. */
function AiAccessMenu({ path }: { path: string }) {
  const rule = useConfig((s) => s.config.ai.folders[path]);
  const models = useConfig((s) => s.config.ai.models[path]);
  const set = (r: AiRule | null) =>
    void changeSetting(`AI access for “${baseName(path)}”`, "ai.folders", path, () =>
      useConfig.getState().update((c) => {
        const folders = { ...c.ai.folders };
        if (r === null) delete folders[path];
        else folders[path] = r;
        return { ...c, ai: { ...c.ai, folders } };
      }),
    );
  const items: [AiRule | null, string, LucideIcon][] = [
    [null, "Inherit", Sparkles],
    ["never", "Never", Ban],
    ["local", "Local models only", Cpu],
  ];
  return (
    <SubMenu label="AI Access" icon={ShieldCheck}>
      {items.map(([r, label, icon]) => (
        <MenuItem
          key={label}
          icon={icon}
          label={label}
          checked={(rule ?? null) === r}
          onClick={() => set(r)}
        />
      ))}
      <MenuItem
        icon={ListChecks}
        label={models ? `Allowed models (${models.length})` : "Allowed models"}
        onClick={() => useUi.getState().open({ kind: "allowed-models", path })}
      />
    </SubMenu>
  );
}

/** "AI Skills ▸": every AI skill, on what's picked ("Make a practice test", …). */
function SkillsMenu({ paths }: { paths: string[] }) {
  const skills = useSkills((s) => s.skills);
  const offered = skillsForPicked(skills, paths);
  if (!offered.length) return null;
  return (
    <SubMenu label="AI Skills" icon={Wand2}>
      {offered.map((s) => (
        <MenuItem
          key={s.id}
          label={s.title}
          icon={skillIcon(s.id)}
          onClick={() => void runSkillOnPicked(s, paths)}
        />
      ))}
    </SubMenu>
  );
}

interface TreeRowProps {
  entry: VaultEntry;
  depth: number;
  expanded: boolean;
  selected: boolean;
  active: boolean;
  renaming: boolean;
  /** Where a dragged item would land relative to this row. */
  drop?: DropSide;
  /** This row is being dragged. */
  dragged: boolean;
  customIcon?: FolderIcon;
  colors?: EntryColors;
  aiRule?: AiRule;
  /** A folder with its own dashboard shows a button that opens it. */
  dashboard?: boolean;
  /** Revealed by opening its folder: its place among the folder's rows (they drop in). */
  entering?: number;
  actions: RowActions;
}

const TreeRow = memo(function TreeRow({
  entry,
  depth,
  expanded,
  selected,
  active,
  renaming,
  drop,
  dragged,
  customIcon,
  colors,
  aiRule,
  dashboard,
  entering,
  actions,
}: TreeRowProps) {
  // Cut, waiting to be pasted somewhere else (each row asks, so the tree doesn't redraw).
  const cut = useIsCut(entry.path);
  const own = rowColorProps(rowColors(colors));
  const isDir = entry.kind === "dir";
  const openable = isOpenable(entry);
  const Icon = isDir
    ? expanded
      ? FolderOpen
      : Folder
    : docKind(entry.name) === "grid"
      ? Sheet
      : docKind(entry.name) === "canvas"
        ? Shapes
        : docKind(entry.name) === "image"
          ? Image
          : docKind(entry.name) === "media"
            ? Film
            : docKind(entry.name) === "web"
              ? Globe
              : openable
                ? FileText
                : File;
  const classes = [
    "filetree-row",
    selected && "selected",
    active && "active",
    drop === "into" && "drop-target",
    drop === "before" && "drop-before",
    drop === "after" && "drop-after",
    dragged && "dragged",
    cut && "cut",
    !isDir && !openable && "dimmed",
    entering !== undefined && "entering",
    own.className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      id={rowId(entry.path)}
      data-parent-row={depth > 1 ? rowId(parentPath(entry.path)) : undefined}
      role="treeitem"
      aria-level={depth}
      aria-selected={selected}
      aria-expanded={isDir ? expanded : undefined}
      aria-current={active ? "page" : undefined}
      data-path={entry.path}
      title={`${entry.path}\nDrag to move or reorder. Select and press F2 to rename, Ctrl+C / Ctrl+X / Ctrl+V to copy, cut and paste. Shift+click to select several.`}
      className={classes}
      style={
        {
          ...own.style,
          paddingLeft: 6 + (depth - 1) * 14,
          // Each revealed row starts a little after the one above (capped).
          ...(entering !== undefined && { animationDelay: `${Math.min(entering, 12) * 14}ms` }),
          // The drop line starts where the row's icon does.
          "--drop-indent": `${24 + (depth - 1) * 14}px`,
        } as CSSProperties
      }
      // Ctrl/Cmd+click or middle-click opens in a new tab, as in Obsidian; Shift+click
      // selects every row from the last one clicked to this one.
      onClick={(e) =>
        e.shiftKey ? actions.extend(entry.path) : actions.activate(entry, e.ctrlKey || e.metaKey)
      }
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        // A folder opens its dashboard in a new tab, if it has one.
        if (!isDir) actions.activate(entry, true);
        else if (dashboard) useAppStore.getState().openDashboard(entry.path, { newTab: true });
      }}
      onContextMenu={(e) => actions.openMenu(e, entry)}
      onPointerDown={renaming ? undefined : (e) => actions.press(e, entry.path)}
      onDragStart={(e) => e.preventDefault()}
    >
      <span
        className={isDir && expanded ? "filetree-chevron open" : "filetree-chevron"}
        onClick={
          isDir
            ? (e) => {
                if (e.shiftKey) return; // the row's Shift+click
                e.stopPropagation();
                actions.select(entry.path);
                actions.toggle(entry.path);
              }
            : undefined
        }
      >
        {isDir && <ChevronRight size={14} aria-hidden />}
      </span>
      {customIcon ? (
        <EntryIcon
          icon={customIcon}
          fallback={<Icon size={15} className="filetree-icon" aria-hidden />}
        />
      ) : (
        <Icon size={15} className="filetree-icon" aria-hidden />
      )}
      {renaming ? (
        <RenameInput entry={entry} actions={actions} />
      ) : (
        <span className="filetree-name">{displayName(entry)}</span>
      )}
      {dashboard && (
        <span
          className="filetree-dashboard"
          title="Open dashboard"
          onClick={(e) => {
            e.stopPropagation(); // not the row's own click
            useAppStore.getState().openDashboard(entry.path, { newTab: e.ctrlKey || e.metaKey });
          }}
        >
          <LayoutDashboard size={12} aria-hidden />
          <span className="visually-hidden">, has a dashboard</span>
        </span>
      )}
      {aiRule && aiRule !== "any" && (
        <span
          className={`filetree-ai ai-${aiRule}`}
          title={aiRule === "never" ? "AI: never" : "AI: local models only"}
        >
          {aiRule === "never" ? (
            <Lock size={11} aria-hidden />
          ) : (
            <HardDrive size={11} aria-hidden />
          )}
          <span className="visually-hidden">
            {aiRule === "never" ? ", AI: never" : ", AI: local models only"}
          </span>
        </span>
      )}
    </div>
  );
});

function RenameInput({ entry, actions }: { entry: VaultEntry; actions: RowActions }) {
  const [value, setValue] = useState(displayName(entry));
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) actions.commitRename(entry, value);
    else actions.cancelRename();
  };
  return (
    <input
      className="filetree-rename"
      aria-label="New name"
      value={value}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}
