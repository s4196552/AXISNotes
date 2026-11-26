import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { setAiResponder } from "../../ipc/memoryAi";
import type { AiRunRequest, AiRunResult } from "../../ipc";
import { useAppStore } from "../../app/store";
import { noteMark } from "../../lib/aiAccess";
import { clearActiveEditor, setActiveEditor, activeEditorChanged } from "../editor/activeEditor";
import { SidebarChat } from "./SidebarChat";
import {
  editorChatContext,
  openSidebarChat,
  sendFilesToSidebar,
  useSidebarChat,
} from "./sidebarChatState";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => ({
  ...(await orig<typeof import("../../ipc")>()),
  backend: new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] }),
}));
/** Format and View live under the header's "Chat options" button. */
const openOptions = () => {
  if (!screen.queryByLabelText("Answer format"))
    fireEvent.click(screen.getByRole("button", { name: "Chat options" }));
};
const doc = "# Biology\n\n==Cells make ATP.==\n\nOther material.\n";
let view: EditorView;
const requests: AiRunRequest[] = [];
beforeEach(async () => {
  h.b = createMemoryBackend({ "Bio.md": doc });
  const vault = await h.b.openVault(`/test-${Math.random()}`);
  const { settings } = await h.b.aiSettings();
  await h.b.aiSaveSettings({
    ...settings,
    providers: [{ id: "ollama", kind: "ollama", name: "On-device", baseUrl: "", enabled: true }],
  });
  useAppStore.setState({ vault, activePath: "Bio.md", mainView: "note" });
  useAppStore.getState().openFile("Bio.md");
  useSidebarChat.setState({ open: false, context: null, prompt: "", request: 0 });
  requests.length = 0;
  setAiResponder((req) => {
    requests.push(req);
    return "Updated cells.";
  });
  view = new EditorView({
    parent: document.createElement("div"),
    state: EditorState.create({
      doc,
      selection: {
        anchor: doc.indexOf("=="),
        head: doc.indexOf("==") + "==Cells make ATP.==".length,
      },
    }),
  });
  setActiveEditor(view, "Bio.md");
});
afterEach(() => {
  clearActiveEditor(view);
  view.destroy();
  setAiResponder(null);
  vi.restoreAllMocks();
});

