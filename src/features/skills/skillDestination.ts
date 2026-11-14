import { create } from "zustand";
import { useAppStore } from "../../app/store";
import { useLayout } from "../../app/layout";
import { activeTab } from "../../app/tabs";
import { useAiBlocks } from "../ai/aiBlockStore";
import { useSidebarChat } from "../ai/sidebarChatState";

export type SkillDestination = "note" | "sidebar" | "sideview";
export const RESULT_DESTINATIONS: Record<SkillDestination, string> = {
  note: "Note",
  sidebar: "Sidebar",
  sideview: "Side view",
};
const key = (root: string) => `axis.skill.destination:${root}`;

export function loadSkillDestination(root: string | undefined): SkillDestination {
  try {
    const value = root && localStorage.getItem(key(root));
    return value === "sidebar" || value === "sideview" ? value : "note";
  } catch {
    return "note";
  }
}

export function saveSkillDestination(root: string | undefined, value: SkillDestination) {
  if (!root) return;
  try {
    localStorage.setItem(key(root), value);
  } catch {
    // Still usable when device preferences cannot be saved.
  }
}

export const useSkillResults = create<{ open: boolean; selected: string | null }>(() => ({
  open: false,
  selected: null,
}));

export function showSkillResults(id?: string) {
  useSkillResults.setState({ open: true, ...(id ? { selected: id } : {}) });
  const layout = useLayout.getState();
  if (layout.zen) layout.setZenReveal("right");
  else if (layout.compact) layout.setOverlay("right");
  else layout.setPanels({ right: true });
}

/** Return to an existing source tab; otherwise open a new tab without replacing a note. */
export function openSkillSource(path: string) {
  const app = useAppStore.getState();
  for (const pane of Object.keys(app.panes.tabs)) {
    const tabs = pane === app.panes.focused ? app.tabs : app.panes.tabs[pane]!;
    const source = tabs.list.find((tab) => tab.path === path && tab.view === "note");
    if (!source) continue;
    app.focusPane(pane);
    useAppStore.getState().activateTab(source.id);
    return;
  }
  app.openFile(path, undefined, { newTab: true });
}

/** Open in a dedicated result pane, preserving every existing tab and the source editor. */
export function openSkillSideView(id: string, path: string) {
  const state = useAiBlocks.getState().blocks[id];
  const app = useAppStore.getState();
  if (!state || state.vaultRoot !== app.vault?.root) return;
  const sourcePane = Object.keys(app.panes.tabs).find((pane) => {
    const tabs = pane === app.panes.focused ? app.tabs : app.panes.tabs[pane]!;
    return activeTab(tabs).path === state.sourcePath;
  });
  let pane = state.resultPane;
  // Only reuse a pane if it still shows this run's previous result. The user may
  // have navigated elsewhere or closed it while the next reply was being made.
  const tabs = pane && (pane === app.panes.focused ? app.tabs : app.panes.tabs[pane]);
  if (!pane || !tabs || activeTab(tabs).path !== state.resultPath) {
    app.splitPane("right", sourcePane ?? app.panes.focused);
    pane = useAppStore.getState().panes.focused;
  } else app.focusPane(pane);
  useAppStore.getState().openFile(path);
  useAiBlocks.getState().patch(id, { resultPane: pane, resultPath: path });
  // Keep follow-ups and keyboard input with the source rather than stealing focus.
  if (sourcePane) useAppStore.getState().focusPane(sourcePane);
}

useAppStore.subscribe((state, previous) => {
  if (state.vault?.root !== previous.vault?.root)
    useSkillResults.setState({ open: false, selected: null });
});

// Editor actions can open AI chat directly. They must also leave the results tab.
useSidebarChat.subscribe((state, previous) => {
  if (state.open && (!previous.open || state.request !== previous.request))
    useSkillResults.setState({ open: false });
});
