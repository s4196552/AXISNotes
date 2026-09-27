import { useEffect, useMemo } from "react";
import { useAppStore } from "../../app/store";
import { insertTemplate, listTemplates, newNote, newNoteFromTemplate } from "./actions";
import { PromptDialog } from "./PromptDialog";
import { Picker, type PickerItem } from "./Picker";
import { allCommands, commandForEvent, hintFor, shortcutOf } from "./registry";
import { useUi } from "./ui";
import { IconPicker } from "../icons/IconPicker";
import { Settings } from "../settings/Settings";
import { AskAi } from "../ai/AskAi";
import { FixText } from "../ai/FixText";
import { NoteHandwriting } from "../handwriting/NoteHandwriting";
import { NoteDiagram } from "../diagrams/NoteDiagram";
import { ImportDialog } from "../import/ImportDialog";
import { GettingStarted } from "../vault/GettingStarted";
import "./commands.css";

/** Global keyboard shortcuts (capture phase, so they win over the editor). */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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

function CommandPalette() {
  const close = useUi((s) => s.close);
  const items = useMemo(
    () =>
      allCommands()
        .filter((c) => c.id !== "palette")
        .map((c) => ({
          id: c.id,
          label: c.label,
          hint: shortcutOf(c) ? hintFor(shortcutOf(c)!) : undefined,
        })),
    [],
  );
  return (
    <Picker
      title="Command palette"
      placeholder="Type a command…"
      items={items}
      onClose={close}
      onPick={(item) => {
        close();
        allCommands()
          .find((c) => c.id === item.id)
          ?.run();
      }}
    />
  );
}

function QuickSwitcher() {
  const close = useUi((s) => s.close);
  const notes = useAppStore((s) => s.notes);
  const openFile = useAppStore((s) => s.openFile);
  const items = useMemo<PickerItem[]>(
    () =>
      notes.map((n) => ({
        id: n.path,
        label: n.name,
        detail: n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : undefined,
        keywords: [n.title ?? "", ...n.aliases].join(" "),
      })),
    [notes],
  );
  return (
    <Picker
      title="Quick switcher"
      placeholder="Find or create a note…"
      items={items}
      limit={100}
      onClose={close}
      onPick={(item) => {
        close();
        openFile(item.id);
      }}
      onCreate={(name) => {
        close();
        void newNote(name, "");
      }}
      createLabel={(q) => `Create note "${q}"`}
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

export function Modals() {
  useShortcuts();
  const modal = useUi((s) => s.modal);
  if (!modal) return null;
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
