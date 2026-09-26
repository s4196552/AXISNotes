import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  File,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
} from "lucide-react";
import { backend, isBackendError, type VaultEntry } from "../../ipc";
import { useAppStore } from "../../app/store";
import { type FolderIcon, useConfig } from "../../app/config";
import { useUi } from "../commands/ui";
import { EntryIcon } from "../icons/EntryIcon";
import {
  baseName,
  canMove,
  displayName,
  findEntry,
  isOpenable,
  joinPath,
  parentPath,
  remapPaths,
  renamedName,
  uniqueName,
  visibleRows,
} from "./treeModel";
import { useExpanded } from "./useExpanded";
import "./filetree.css";

interface MenuState {
  x: number;
  y: number;
  /** null = the empty area / vault root. */
  entry: VaultEntry | null;
}

/** Everything a row can trigger. Kept in one stable object so rows can be memoized. */
interface RowActions {
  select(path: string): void;
  activate(entry: VaultEntry): void;
  toggle(path: string): void;
  openMenu(e: React.MouseEvent, entry: VaultEntry | null): void;
  commitRename(entry: VaultEntry, input: string): void;
  cancelRename(): void;
  dragStart(path: string): void;
  dragOver(e: React.DragEvent, dir: string): void;
  drop(e: React.DragEvent, dir: string): void;
}

/** Move icon settings along with a renamed entry (or drop them when `to` is null). */
async function remapIcons(from: string, to: string | null) {
  const icons = useConfig.getState().config.folderIcons;
  const affected = Object.keys(icons).filter((k) => k === from || k.startsWith(from + "/"));
  if (affected.length === 0) return;
  await useConfig.getState().update((c) => {
    const folderIcons = { ...c.folderIcons };
    for (const k of affected) {
      const icon = folderIcons[k]!;
      delete folderIcons[k];
      if (to !== null) folderIcons[to + k.slice(from.length)] = icon;
    }
    return { ...c, folderIcons };
  });
}

const errorMessage = (e: unknown) => (isBackendError(e) ? e.message : String(e));
const rowId = (path: string) => `filetree-row-${encodeURIComponent(path)}`;

