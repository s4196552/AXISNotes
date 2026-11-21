import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { setAiResponder } from "../../ipc/memoryAi";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { singlePane } from "../../app/panes";
import { initialTabs, activeTab } from "../../app/tabs";
import { aiBlocks, discardParkedBlocks, openAiBlock } from "../ai/aiBlock";
import { clearModelCache, useAiBlocks } from "../ai/aiBlockStore";
import { SkillResultsSidebar } from "./SkillResultsSidebar";
import {
  loadSkillDestination,
  openSkillSource,
  saveSkillDestination,
  useSkillResults,
} from "./skillDestination";
import { PAGE_SANDBOX } from "../drafts/WebFileView";
import { openSidebarChat } from "../ai/sidebarChatState";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => ({
  ...(await orig<typeof import("../../ipc")>()),
  backend: new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] }),
}));
const source = "# Cells\n\nMitochondria make ATP.\n";
let view: EditorView;
beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});
beforeEach(async () => {
  localStorage.clear();
  h.b = createMemoryBackend({ "Bio/Cells.md": source, "Other.md": "Other note" });
  const vault = await h.b.openVault("/destinations");
  const { settings } = await h.b.aiSettings();
  await h.b.aiSaveSettings({
    ...settings,
    providers: [{ id: "ollama", kind: "ollama", name: "Local", baseUrl: "", enabled: true }],
  });
  const panes = singlePane(initialTabs());
  useAppStore.setState({
    vault,
    panes,
    tabs: panes.tabs[panes.focused]!,
    activePath: null,
    mainView: "note",
  });
  useAppStore.getState().openFile("Bio/Cells.md");
  useConfig.setState((s) => ({ config: { ...s.config, ai: { folders: {}, models: {} } } }));
  clearModelCache();
  view = new EditorView({
    parent: document.body.appendChild(document.createElement("div")),
    state: EditorState.create({ doc: source, extensions: aiBlocks("Bio/Cells.md") }),
  });
});
afterEach(async () => {
  view.destroy();
  await act(async () => {});
  discardParkedBlocks();
  useAiBlocks.setState({ blocks: {} });
  useSkillResults.setState({ open: false, selected: null });
  setAiResponder(null);
  vi.restoreAllMocks();
  cleanup();
  document.body.innerHTML = "";
});
async function start(skill = "mindmap", destination = "sidebar") {
  let id = "";
  act(() => {
    id = openAiBlock(view, undefined, { skill });
  });
  const block = within(
    await waitFor(() => screen.getAllByRole("group", { name: "AI block" }).at(-1)!),
  );
  fireEvent.change(block.getByRole("combobox", { name: "Results in" }), {
    target: { value: destination },
  });
  return { id, block };
}

