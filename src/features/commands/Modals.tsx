import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { FileText, FolderInput, Hash, Palette, Shapes, Sheet } from "lucide-react";
import { backend, type VaultEntry } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { BUILTIN_THEMES, THEME_INFO } from "../../app/appearance";
import { docKind } from "../../lib/fileKinds";
import { noteName } from "../../lib/markdown";
import { insertTemplate, listTemplates, newNote, newNoteFromTemplate } from "./actions";
import { PromptDialog } from "./PromptDialog";
import { Picker, type PickerItem } from "./Picker";
import { allCommands, type Command, commandForEvent, hintFor, shortcutOf } from "./registry";
import { commandIcon } from "./commandIcons";
import { moveFile } from "./noteCommands";
import { pushRecent, recentIds, useTrackRecentFiles } from "./recents";
import { useUi } from "./ui";
import { IconPicker } from "../icons/IconPicker";
import { RowColorsDialog } from "../filetree/RowColors";
import { lazyNamed } from "../../app/lazy";
import "./commands.css";

// Dialogs used now and then are loaded on first use, to keep startup small.
const Settings = lazyNamed(() => import("../settings/Settings"), "Settings");
const AskAi = lazyNamed(() => import("../ai/AskAi"), "AskAi");
const FixText = lazyNamed(() => import("../ai/FixText"), "FixText");
const NoteHandwriting = lazyNamed(
  () => import("../handwriting/NoteHandwriting"),
  "NoteHandwriting",
);
const NoteDiagram = lazyNamed(() => import("../diagrams/NoteDiagram"), "NoteDiagram");
const ImportDialog = lazyNamed(() => import("../import/ImportDialog"), "ImportDialog");
const GettingStarted = lazyNamed(() => import("../vault/GettingStarted"), "GettingStarted");

/** Global keyboard shortcuts (capture phase, so they win over the editor). */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The window is frozen while an update installs (T-073): no command may change a
      // document after everything was saved.
      if (document.body.hasAttribute("inert")) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (useUi.getState().modal) return;
      const cmd = commandForEvent(e);
      if (!cmd) return;
      e.preventDefault();
      e.stopPropagation();
      cmd.run();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

const PICKER_KEYS = ["↑↓ choose", "Enter run", "Esc close"];

function CommandPalette() {
  const close = useUi((s) => s.close);
  const items = useMemo(() => {
    const available = allCommands().filter(
      (c) => c.id !== "palette" && (!c.available || c.available()),
    );
    const toItem = (c: Command, section: string): PickerItem => ({
      id: c.id,
      label: c.label,
      icon: commandIcon(c.id),
      hint: shortcutOf(c) ? hintFor(shortcutOf(c)!) : undefined,
      section,
    });
    // Recently run commands first (shown under "Recent" until you type).
    const recent = recentIds("commands")
      .map((id) => available.find((c) => c.id === id))
      .filter((c): c is Command => c !== undefined);
    const rest = available.filter((c) => !recent.includes(c));
    return [
      ...recent.map((c) => toItem(c, "Recent")),
      ...rest.map((c) => toItem(c, recent.length ? "All commands" : "")),
    ];
  }, []);
  return (
    <Picker
      title="Command palette"
      placeholder="Type a command…"
      items={items}
      footer={PICKER_KEYS}
      onClose={close}
      onPick={(item) => {
        close();
        pushRecent("commands", item.id);
        allCommands()
          .find((c) => c.id === item.id)
          ?.run();
      }}
    />
  );
}

const KIND_ICONS = { markdown: FileText, grid: Sheet, canvas: Shapes } as const;
const folderOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined;

/** Grids and canvases in the tree (notes come from the index, with titles and aliases). */
function boardFiles(entry: VaultEntry | null, out: VaultEntry[] = []): VaultEntry[] {
  for (const child of entry?.children ?? []) {
    if (child.kind === "dir") boardFiles(child, out);
    else if (docKind(child.path) === "grid" || docKind(child.path) === "canvas") out.push(child);
  }
  return out;
}

/** The headings of a note's text, outside code blocks. */
function headingsOf(text: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && /^#{1,6}[ \t]+(.+?)[ \t#]*$/.exec(line);
    if (m) out.push(m[1]!);
  }
  return out;
}

