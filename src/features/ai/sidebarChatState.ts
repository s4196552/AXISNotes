import { create } from "zustand";
import { useAppStore } from "../../app/store";
import { useLayout } from "../../app/layout";
import { getActiveEditor } from "../editor/activeEditor";
import { backend, isBackendError, type AiRule } from "../../ipc";
import { isNotePath } from "../../lib/markdown";
import { stricter } from "../../lib/aiAccess";
import { effectiveRule } from "./keepPrivacy";
import { MAX_FOLDER_NOTES } from "./folderScope";

export interface ChatContext {
  root: string;
  path: string;
  doc: string;
  from: number;
  to: number;
  text: string;
  selection: boolean;
  sources?: string[];
  rule?: AiRule;
  /** Each attached note, so one can be removed from the chat on its own (T-294). */
  files?: AttachedFile[];
}

export interface AttachedFile {
  path: string;
  content: string;
  rule: AiRule;
}

/** The chat context for attached notes: one note's text as is, several labelled by path. */
export function attachedContext(root: string, files: AttachedFile[]): ChatContext | null {
  const first = files[0];
  if (!first) return null;
  const text =
    files.length === 1
      ? first.content
      : files.map((f) => `Note: ${f.path}\n${f.content}`).join("\n\n");
  return {
    root,
    path: first.path,
    doc: text,
    from: 0,
    to: text.length,
    text,
    selection: false,
    sources: files.map((f) => f.path),
    rule: files.reduce<AiRule>((r, f) => stricter(r, f.rule), "any"),
    files,
  };
}

/** The context without one attached note (null when none are left). */
export function withoutAttached(context: ChatContext, path: string): ChatContext | null {
  return attachedContext(
    context.root,
    (context.files ?? []).filter((f) => f.path !== path),
  );
}

/** Read the live editor, including unsaved text and the exact selection. */
export function editorChatContext(): ChatContext | null {
  const active = getActiveEditor();
  const root = useAppStore.getState().vault?.root;
  if (
    !active ||
    !root ||
    active.path !== useAppStore.getState().activePath ||
    useAppStore.getState().mainView !== "note"
  )
    return null;
  const doc = active.view.state.doc.toString();
  const sel = active.view.state.selection.main;
  const from = sel.empty ? 0 : sel.from;
  const to = sel.empty ? doc.length : sel.to;
  return {
    root,
    path: active.path,
    doc,
    from,
    to,
    text: doc.slice(from, to),
    selection: !sel.empty,
  };
}

export const useSidebarChat = create<{
  open: boolean;
  context: ChatContext | null;
  request: number;
  prompt: string;
}>(() => ({ open: false, context: null, request: 0, prompt: "" }));

let attachmentRequest = 0;
let vaultEpoch = 0;

export function openSidebarChat(context = editorChatContext(), prompt = "") {
  attachmentRequest++;
  useSidebarChat.setState((s) => ({ open: true, context, prompt, request: s.request + 1 }));
  const layout = useLayout.getState();
  if (layout.zen) layout.setZenReveal("right");
  else if (layout.compact) layout.setOverlay("right");
  else layout.setPanels({ right: true });
}

/** Attach exact picked notes/folders, without generating an answer or navigating the editor. */
export async function sendFilesToSidebar(paths: string[]) {
  const root = useAppStore.getState().vault?.root;
  if (!root) return;
  const request = ++attachmentRequest,
    epoch = vaultEpoch;
  const current = () =>
    attachmentRequest === request &&
    vaultEpoch === epoch &&
    useAppStore.getState().vault?.root === root;
  const candidates = new Set<string>();
  for (const path of paths) {
    if (isNotePath(path)) candidates.add(path);
    else
      for (const note of useAppStore.getState().notes) {
        if (!path || note.path.startsWith(`${path}/`)) candidates.add(note.path);
      }
  }
  try {
    if (!candidates.size) throw new Error("There are no Markdown notes in this selection.");
    if (candidates.size > MAX_FOLDER_NOTES)
      throw new Error(`Choose at most ${MAX_FOLDER_NOTES} notes for AI chat.`);
    const files: AttachedFile[] = [];
    let size = 0;
    for (const path of candidates) {
      if (!current()) return;
      const { content } = await backend.readFile(path);
      if (!current()) return;
      const sourceRule = effectiveRule(path, content);
      if (sourceRule === "never")
        throw new Error(`${path} is marked AI: never. No notes were attached.`);
      size += content.length;
      if (size > 250_000)
        throw new Error("These notes are too large for one chat attachment. Choose fewer notes.");
      files.push({ path, content, rule: sourceRule });
    }
    if (current()) openSidebarChat(attachedContext(root, files));
  } catch (error) {
    if (current())
      useAppStore
        .getState()
        .notify(
          isBackendError(error)
            ? error.message
            : String(error instanceof Error ? error.message : error),
        );
  }
}

useAppStore.subscribe((s, prev) => {
  if (s.vault?.root !== prev.vault?.root) {
    vaultEpoch++;
    attachmentRequest++;
    useSidebarChat.setState({ context: null, prompt: "", request: 0 });
  }
});