describe("AI skill result destinations", () => {
  it("remembers a validated choice for this vault and device", () => {
    expect(loadSkillDestination("/a")).toBe("note");
    saveSkillDestination("/a", "sidebar");
    expect(loadSkillDestination("/a")).toBe("sidebar");
    expect(loadSkillDestination("/b")).toBe("note");
    localStorage.setItem("axis.skill.destination:/a", "broken");
    expect(loadSkillDestination("/a")).toBe("note");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw Error("blocked");
    });
    expect(loadSkillDestination("/a")).toBe("note");
  });

  it("lets a direct editor chat action switch away from the results tab", () => {
    useSkillResults.setState({ open: true });
    openSidebarChat(null);
    expect(useSkillResults.getState().open).toBe(false);
  });

  it("streams into the sidebar, retains results across note navigation and returns to the source", async () => {
    // A valid mind map (T-268 asks again when the ```mindmap block is missing).
    setAiResponder(() => "# Energy\n\nATP\n\n```mindmap\n- Energy\n```");
    const { block } = await start();
    render(<SkillResultsSidebar />);
    fireEvent.click(block.getByRole("button", { name: /^Run/ }));
    const sidebar = within(screen.getByRole("region", { name: "AI skill results" }));
    await waitFor(() =>
      expect(sidebar.getByRole("heading", { name: "Energy" })).toBeInTheDocument(),
    );
    expect(block.queryByLabelText("Answer")).toBeNull();
    act(() => useAppStore.getState().openFile("Other.md", undefined, { newTab: true }));
    expect(sidebar.getByText("ATP")).toBeInTheDocument();
    fireEvent.click(sidebar.getByRole("button", { name: /Open source to continue/ }));
    expect(useAppStore.getState().activePath).toBe("Bio/Cells.md");
    expect(useAppStore.getState().tabs.list.some((t) => t.path === "Other.md")).toBe(true);
    expect(view.state.doc.toString()).toBe(source);
    expect(h.b.files()["Bio/Cells.md"]).toBe(source);
    fireEvent.change(block.getByRole("combobox", { name: "Results in" }), {
      target: { value: "note" },
    });
    expect(block.getByRole("heading", { name: "Energy" })).toBeInTheDocument();
    expect(useSkillResults.getState().open).toBe(false);
  });

  it("saves privacy-marked Markdown beside the source without repeated files or splits", async () => {
    setAiResponder(() => "# ATP\n\nEnergy.");
    const { id, block } = await start("mindmap", "sideview");
    useConfig.setState((s) => ({
      config: { ...s.config, ai: { folders: { Bio: "local" }, models: {} } },
    }));
    await h.b.createFile(
      ".axisnotes/config.json",
      JSON.stringify({ ai: { folders: { Bio: "local" } } }),
    );
    fireEvent.click(block.getByRole("button", { name: /^Run/ }));
    await waitFor(() => expect(Object.keys(useAppStore.getState().panes.tabs)).toHaveLength(2));
    const saved = useAiBlocks.getState().blocks[id]!.saved![0]!;
    expect(saved).toBe("Bio/Cells - Mind map.md");
    expect(h.b.files()[saved]).toContain("ai-access: local");
    expect(h.b.files()[saved]).toContain("# ATP");
    fireEvent.click(block.getByRole("button", { name: "Open result beside note" }));
    await act(async () => {});
    expect(Object.keys(useAppStore.getState().panes.tabs)).toHaveLength(2);
    expect(Object.keys(h.b.files()).filter((p) => p.includes("Mind map"))).toEqual([saved]);
    expect(useAppStore.getState().activePath).toBe("Bio/Cells.md");
    expect(view.state.doc.toString()).toBe(source);
  });

  it("shows saved HTML using the existing isolated page viewer in the sidebar", async () => {
    setAiResponder(() => "<!doctype html><html><body><h1>Quiz</h1></body></html>");
    vi.spyOn(h.b, "pageUrl").mockImplementation((p) => `http://axis-page.localhost/${p}`);
    const { block } = await start("test");
    render(<SkillResultsSidebar />);
    fireEvent.click(block.getByRole("button", { name: /^Run/ }));
    const iframe = await waitFor(() => {
      const f = screen.getByTitle("Cells - Practice test.html");
      expect(f.tagName).toBe("IFRAME");
      return f;
    });
    expect(iframe).toHaveAttribute("sandbox", PAGE_SANDBOX);
    expect(iframe).not.toHaveAttribute("srcdoc");
    expect(view.state.doc.toString()).toBe(source);
  });

  it("opens HTML in a side pane and preserves unrelated tabs on return to the source", async () => {
    setAiResponder(() => "<!doctype html><html><body>Quiz</body></html>");
    const { id, block } = await start("test", "sideview");
    fireEvent.click(block.getByRole("button", { name: /^Run/ }));
    await waitFor(() => expect(useAiBlocks.getState().blocks[id]!.resultPath).toMatch(/\.html$/));
    const resultPane = useAiBlocks.getState().blocks[id]!.resultPane!;
    expect(activeTab(useAppStore.getState().panes.tabs[resultPane]!).path).toBe(
      "Bio/Cells - Practice test.html",
    );
    act(() => {
      useAppStore.getState().focusPane(resultPane);
      openSkillSource("Bio/Cells.md");
    });
    expect(useAppStore.getState().activePath).toBe("Bio/Cells.md");
    expect(activeTab(useAppStore.getState().panes.tabs[resultPane]!).path).toMatch(/\.html$/);
  });

  it("reuses the conversation pane after a reply, with the same saved transcript", async () => {
    setAiResponder(() => "Could you explain ATP?");
    const { id, block } = await start("teach-the-ai", "sideview");
    fireEvent.click(block.getByRole("button", { name: /^Run/ }));
    await waitFor(() => expect(useAiBlocks.getState().blocks[id]!.resultPath).toBeTruthy());
    const file = useAiBlocks.getState().blocks[id]!.resultPath!;
    fireEvent.change(block.getByRole("textbox", { name: "AI prompt" }), {
      target: { value: "ATP carries energy." },
    });
    fireEvent.click(block.getByRole("button", { name: /^Reply/ }));
    await waitFor(() => expect(h.b.files()[file]).toContain("ATP carries energy."));
    expect(Object.keys(useAppStore.getState().panes.tabs)).toHaveLength(2);
    expect(useAiBlocks.getState().blocks[id]!.resultPath).toBe(file);
  });

  it("does not save or open a late result in another vault", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const original = h.b.aiRun;
    const run = vi.spyOn(h.b, "aiRun").mockImplementation(async (...args) => {
      await gate;
      return original(...args);
    });
    setAiResponder(() => "Late result");
    const { block } = await start("mindmap", "sideview");
    fireEvent.click(block.getByRole("button", { name: /^Run/ }));
    await waitFor(() => expect(run).toHaveBeenCalled());
    await act(async () => {
      useAppStore.setState({ vault: { ...useAppStore.getState().vault!, root: "/other-vault" } });
      finish();
      await run.mock.results[0]!.value;
    });
    expect(Object.keys(useAppStore.getState().panes.tabs)).toHaveLength(1);
    expect(Object.keys(h.b.files()).some((p) => p.includes("Mind map"))).toBe(false);
    expect(useSkillResults.getState().open).toBe(false);
  });

  it("retains multiple sidebar runs and lets the user select an earlier result", async () => {
    setAiResponder(() => "First result");
    const first = await start();
    render(<SkillResultsSidebar />);
    fireEvent.click(first.block.getByRole("button", { name: /^Run/ }));
    await waitFor(() => expect(useAiBlocks.getState().blocks[first.id]!.phase.kind).toBe("done"));
    setAiResponder(() => "Second result");
    const second = await start("mnemonic");
    fireEvent.click(second.block.getByRole("button", { name: /^Run/ }));
    const sidebar = within(screen.getByRole("region", { name: "AI skill results" }));
    await waitFor(() => expect(sidebar.getByText("Second result")).toBeInTheDocument());
    fireEvent.change(sidebar.getByRole("combobox", { name: "Skill result" }), {
      target: { value: first.id },
    });
    expect(sidebar.getByText("First result")).toBeInTheDocument();
    expect(useAiBlocks.getState().blocks[second.id]!.answer).toBe("Second result");
  });

  it("keeps a failed side-view save recoverable without sending the request again", async () => {
    setAiResponder(() => "<!doctype html><html><body>Quiz</body></html>");
    const run = vi.spyOn(h.b, "aiRun");
    const { block } = await start("test", "sideview");
    vi.spyOn(h.b, "createFile").mockRejectedValueOnce(Error("disk full"));
    fireEvent.click(block.getByRole("button", { name: /^Run/ }));
    await waitFor(() => expect(block.getByRole("alert")).toHaveTextContent("disk full"));
    expect(Object.keys(useAppStore.getState().panes.tabs)).toHaveLength(1);
    fireEvent.click(block.getByRole("button", { name: "Save next to the note" }));
    await waitFor(() => expect(block.queryByRole("alert")).toBeNull());
    fireEvent.click(block.getByRole("button", { name: "Open result beside note" }));
    await waitFor(() => expect(Object.keys(useAppStore.getState().panes.tabs)).toHaveLength(2));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("preserves a result pane the user navigated elsewhere before the next reply", async () => {
    setAiResponder(() => "Explain ATP?");
    const { id, block } = await start("teach-the-ai", "sideview");
    fireEvent.click(block.getByRole("button", { name: /^Run/ }));
    await waitFor(() => expect(useAiBlocks.getState().blocks[id]!.resultPane).toBeTruthy());
    const previousPane = useAiBlocks.getState().blocks[id]!.resultPane!;
    act(() => {
      useAppStore.getState().focusPane(previousPane);
      useAppStore.getState().openFile("Other.md");
      openSkillSource("Bio/Cells.md");
    });
    fireEvent.change(block.getByRole("textbox", { name: "AI prompt" }), {
      target: { value: "ATP carries energy." },
    });
    fireEvent.click(block.getByRole("button", { name: /^Reply/ }));
    await waitFor(() => expect(Object.keys(useAppStore.getState().panes.tabs)).toHaveLength(3));
    expect(activeTab(useAppStore.getState().panes.tabs[previousPane]!).path).toBe("Other.md");
  });
});
