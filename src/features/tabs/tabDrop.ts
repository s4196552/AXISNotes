import { create } from "zustand";
import type { DropZone } from "../../app/panes";

/**
 * Where a tab being dragged would land, shared by every pane so the one under the pointer
 * can draw it: a place in a pane's tab row (before or after the tab or chip `mark`, or
 * "end"), or a zone of a pane's content (its middle, or an edge to split it at).
 */
export type TabDrop =
  | {
      kind: "bar";
      pane: string;
      /** List position (counted with the dragged tab, when it's in this pane). */
      index: number;
      /** The group a dropped tab joins (null: none). */
      group: string | null;
      mark: string;
      side: "before" | "after";
    }
  | { kind: "split"; pane: string; zone: DropZone };

export const useTabDrop = create<{ target: TabDrop | null }>(() => ({ target: null }));
