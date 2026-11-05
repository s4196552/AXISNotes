import { create } from "zustand";
import { type AgentChatView, type AiRunRequest, backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { isNotePath } from "../../lib/markdown";
import { createDraft, folderOf } from "../drafts/drafts";

// Quick Chat: the prompt box under the Agent. The Agent's window only shows it and posts
// what was typed; the request runs here, in the main window, through the same
// privacy-checked AI layer as every other feature (the open note is attached by path).

interface ChatState {
  open: boolean;
  question: string;
  answer: string;
  running: boolean;
  error: string | null;
  useNote: boolean;
  runId: string | null;
}

const closed: ChatState = {
  open: false,
  question: "",
  answer: "",
  running: false,
  error: null,
  useNote: true,
  runId: null,
};

export const useAgentChat = create<ChatState>(() => closed);

const SYSTEM =
  "You are the Agent in AXISNotes, a Markdown note-taking app. The user asked you a quick " +
  "question from outside the editor. Answer briefly and clearly in Markdown.";

/** The note open in AXISNotes now, if it's a Markdown note. */
export function openNote(): string | null {
  const path = useAppStore.getState().activePath;
  return path && isNotePath(path) ? path : null;
}

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

/** What the Agent's window draws for Quick Chat (null while closed). */
export function chatView(): AgentChatView | null {
  const c = useAgentChat.getState();
  if (!c.open) return null;
  const note = openNote();
  return {
    question: c.question,
    answer: c.answer,
    running: c.running,
    error: c.error,
    noteName: note ? nameOf(note) : null,
    useNote: c.useNote,
  };
}

export function openChat() {
  if (!useAgentChat.getState().open) useAgentChat.setState({ ...closed, open: true });
}

export function closeChat() {
  const { runId } = useAgentChat.getState();
  if (runId) void backend.aiCancel(runId);
  useAgentChat.setState(closed);
}

export function stopChat() {
  const { runId } = useAgentChat.getState();
  if (runId) void backend.aiCancel(runId);
}

export function setChatUsesNote(on: boolean) {
  useAgentChat.setState({ useNote: on });
}

export async function sendChat(text: string) {
  const question = text.trim();
  const cur = useAgentChat.getState();
  if (!question || cur.running) return;
  const note = cur.useNote ? openNote() : null;
  const request: AiRunRequest = {
    task: "chat",
    messages: [
      { role: "system", content: [{ type: "text", text: SYSTEM }] },
      { role: "user", content: [{ type: "text", text: question }] },
    ],
    attach: note ? [note] : [],
  };
  const runId = crypto.randomUUID();
  useAgentChat.setState({ open: true, question, answer: "", running: true, error: null, runId });
  try {
    const result = await backend.aiRun(runId, request, (d) =>
      useAgentChat.setState((s) => (s.runId === runId ? { answer: s.answer + d } : s)),
    );
    if (useAgentChat.getState().runId === runId)
      useAgentChat.setState({ answer: result.text, running: false, runId: null });
  } catch (e) {
    if (useAgentChat.getState().runId !== runId) return; // closed or replaced meanwhile
    const cancelled = isBackendError(e) && e.code === "Cancelled";
    useAgentChat.setState({
      running: false,
      runId: null,
      error: cancelled ? null : isBackendError(e) ? e.message : String(e),
    });
  }
}

/** Open the answer as a draft note in AXISNotes (to save or discard). */
export async function chatToDraft() {
  const c = useAgentChat.getState();
  if (!c.answer.trim()) return;
  const note = openNote();
  await backend.agentHost?.focusMain();
  await createDraft({
    title: c.question.split(/\r?\n/)[0] ?? "",
    content: `${c.answer.trim()}\n`,
    folder: note ? folderOf(note) : "",
  });
}

/** The Agent's window: the figure, the Quick Chat icon under it, and the chat panel. */
export function agentWindowSize(size: number, chatOpen: boolean) {
  const side = Math.round(size * 1.25);
  const width = chatOpen ? Math.max(side, 340) : side;
  const height = side + 40 + (chatOpen ? 300 : 0);
  return { width, height };
}
