import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { setAiResponder } from "../../ipc/memoryAi";
import type { AiRunRequest } from "../../ipc";
import { useAppStore } from "../../app/store";
import { clearActiveEditor, setActiveEditor, activeEditorChanged } from "../editor/activeEditor";
import { NoteContextMenu } from "../editor/NoteContextMenu";
import { SidebarChat } from "./SidebarChat";
import { editorChatContext, openSidebarChat, useSidebarChat } from "./sidebarChatState";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => ({
  ...(await orig<typeof import("../../ipc")>()),
  backend: new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] }),
}));
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

it("pins right-click context and offers an AI question without sending it", () => {
  const context = editorChatContext()!;
  render(<NoteContextMenu x={20} y={20} context={context} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("menuitem", { name: "Ask AI about this selection" }));
  expect(useSidebarChat.getState()).toMatchObject({
    open: true,
    context,
    prompt: "Explain this selection.",
  });
  expect(requests).toHaveLength(0);
});
