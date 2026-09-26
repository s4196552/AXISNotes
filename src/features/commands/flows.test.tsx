import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { formatDate } from "../../lib/dates";
import { Calendar } from "../daily/Calendar";
import { setActiveEditor } from "../editor/activeEditor";
import { BUILTIN_TEMPLATES } from "../templates/templates";
import { insertTemplate } from "./actions";
import { Modals } from "./Modals";
import { useUi } from "./ui";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const today = formatDate(new Date(), "YYYY-MM-DD");

beforeEach(async () => {
  h.b = createMemoryBackend({
    "Plan.md": "# Plan",
    "Work/Roadmap.md": "---\naliases: [RM]\n---\n",
    "Templates/Standup.md": "# Standup {{date}}\n- {{cursor}}",
  });
  useConfig.setState({ config: DEFAULT_CONFIG, loaded: true });
  useUi.setState({ modal: null });
  useAppStore.setState({
    vault: { root: "/v", name: "V" },
    activePath: null,
    pendingTarget: null,
    error: null,
  });
  await act(() => useAppStore.getState().refreshTree());
});

const key = (k: string, opts: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...opts }));
  });

describe("command palette and quick switcher", () => {
  it("runs commands from the palette (Ctrl+P → daily note)", async () => {
    render(<Modals />);
    key("p", { ctrlKey: true });
    const input = screen.getByRole("combobox", { name: "Command palette" });
    fireEvent.change(input, { target: { value: "daily" } });
    expect(within(screen.getByRole("listbox")).getAllByRole("option")[0]).toHaveTextContent(
      "Open today's daily note",
    );
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(useAppStore.getState().activePath).toBe(`Daily/${today}.md`));
    expect(h.b.files()[`Daily/${today}.md`]).toMatch(/^# \w+day, /);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens notes by name or alias and creates missing ones (Ctrl+O)", async () => {
    render(<Modals />);
    key("o", { ctrlKey: true });
    let input = screen.getByRole("combobox", { name: "Quick switcher" });
    fireEvent.change(input, { target: { value: "rm" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useAppStore.getState().activePath).toBe("Work/Roadmap.md");

    key("o", { ctrlKey: true });
    input = screen.getByRole("combobox", { name: "Quick switcher" });
    fireEvent.change(input, { target: { value: "Brand New" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { selected: true })).toHaveTextContent(
      'Create note "Brand New"',
    );
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(useAppStore.getState().activePath).toBe("Brand New.md"));
  });

  it("closes on Escape and ignores shortcuts while open", async () => {
    render(<Modals />);
    key("p", { ctrlKey: true });
    key("o", { ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("templates", () => {
  it("creates a note from a template, asking for the title and prompts", async () => {
    useAppStore.setState({ activePath: "Work/Roadmap.md" });
    render(<Modals />);
    act(() => useUi.getState().open({ kind: "templates", mode: "new" }));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options[0]).toContain("Standup"); // user templates first
    fireEvent.click(screen.getByRole("option", { name: /Meeting/ }));

    const dialog = await screen.findByRole("dialog", { name: /New note from/ });
    fireEvent.change(within(dialog).getByLabelText("Note title"), { target: { value: "Sync" } });
    fireEvent.change(within(dialog).getByLabelText("Meeting topic"), {
      target: { value: "Q4 plans" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

    await waitFor(() => expect(useAppStore.getState().activePath).toBe("Work/Sync.md"));
    const text = h.b.files()["Work/Sync.md"]!;
    expect(text).toContain(`date: ${today}`);
    expect(text).toContain("# Q4 plans");
    expect(useAppStore.getState().pendingTarget).toEqual({ path: "Work/Sync.md", line: 9 });
  });

  it("inserts a template at the cursor and merges its properties", async () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "---\nstatus: draft\n---\nIntro\n",
        selection: { anchor: 28 },
      }),
    });
    setActiveEditor(view, "Lecture.md");
    await insertTemplate(BUILTIN_TEMPLATES.find((t) => t.id === "builtin:cornell")!);
    const doc = view.state.doc.toString();
    expect(doc.startsWith("---\nstatus: draft\naxis-style: cornell\n---\nIntro\n# Lecture")).toBe(
      true,
    );
    expect(doc).toContain("## Cues");
    const head = view.state.selection.main.head;
    expect(doc.slice(head - "## Notes\n\n".length, head)).toBe("## Notes\n\n");
    setActiveEditor(null);
  });
});

describe("calendar", () => {
  it("marks days with notes and opens or creates daily notes", async () => {
    const d = new Date(2026, 8, 6);
    h.b = createMemoryBackend({ "Daily/2026-09-06.md": "x" });
    await act(() => useAppStore.getState().refreshTree());
    render(<Calendar today={d} />);
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    const sixth = screen.getByRole("gridcell", { name: "Sunday, September 6, 2026 (has note)" });
    expect(sixth).toHaveClass("today", "has-note");

    fireEvent.click(screen.getByRole("gridcell", { name: "Monday, September 7, 2026" }));
    await waitFor(() => expect(useAppStore.getState().activePath).toBe("Daily/2026-09-07.md"));
    expect(h.b.files()["Daily/2026-09-07.md"]).toContain("Monday, September 7, 2026");

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("October 2026")).toBeInTheDocument();
  });
});
