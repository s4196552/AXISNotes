import { create } from "zustand";
import { useAppStore } from "../../app/store";
import { useLayout } from "../../app/layout";
import { getActiveEditor } from "../editor/activeEditor";

export interface ChatContext {
  root: string;
  path: string;
  doc: string;
  from: number;
  to: number;
  text: string;
  selection: boolean;
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

export function openSidebarChat(context = editorChatContext(), prompt = "") {
  useSidebarChat.setState((s) => ({ open: true, context, prompt, request: s.request + 1 }));
  const layout = useLayout.getState();
  if (layout.zen) layout.setZenReveal("right");
  else if (layout.compact) layout.setOverlay("right");
  else layout.setPanels({ right: true });
}

useAppStore.subscribe((s, prev) => {
  if (s.vault?.root !== prev.vault?.root)
    useSidebarChat.setState({ context: null, prompt: "", request: 0 });
});
