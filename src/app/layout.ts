import { create } from "zustand";

// Which side panels are showing. Like zoom, it's a per-device preference, so it lives
// in local storage rather than the vault.

const KEY = "axisnotes.layout";

interface Saved {
  left: boolean;
  right: boolean;
}

function stored(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Saved>;
    return { left: v.left !== false, right: v.right !== false };
  } catch {
    return { left: true, right: true };
  }
}

interface LayoutState extends Saved {
  setPanels(p: Partial<Saved>): void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  ...stored(),
  setPanels(p) {
    set(p);
    const { left, right } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ left, right }));
    } catch {
      // Not saved; it still applies for this session.
    }
  },
}));

/** Hide both side panels, or bring both back if they're already hidden. */
export function toggleSidePanels() {
  const { left, right, setPanels } = useLayout.getState();
  const show = !left && !right;
  setPanels({ left: show, right: show });
}

export const toggleLeftPanel = () =>
  useLayout.getState().setPanels({ left: !useLayout.getState().left });
export const toggleRightPanel = () =>
  useLayout.getState().setPanels({ right: !useLayout.getState().right });
export const showLeftPanel = () => useLayout.getState().setPanels({ left: true });
