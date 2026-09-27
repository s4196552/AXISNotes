import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { effectiveMode } from "../../app/appearance";
import { useTimer } from "../time/timer";
import {
  copyBlockLink,
  newCanvas,
  newGrid,
  newNote,
  openAskAi,
  openDailyNote,
  openFixText,
  openHandwriting,
  openDiagram,
} from "./actions";
import { useUi } from "./ui";
import { useEditorPrefs } from "../editor/prefs";

export interface Command {
  id: string;
  label: string;
  /** Display form of the shortcut, e.g. "Ctrl+P". */
  hint?: string;
  /** Matcher for the global shortcut (mod = Ctrl, or Cmd on macOS). */
  shortcut?: { key: string; mod?: boolean; shift?: boolean; alt?: boolean };
  run(): void;
}

const commands: Command[] = [];

/** Add commands (features register theirs at import time). Later ids replace earlier ones. */
export function registerCommands(list: Command[]) {
  for (const c of list) {
    const i = commands.findIndex((x) => x.id === c.id);
    if (i === -1) commands.push(c);
    else commands[i] = c;
  }
}

export function allCommands(): readonly Command[] {
  return commands;
}

export function hintFor(s: NonNullable<Command["shortcut"]>): string {
  return [
    s.mod && "Ctrl",
    s.shift && "Shift",
    s.alt && "Alt",
    s.key.length === 1 ? s.key.toUpperCase() : s.key,
  ]
    .filter(Boolean)
    .join("+");
}

registerCommands([
  {
    id: "palette",
    label: "Open command palette",
    shortcut: { key: "p", mod: true },
    run: () => useUi.getState().open({ kind: "palette" }),
  },
  {
    id: "switcher",
    label: "Quick switcher: open a note",
    shortcut: { key: "o", mod: true },
    run: () => useUi.getState().open({ kind: "switcher" }),
  },
  {
    id: "new-note",
    label: "New note",
    shortcut: { key: "n", mod: true },
    run: () => void newNote(),
  },
  {
    id: "tasks",
    label: "Open tasks",
    shortcut: { key: "t", mod: true, shift: true },
    run: () => useAppStore.getState().setMainView("tasks"),
  },
  {
    id: "ask-ai",
    label: "Ask AI about this note",
    shortcut: { key: "j", mod: true },
    run: openAskAi,
  },
  {
    id: "fix-writing",
    label: "Fix grammar and clarity (AI)",
    shortcut: { key: "g", mod: true, shift: true },
    run: openFixText,
  },
  { id: "handwriting", label: "Handwriting to text (pen)", run: openHandwriting },
  { id: "diagram", label: "Make a diagram (AI, or from notes)", run: openDiagram },
  { id: "time", label: "Time report", run: () => useAppStore.getState().setMainView("time") },
  { id: "stop-timer", label: "Stop timer", run: () => void useTimer.getState().stop() },
  { id: "new-grid", label: "New grid (spreadsheet)", run: () => void newGrid() },
  { id: "new-canvas", label: "New canvas (whiteboard)", run: () => void newCanvas() },
  {
    id: "daily",
    label: "Open today's daily note",
    shortcut: { key: "d", mod: true, shift: true },
    run: () => void openDailyNote(),
  },
  {
    id: "search",
    label: "Search in vault",
    shortcut: { key: "f", mod: true, shift: true },
    run: () => useAppStore.getState().setLeftPanel("search"),
  },
  {
    id: "graph",
    label: "Open graph view",
    shortcut: { key: "g", mod: true },
    run: () => useAppStore.getState().setMainView("graph"),
  },
  {
    id: "show-files",
    label: "Show files",
    run: () => useAppStore.getState().setLeftPanel("files"),
  },
  { id: "show-tags", label: "Show tags", run: () => useAppStore.getState().setLeftPanel("tags") },
  {
    id: "insert-template",
    label: "Insert template",
    shortcut: { key: "t", mod: true, alt: true },
    run: () => useUi.getState().open({ kind: "templates", mode: "insert" }),
  },
  {
    id: "new-from-template",
    label: "New note from template",
    run: () => useUi.getState().open({ kind: "templates", mode: "new" }),
  },
  { id: "close-note", label: "Close note", run: () => useAppStore.getState().openFile(null) },
  {
    id: "copy-block-link",
    label: "Copy link to block",
    shortcut: { key: "b", mod: true, shift: true },
    run: () => void copyBlockLink(false),
  },
  {
    id: "copy-block-embed",
    label: "Copy embed of block",
    run: () => void copyBlockLink(true),
  },
  {
    id: "outline-view",
    label: "Toggle outline view",
    run: () => useEditorPrefs.getState().toggleOutlineView(),
  },
  {
    id: "settings",
    label: "Open settings",
    shortcut: { key: ",", mod: true },
    run: () => useUi.getState().open({ kind: "settings" }),
  },
  {
    id: "toggle-theme",
    label: "Toggle light/dark theme",
    run: () =>
      void useConfig.getState().update((c) => ({
        ...c,
        theme: effectiveMode(c.theme) === "dark" ? "light" : "dark",
      })),
  },
]);

/** Find the command bound to a keyboard event, if any. */
export function commandForEvent(e: KeyboardEvent): Command | undefined {
  const mod = e.ctrlKey || e.metaKey;
  return commands.find(
    (c) =>
      c.shortcut &&
      c.shortcut.key.toLowerCase() === e.key.toLowerCase() &&
      Boolean(c.shortcut.mod) === mod &&
      Boolean(c.shortcut.shift) === e.shiftKey &&
      Boolean(c.shortcut.alt) === e.altKey,
  );
}
