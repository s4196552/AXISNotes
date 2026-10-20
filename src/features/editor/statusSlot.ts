import { create } from "zustand";

/**
 * The status bar element where the open note shows its word count and save state. App's
 * status bar registers it; without one (the editor alone, as in tests) the note keeps
 * them in its header.
 */
export const useStatusSlot = create<{ el: HTMLElement | null }>(() => ({ el: null }));

export const setStatusSlot = (el: HTMLElement | null) => useStatusSlot.setState({ el });