function QuickSwitcher() {
  const close = useUi((s) => s.close);
  const notes = useAppStore((s) => s.notes);
  const tree = useAppStore((s) => s.tree);
  const openFile = useAppStore((s) => s.openFile);
  const files = useMemo<PickerItem[]>(() => {
    const all: PickerItem[] = [
      ...notes.map((n) => ({
        id: n.path,
        label: n.name,
        detail: folderOf(n.path),
        keywords: [n.title ?? "", ...n.aliases].join(" "),
        icon: KIND_ICONS.markdown,
      })),
      ...boardFiles(tree).map((f) => ({
        id: f.path,
        label: f.name.replace(/\.(axgrid|axcanvas)$/i, ""),
        detail: folderOf(f.path),
        icon: docKind(f.path) === "grid" ? KIND_ICONS.grid : KIND_ICONS.canvas,
      })),
    ];
    // Recently opened files first (shown under "Recent" until you type).
    const byId = new Map(all.map((i) => [i.id, i]));
    const recent = recentIds("files")
      .filter((id) => id !== useAppStore.getState().activePath)
      .map((id) => byId.get(id))
      .filter((i): i is PickerItem => i !== undefined);
    const rest = all
      .filter((i) => !recent.includes(i))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    return [
      ...recent.map((i) => ({ ...i, section: "Recent" })),
      ...rest.map((i) => ({ ...i, section: recent.length ? "All files" : "" })),
    ];
  }, [notes, tree]);

  // "Note#heading" lists that note's headings.
  const [headings, setHeadings] = useState<{ path: string; list: string[] } | null>(null);
  const loading = useRef("");
  const onQueryChange = (q: string) => {
    const hash = q.indexOf("#");
    if (hash === -1) {
      loading.current = "";
      setHeadings(null);
      return;
    }
    const name = q.slice(0, hash).trim().toLowerCase();
    const note = name
      ? (notes.find((n) => n.name.toLowerCase() === name) ??
        notes.find((n) => n.name.toLowerCase().startsWith(name)))
      : notes.find((n) => n.path === useAppStore.getState().activePath);
    if (!note || loading.current === note.path) return;
    loading.current = note.path;
    void backend.readFile(note.path).then(
      (f) =>
        loading.current === note.path &&
        setHeadings({ path: note.path, list: headingsOf(f.content) }),
      () => {},
    );
  };
  const headingItems = useMemo<PickerItem[] | null>(
    () =>
      headings &&
      headings.list.map((h, i) => ({
        id: `${headings.path}#${i}`,
        label: h,
        detail: noteName(headings.path),
        icon: Hash,
      })),
    [headings],
  );

  return (
    <Picker
      title="Quick switcher"
      placeholder="Find or create a note… (Note#heading jumps to a heading)"
      items={headingItems ?? files}
      limit={100}
      footer={["↑↓ choose", "Enter open", "Ctrl+Enter new tab", "# heading"]}
      onClose={close}
      onQueryChange={onQueryChange}
      matchQuery={(q) => (headingItems && q.includes("#") ? q.slice(q.indexOf("#") + 1) : q)}
      canCreate={(q) => !q.includes("#")}
      // Ctrl+Enter (or Ctrl+click) opens the note in a new tab, as in Obsidian.
      onPick={(item, { mod }) => {
        close();
        if (headings && headingItems?.includes(item)) {
          openFile(headings.path, { heading: item.label }, { newTab: mod });
        } else openFile(item.id, undefined, { newTab: mod });
      }}
      onCreate={(name) => {
        close();
        void newNote(name, "");
      }}
      createLabel={(q) => `Create note "${q}"`}
    />
  );
}

/** Choose a folder to move a file into. */
function MovePicker({ path }: { path: string }) {
  const close = useUi((s) => s.close);
  const tree = useAppStore((s) => s.tree);
  const items = useMemo<PickerItem[]>(() => {
    const dirs: string[] = [];
    const walk = (e: VaultEntry | null) => {
      for (const c of e?.children ?? []) {
        if (c.kind !== "dir") continue;
        dirs.push(c.path);
        walk(c);
      }
    };
    walk(tree);
    const here = folderOf(path) ?? "";
    return [
      { id: "", label: "Vault folder (top level)" },
      ...dirs.map((d) => ({ id: d, label: d })),
    ]
      .filter((i) => i.id !== here)
      .map((i) => ({ ...i, icon: FolderInput }));
  }, [tree, path]);
  return (
    <Picker
      title={`Move "${noteName(path.slice(path.lastIndexOf("/") + 1))}" to`}
      placeholder="Choose a folder…"
      items={items}
      footer={["↑↓ choose", "Enter move", "Esc close"]}
      onClose={close}
      onPick={(item) => {
        close();
        void moveFile(path, item.id);
      }}
    />
  );
}

