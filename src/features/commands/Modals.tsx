import { FeatureBoundary } from "../modules/FeatureBoundary";
import { Suspense, useEffect, useMemo } from "react";
import { useConfig } from "../../app/config";
import { isFeatureEnabled } from "../modules/features";
import { useAppStore } from "../../app/store";
import { insertTemplate, listTemplates, newNote, newNoteFromTemplate } from "./actions";
import { PromptDialog } from "./PromptDialog";
import { Picker, type PickerItem } from "./Picker";
import { allCommands, commandForEvent, hintFor, shortcutOf } from "./registry";
import { useUi } from "./ui";
import { IconPicker } from "../icons/IconPicker";
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
  useConfig((s) => s.config.features);
  useConfig((s) => s.config.hotkeys);
  const items = allCommands()
    .filter((c) => c.id !== "palette")
    .map((c) => ({
      id: c.id,
      label: c.label,
      hint: shortcutOf(c) ? hintFor(shortcutOf(c)!) : undefined,
    }));
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
  const modal = useUi((s) => s.modal);
  useConfig((s) => s.config.features);
  useEscapeWithoutFocus(modal !== null);
  if (!modal) return null;
  return (
    <FeatureBoundary
      key={modal.kind === "settings" ? "settings:" + modal.section : modal.kind}
      name="Tool"
      onDismiss={() => useUi.getState().close()}
    >
      <Suspense fallback={null}>{renderModal(modal)}</Suspense>
    </FeatureBoundary>
  );
}

function renderModal(modal: NonNullable<ReturnType<typeof useUi.getState>["modal"]>) {
  const feature =
    modal.kind === "ask" || modal.kind === "fix"
      ? "aiAssist"
      : modal.kind === "handwriting"
        ? "handwriting"
        : modal.kind === "diagram"
          ? "diagrams"
          : null;
  if (feature && !isFeatureEnabled(feature))
    return (
      <div className="modal-backdrop">
        <div className="modal" role="dialog" aria-label="Feature disabled">
          <p>This feature is disabled. Enable it in Settings → Features.</p>
          <button onClick={() => useUi.getState().close()}>Close</button>
        </div>
      </div>
    );
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
