import { create } from "zustand";

// Per-viewer editor preferences (browser storage; safe to lose).

const KEY = "axis:editor-prefs";

interface Prefs {
  outlineView: boolean;
}

function load(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    return { outlineView: raw.outlineView === true };
  } catch {
    return { outlineView: false };
  }
}

interface PrefsState extends Prefs {
  toggleOutlineView(): void;
}

export const useEditorPrefs = create<PrefsState>((set, get) => ({
  ...load(),
  toggleOutlineView() {
    const outlineView = !get().outlineView;
    set({ outlineView });
    try {
      localStorage.setItem(KEY, JSON.stringify({ outlineView }));
    } catch {
      // Preference just won't persist.
    }
  },
}));