export function FileTree() {
  const vault = useAppStore((s) => s.vault);
  const tree = useAppStore((s) => s.tree);
  const folderIcons = useConfig((s) => s.config.folderIcons);
  const activePath = useAppStore((s) => s.activePath);
  const { expanded, toggle, collapseAll, update: updateExpanded } = useExpanded(vault?.root ?? "");

  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragging = useRef<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => visibleRows(tree, expanded), [tree, expanded]);

  // Latest state for the stable action callbacks below.
  const latest = useRef({ tree, selected });
  useLayoutEffect(() => {
    latest.current = { tree, selected };
  }, [tree, selected]);

  const run = useCallback(async (op: () => Promise<void>) => {
    try {
      await op();
    } catch (e) {
      useAppStore.getState().setError(errorMessage(e));
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
    (dir: string) =>
      run(async () => {
        const path = joinPath(dir, uniqueName(childNames(dir), "Untitled", ".md"));
        await backend.createFile(path, "");
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
        updateExpanded((prev) => remapPaths(prev, from, to));
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
        await backend.trashEntry(entry.path);
        const store = useAppStore.getState();
        await store.refreshTree();
        store.onEntryRemoved(entry.path);
        await remapIcons(entry.path, null);
        setSelected((s) => (s && (s === entry.path || s.startsWith(entry.path + "/")) ? null : s));
      }),
    [run],
  );

  const actions = useMemo<RowActions>(
    () => ({
      select: setSelected,
      activate(entry) {
        setSelected(entry.path);
        if (entry.kind === "dir") toggle(entry.path);
        else if (isOpenable(entry)) useAppStore.getState().openFile(entry.path);
      },
      toggle: (path) => toggle(path),
      openMenu(e, entry) {
        e.preventDefault();
        e.stopPropagation();
        if (entry) setSelected(entry.path);
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
      dragStart(path) {
        dragging.current = path;
      },
      dragOver(e, dir) {
        const src = dragging.current;
        if (src !== null && canMove(src, dir)) {
          e.preventDefault();
          e.stopPropagation();
          setDropTarget(dir);
        }
      },
      drop(e, dir) {
        e.preventDefault();
        e.stopPropagation();
        const src = dragging.current;
        dragging.current = null;
        setDropTarget(null);
        if (src !== null && canMove(src, dir)) void move(src, joinPath(dir, baseName(src)));
      },
    }),
    [toggle, move],
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

  // Keep the selected row in view during keyboard navigation.
  useEffect(() => {
    if (selected === null) return;
    document.getElementById(rowId(selected))?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (renaming !== null || rows.length === 0) return;
    const index = rows.findIndex((r) => r.entry.path === selected);
    const current = index >= 0 ? rows[index]!.entry : null;
    const selectAt = (i: number) =>
      setSelected(rows[Math.max(0, Math.min(rows.length - 1, i))]!.entry.path);

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
        if (current) void trash(current);
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
      </div>

      <div
        ref={treeRef}
        className={`filetree-body${dropTarget === "" ? " drop-target" : ""}`}
        role="tree"
        aria-label="Vault files"
        tabIndex={0}
        aria-activedescendant={selected !== null ? rowId(selected) : undefined}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => actions.openMenu(e, null)}
        onDragOver={(e) => actions.dragOver(e, "")}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(e) => actions.drop(e, "")}
        onDragEnd={() => {
          dragging.current = null;
          setDropTarget(null);
        }}
      >
        {rows.length === 0 && <p className="filetree-empty muted">No notes yet</p>}
        {rows.map(({ entry, depth }) => (
          <TreeRow
            key={entry.path}
            entry={entry}
            depth={depth}
            expanded={entry.kind === "dir" && expanded.has(entry.path)}
            selected={entry.path === selected}
            active={entry.path === activePath}
            renaming={entry.path === renaming}
            dropTarget={entry.path === dropTarget}
            customIcon={folderIcons[entry.path]}
            actions={actions}
          />
        ))}
      </div>

      {menu && (
        <div
          className="filetree-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MenuItem
            label="New note here"
            onClick={() => void createNote(menuDir)}
            close={setMenu}
          />
          <MenuItem
            label="New folder here"
            onClick={() => void createFolder(menuDir)}
            close={setMenu}
          />
          {menu.entry && (
            <>
              <MenuItem
                label="Rename"
                onClick={() => setRenaming(menu.entry!.path)}
                close={setMenu}
              />
              <MenuItem
                label="Change icon…"
                onClick={() => useUi.getState().open({ kind: "icon", path: menu.entry!.path })}
                close={setMenu}
              />
              <MenuItem
                label="Delete"
                danger
                onClick={() => void trash(menu.entry!)}
                close={setMenu}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem(props: {
  label: string;
  danger?: boolean;
  onClick(): void;
  close(v: null): void;
}) {
  return (
    <button
      role="menuitem"
      className={props.danger ? "danger" : undefined}
      onClick={() => {
        props.close(null);
        props.onClick();
      }}
    >
      {props.label}
    </button>
  );
}

interface TreeRowProps {
  entry: VaultEntry;
  depth: number;
  expanded: boolean;
  selected: boolean;
  active: boolean;
  renaming: boolean;
  dropTarget: boolean;
  customIcon?: FolderIcon;
  actions: RowActions;
}

const TreeRow = memo(function TreeRow({
  entry,
  depth,
  expanded,
  selected,
  active,
  renaming,
  dropTarget,
  customIcon,
  actions,
}: TreeRowProps) {
  const isDir = entry.kind === "dir";
  const openable = isOpenable(entry);
  const Icon = isDir ? (expanded ? FolderOpen : Folder) : openable ? FileText : File;
  const classes = [
    "filetree-row",
    selected && "selected",
    active && "active",
    dropTarget && "drop-target",
    !isDir && !openable && "dimmed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      id={rowId(entry.path)}
      role="treeitem"
      aria-level={depth}
      aria-selected={selected}
      aria-expanded={isDir ? expanded : undefined}
      aria-current={active ? "page" : undefined}
      data-path={entry.path}
      className={classes}
      style={{ paddingLeft: 6 + (depth - 1) * 14 }}
      draggable={!renaming}
      onClick={() => actions.activate(entry)}
      onContextMenu={(e) => actions.openMenu(e, entry)}
      onDragStart={(e) => {
        e.dataTransfer?.setData("text/plain", entry.path);
        actions.dragStart(entry.path);
      }}
      onDragOver={isDir ? (e) => actions.dragOver(e, entry.path) : undefined}
      onDrop={isDir ? (e) => actions.drop(e, entry.path) : undefined}
    >
      <span
        className="filetree-chevron"
        onClick={
          isDir
            ? (e) => {
                e.stopPropagation();
                actions.select(entry.path);
                actions.toggle(entry.path);
              }
            : undefined
        }
      >
        {isDir && (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
      </span>
      {customIcon ? (
        <EntryIcon icon={customIcon} />
      ) : (
        <Icon size={15} className="filetree-icon" aria-hidden />
      )}
      {renaming ? (
        <RenameInput entry={entry} actions={actions} />
      ) : (
        <span className="filetree-name">{displayName(entry)}</span>
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
