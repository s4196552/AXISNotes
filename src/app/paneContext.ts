import { createContext, useContext } from "react";

/**
 * The split pane a view is showing in (see panes.ts). Only the focused pane's note puts its
 * word count in the status bar and takes commands. Outside a pane (tests, embeds) a view
 * acts as the focused one.
 */
export const PaneContext = createContext<{ id: string; focused: boolean }>({
  id: "",
  focused: true,
});

export const usePane = () => useContext(PaneContext);