it("copies the complete Markdown output and reports clipboard failure without losing the answer", async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const write = vi.fn(async (_value: string) => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: write },
  });
  const answer = "## Cells\n\n- **ATP** provides energy.";
  setAiResponder(() => answer);
  try {
    render(<SidebarChat />);
    fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Explain" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy answer" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(answer));
    write.mockRejectedValueOnce(new Error("Clipboard blocked"));
    fireEvent.click(screen.getByRole("button", { name: "Copy answer" }));
    await waitFor(() => expect(useAppStore.getState().notice).toContain("Couldn't copy"));
    expect(screen.getByRole("heading", { name: "Cells" })).toBeInTheDocument();
  } finally {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

const html =
  "<!doctype html><html><head></head><body><h1>Energy</h1><button onclick=\"this.textContent='Ready'\">Try</button></body></html>";

it("requests HTML, isolates its saved preview, preserves privacy and keeps the format on reopen", async () => {
  h.b.pageUrl = (path) => `http://axispage.localhost/${path}`;
  setAiResponder((req) => {
    requests.push(req);
    return html;
  });
  openSidebarChat({ ...editorChatContext()!, rule: "local" });
  const first = render(<SidebarChat />);
  openOptions();
  fireEvent.change(screen.getByLabelText("Answer format"), { target: { value: "html" } });
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Make a page" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const frame = await screen.findByTitle("AI HTML answer");
  expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-modals");
  expect(frame).not.toHaveAttribute("srcdoc");
  expect(screen.queryByRole("heading", { name: "Energy" })).toBeNull();
  expect(requests[0]!.atLeast).toBe("local");
  expect(JSON.stringify(requests[0]!.messages[0])).toContain("HTML document");
  const path = Object.keys(h.b.files()).find((path) => path.endsWith(".html"))!;
  expect(noteMark(path, h.b.files()[path]!)).toBe("local");
  expect(h.b.files()[path]).toContain("data-axisnotes-copyable");
  expect(h.b.files()[path]).toContain("axisSidebarZoom");
  expect(h.b.files()["Bio.md"]).toBe(doc);
  openOptions();
  fireEvent.change(screen.getByLabelText("Answer display"), { target: { value: "source" } });
  expect(first.container.querySelector(".assistant pre")!.textContent).toBe(html);
  first.unmount();
  render(<SidebarChat />);
  openOptions();
  expect(screen.getByLabelText("Answer format")).toHaveValue("html");
});

it("keeps failed HTML output copyable and retries its preview without asking the model again", async () => {
  h.b.pageUrl = (path) => `http://axispage.localhost/${path}`;
  setAiResponder((req) => {
    requests.push(req);
    return html;
  });
  const create = vi.spyOn(h.b, "createFile").mockRejectedValueOnce(new Error("Disk full"));
  render(<SidebarChat />);
  openOptions();
  fireEvent.change(screen.getByLabelText("Answer format"), { target: { value: "html" } });
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Make a page" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const retry = await screen.findByRole("button", { name: "Retry HTML preview" });
  expect(screen.getByRole("button", { name: "Copy answer" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Disk full");
  fireEvent.click(retry);
  await screen.findByTitle("AI HTML answer");
  expect(requests).toHaveLength(1);
  expect(create.mock.calls[1]![2]).toBe(useAppStore.getState().vault!.root);
});

it("attaches exact file-tree notes with intersected rules without sending automatically", async () => {
  await h.b.createFile("Other.md", "---\nai-access: local\n---\n# Other\nSecond material.");
  await sendFilesToSidebar(["Bio.md", "Other.md"]);
  expect(requests).toHaveLength(0);
  expect(useSidebarChat.getState()).toMatchObject({
    open: true,
    context: { sources: ["Bio.md", "Other.md"], rule: "local" },
  });
  render(<SidebarChat />);
  expect(screen.getByRole("button", { name: "Remove Bio" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove Other" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Suggest edit" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Compare" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Updated cells.");
  expect(requests[0]!.sources).toEqual(["Bio.md", "Other.md"]);
  expect(requests[0]!.atLeast).toBe("local");
  expect(JSON.stringify(requests[0]!.messages)).toContain("Second material.");
});

it("keeps suggested note edits in Markdown even when HTML answers are selected", async () => {
  render(<SidebarChat />);
  openOptions();
  fireEvent.change(screen.getByLabelText("Answer format"), { target: { value: "html" } });
  fireEvent.change(screen.getByLabelText("Chat action"), { target: { value: "edit" } });
  openOptions();
  expect(screen.getByLabelText("Answer format")).toHaveValue("markdown");
  openOptions();
  expect(screen.getByLabelText("Answer format")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Improve" } });
  fireEvent.click(screen.getByRole("button", { name: "Suggest changes" }));
  await screen.findByRole("button", { name: "Apply approved changes" });
  expect(Object.keys(h.b.files()).some((path) => path.endsWith(".html"))).toBe(false);
  expect(h.b.files()["Bio.md"]).toBe(doc);
});

it("cannot write an HTML answer into a newly opened vault", async () => {
  const create = h.b.createFile.bind(h.b);
  const root = useAppStore.getState().vault!.root;
  const writes: (string | undefined)[] = [];
  h.b.createFile = async (path, content, expectedRoot) => {
    writes.push(expectedRoot);
    const vault = await h.b.openVault("/other-html-vault");
    useAppStore.setState({ vault });
    return create(path, content, expectedRoot);
  };
  setAiResponder(() => html);
  render(<SidebarChat />);
  openOptions();
  fireEvent.change(screen.getByLabelText("Answer format"), { target: { value: "html" } });
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Make a page" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(writes).toEqual([root]));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled());
  expect(Object.keys(h.b.files()).some((path) => path.endsWith(".html"))).toBe(false);
  expect(screen.queryByTitle("AI HTML answer")).toBeNull();
});

it("refuses AI-never files and ignores an attachment that finishes after a vault change", async () => {
  await h.b.createFile("Never.md", "---\nai-access: never\n---\nPrivate.");
  await sendFilesToSidebar(["Never.md"]);
  expect(useSidebarChat.getState().open).toBe(false);
  expect(useAppStore.getState().notice).toContain("AI: never");
  let finish!: (file: Awaited<ReturnType<MemoryBackend["readFile"]>>) => void;
  vi.spyOn(h.b, "readFile").mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const attach = sendFilesToSidebar(["Late.md"]);
  act(() => useAppStore.setState({ vault: { root: "/other", name: "Other" } }));
  finish({ content: "Old material", modifiedMs: 1 });
  await attach;
  expect(useSidebarChat.getState().context).toBeNull();
  expect(requests).toHaveLength(0);
});

it("asks about exactly the selection including saved highlight marks", async () => {
  render(<SidebarChat />);
  const summary = screen.getByText("Selected text · Bio");
  const preview = screen.getByText("==Cells make ATP.==");
  expect(preview).not.toBeVisible();
  fireEvent.click(summary);
  expect(preview).toBeVisible();
  fireEvent.click(summary);
  expect(preview).not.toBeVisible();
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Explain this" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Updated cells.");
  expect(requests).toHaveLength(1);
  const payload = JSON.stringify(requests[0]!.messages);
  expect(payload).toContain("==Cells make ATP.==");
  expect(payload).not.toContain("Other material");
  expect(requests[0]!.sources).toEqual(["Bio.md"]);
  expect(h.b.files()["Bio.md"]).toBe(doc);
  act(() => {
    view.dispatch({ selection: { anchor: doc.indexOf("Other"), head: doc.indexOf("Other") + 5 } });
    activeEditorChanged(view);
  });
  fireEvent.click(summary);
  expect(screen.getByRole("blockquote")).toHaveTextContent("Other");
});

it("requires approval, edits only the selected text and rejects a stale proposal", async () => {
  render(<SidebarChat />);
  fireEvent.change(screen.getByLabelText("Chat action"), { target: { value: "edit" } });
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Improve this" } });
  fireEvent.click(screen.getByRole("button", { name: "Suggest changes" }));
  await screen.findByRole("button", { name: "Apply approved changes" });
  expect(view.state.doc.toString()).toBe(doc);
  fireEvent.click(screen.getByRole("button", { name: "Apply approved changes" }));
  await waitFor(() =>
    expect(view.state.doc.toString()).toBe(doc.replace("==Cells make ATP.==", "Updated cells.")),
  );
  act(() => {
    view.dispatch({ selection: { anchor: 0, head: 1 } });
    activeEditorChanged(view);
  });
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Improve again" } });
  fireEvent.click(screen.getByRole("button", { name: "Suggest changes" }));
  await screen.findByRole("button", { name: "Apply approved changes" });
  act(() => view.dispatch({ changes: { from: 0, insert: "My edit\n" } }));
  const edited = view.state.doc.toString();
  fireEvent.click(screen.getByRole("button", { name: "Apply approved changes" }));
  await screen.findByText(/The note changed/);
  expect(view.state.doc.toString()).toBe(edited);
});

it("keeps a conversation's privacy when later reading another note", async () => {
  await h.b.writeFile("Bio.md", "---\nai-access: local\n---\n" + doc);
  const context = editorChatContext()!;
  openSidebarChat({ ...context, doc: "---\nai-access: local\n---\n" + doc });
  render(<SidebarChat />);
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Explain this" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Updated cells.");
  await h.b.writeFile("Bio.md", doc);
  act(() => useSidebarChat.setState({ context: context }));
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Continue" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1]!.atLeast).toBe("local");
});

it("defaults to Markdown blocks and switches the same answer to exact source without another request", async () => {
  const answer =
    "## Cells\n\n> [!tip] Remember\n> ==ATP== is fuel.\n\n| A | B |\n| --- | --- |\n| one | two |";
  setAiResponder((req) => {
    requests.push(req);
    return answer;
  });
  const { container } = render(<SidebarChat />);
  openOptions();
  expect(screen.getByLabelText("Answer display")).toHaveValue("markdown");
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Explain" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("table");
  await waitFor(() => expect(container.querySelector(".assistant mark")).toHaveTextContent("ATP"));
  openOptions();
  fireEvent.change(screen.getByLabelText("Answer display"), { target: { value: "source" } });
  expect(container.querySelector(".sidebar-chat-source")!.textContent).toBe(answer);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  openOptions();
  fireEvent.change(screen.getByLabelText("Answer display"), { target: { value: "markdown" } });
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(requests).toHaveLength(1);
  expect(JSON.stringify(requests[0]!.messages[0])).toContain("Answer in Markdown");
  expect(h.b.files()["Bio.md"]).toBe(doc);
});

it("can switch display while an unfinished code block streams, keeping the final source and history", async () => {
  let finish!: (result: AiRunResult) => void;
  const pending = new Promise<AiRunResult>((resolve) => {
    finish = resolve;
  });
  let emit!: (delta: string) => void;
  h.b.aiRun = (_id, req, onDelta) => {
    requests.push(req);
    emit = onDelta;
    onDelta("```green\nconst energy");
    return pending;
  };
  const { container } = render(<SidebarChat />);
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Stream code" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  const response = await screen.findByLabelText("AI response");
  expect(response.querySelector("pre code")).toHaveTextContent("const energy");
  openOptions();
  fireEvent.change(screen.getByLabelText("Answer display"), { target: { value: "source" } });
  act(() => emit(" = 'ATP';\n```"));
  const answer = "```green\nconst energy = 'ATP';\n```";
  expect(response.querySelector(".sidebar-chat-source")!.textContent).toBe(answer);
  await act(async () =>
    finish({
      text: answer,
      providerId: "ollama",
      providerName: "On-device",
      model: "fixture",
      local: true,
      usage: null,
      fallbackFrom: null,
      rule: "any",
    }),
  );
  expect(container.querySelector(".assistant .sidebar-chat-source")!.textContent).toBe(answer);
  openOptions();
  fireEvent.change(screen.getByLabelText("Answer display"), { target: { value: "markdown" } });
  expect(container.querySelector(".assistant pre code")).toHaveTextContent("const energy = 'ATP';");
  expect(requests).toHaveLength(1);
  expect(h.b.files()["Bio.md"]).toBe(doc);
});

it("offers skills before the first message and runs a text skill in the chat", async () => {
  render(<SidebarChat />);
  const skills = screen.getByRole("list", { name: "Skills" });
  const summarize = screen.getByRole("button", { name: "Summarize this note" });
  expect(skills).toContainElement(summarize);
  expect(summarize.querySelector("svg")).not.toBeNull();
  fireEvent.click(summarize);
  await screen.findByText("Updated cells.");
  expect(requests).toHaveLength(1);
  const system = JSON.stringify(requests[0]!.messages[0]);
  expect(system).toContain("# Skill: Summary");
  expect(JSON.stringify(requests[0]!.messages)).toContain("==Cells make ATP.==");
  expect(requests[0]!.sources).toEqual(["Bio.md"]);
  // The welcome screen gives way to the conversation, which keeps using the skill.
  expect(screen.queryByRole("list", { name: "Skills" })).toBeNull();
  expect(screen.getAllByText("Summarize this note").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Stop using Summary" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Shorter" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(JSON.stringify(requests[1]!.messages[0])).toContain("# Skill: Summary");
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Stop using Summary" }));
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Plain" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(JSON.stringify(requests[2]!.messages[0])).not.toContain("# Skill:");
});

it("runs a study-block skill as a note, as the file tree does", async () => {
  useAppStore.setState({ notes: [{ path: "Bio.md", name: "Bio", title: "Biology", aliases: [] }] });
  render(<SidebarChat />);
  fireEvent.click(screen.getByRole("button", { name: "More skills" }));
  fireEvent.click(screen.getByRole("button", { name: "Make a mind map" }));
  await waitFor(() =>
    expect(Object.keys(h.b.files()).some((p) => /^mind ?map - /i.test(p))).toBe(true),
  );
  expect(requests).toHaveLength(0);
});

it("disables skills until a note is open", () => {
  clearActiveEditor(view);
  useAppStore.setState({ mainView: "graph" });
  render(<SidebarChat />);
  expect(screen.getByRole("button", { name: "Summarize this note" })).toBeDisabled();
  expect(screen.getByText(/open a note to use a skill/i)).toBeInTheDocument();
});

it("sends the chosen effort and sends on Enter but not Shift+Enter", async () => {
  render(<SidebarChat />);
  fireEvent.click(screen.getByRole("button", { name: "Effort: Balanced" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /Deep/ }));
  expect(screen.getByRole("button", { name: "Effort: Deep" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^Model: / })).toBeInTheDocument();
  const box = screen.getByLabelText("Chat message");
  fireEvent.change(box, { target: { value: "Explain" } });
  fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
  expect(requests).toHaveLength(0);
  fireEvent.keyDown(box, { key: "Enter" });
  await screen.findByText("Updated cells.");
  expect(requests[0]!.effort).toBe("deep");
});

it("shows attached notes as chips and removes one with its ×", async () => {
  await h.b.createFile("Other.md", "---\nai-access: local\n---\n# Other\nSecond material.");
  await sendFilesToSidebar(["Bio.md", "Other.md"]);
  render(<SidebarChat />);
  fireEvent.click(screen.getByRole("button", { name: "Remove Other" }));
  expect(screen.queryByRole("button", { name: "Remove Other" })).toBeNull();
  expect(useSidebarChat.getState().context).toMatchObject({ sources: ["Bio.md"], rule: "any" });
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Explain" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Updated cells.");
  expect(requests[0]!.sources).toEqual(["Bio.md"]);
  expect(requests[0]!.atLeast).toBe("any");
  expect(JSON.stringify(requests[0]!.messages)).not.toContain("Second material.");
});

it("removes the selection, then the open note, until the user picks something else", async () => {
  render(<SidebarChat />);
  fireEvent.click(screen.getByRole("button", { name: "Remove selected text" }));
  expect(screen.queryByText("Selected text · Bio")).toBeNull();
  expect(screen.getByText(/Open a note to include it/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Hello" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Updated cells.");
  expect(requests[0]!.sources).toEqual([]);
  expect(JSON.stringify(requests[0]!.messages)).not.toContain("Cells make ATP");
  // Clicking in the note (no selection now) brings the whole note back as a chip.
  act(() => {
    view.dispatch({ selection: { anchor: 0 } });
    activeEditorChanged(view);
  });
  fireEvent.click(screen.getByRole("button", { name: "Remove Bio" }));
  expect(screen.queryByRole("button", { name: "Remove Bio" })).toBeNull();
});