/** Choose one of the built-in themes. */
function ThemeChooser() {
  const close = useUi((s) => s.close);
  const current = useConfig((s) => s.config.theme);
  const items = useMemo<PickerItem[]>(
    () =>
      BUILTIN_THEMES.map((t) => ({
        id: t,
        label: THEME_INFO[t].label,
        detail: t === current ? `${THEME_INFO[t].note} · current` : THEME_INFO[t].note,
        icon: Palette,
      })),
    [current],
  );
  return (
    <Picker
      title="Choose theme"
      placeholder="Choose a theme… (your own themes are in Settings → Appearance)"
      items={items}
      footer={["↑↓ choose", "Enter apply", "Esc close"]}
      onClose={close}
      onPick={(item) => {
        close();
        void useConfig.getState().update((c) => ({ ...c, theme: item.id }));
      }}
    />
  );
}

function TemplatePicker({ mode }: { mode: "insert" | "new" }) {
  const close = useUi((s) => s.close);
  const templates = useMemo(() => listTemplates(), []);
  const items = templates.map((t) => ({ id: t.id, label: t.name, detail: t.path ?? "built-in" }));
  return (
    <Picker
      title={mode === "insert" ? "Insert template" : "New note from template"}
      placeholder="Choose a template…"
      items={items}
      onClose={close}
      onPick={(item) => {
        close();
        const t = templates.find((x) => x.id === item.id)!;
        void (mode === "insert" ? insertTemplate(t) : newNoteFromTemplate(t));
      }}
    />
  );
}

/**
 * Dialogs close on Escape while focus is inside them. If the focused control goes away
 * (say a button that disappears once clicked), focus falls back to the page. In that case,
 * hand Escape to the open dialog so its own rules still apply (e.g. not while busy).
 */
function useEscapeWithoutFocus(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Only presses aimed at the page itself (the re-sent one targets the dialog).
      if (e.target !== document.body && e.target !== document.documentElement) return;
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
      const dialog = dialogs[dialogs.length - 1];
      dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
}

export function Modals() {
  useShortcuts();
  useTrackRecentFiles();
  const modal = useUi((s) => s.modal);
  useEscapeWithoutFocus(modal !== null);
  if (!modal) return null;
  return <Suspense fallback={null}>{renderModal(modal)}</Suspense>;
}

function renderModal(modal: NonNullable<ReturnType<typeof useUi.getState>["modal"]>) {
  switch (modal.kind) {
    case "palette":
      return <CommandPalette />;
    case "switcher":
      return <QuickSwitcher />;
    case "templates":
      return <TemplatePicker mode={modal.mode} />;
    case "settings":
      return <Settings section={modal.section} onClose={() => useUi.getState().close()} />;
    case "getting-started":
      return <GettingStarted onClose={() => useUi.getState().close()} />;
    case "ask":
      return (
        <AskAi
          path={modal.path}
          selection={modal.selection}
          onClose={() => useUi.getState().close()}
        />
      );
    case "fix":
      return <FixText {...modal} onClose={() => useUi.getState().close()} />;
    case "handwriting":
      return <NoteHandwriting path={modal.path} onClose={() => useUi.getState().close()} />;
    case "import":
      return <ImportDialog onClose={() => useUi.getState().close()} />;
    case "move":
      return <MovePicker path={modal.path} />;
    case "themes":
      return <ThemeChooser />;
    case "diagram":
      return (
        <NoteDiagram
          path={modal.path}
          selection={modal.selection}
          onClose={() => useUi.getState().close()}
        />
      );
    case "icon":
      return <IconPicker path={modal.path} onClose={() => useUi.getState().close()} />;
    case "colors":
      return <RowColorsDialog path={modal.path} onClose={() => useUi.getState().close()} />;
    case "prompt":
      return (
        <PromptDialog
          title={modal.title}
          questions={modal.questions}
          initial={modal.initial}
          onDone={modal.resolve}
        />
      );
  }
}
