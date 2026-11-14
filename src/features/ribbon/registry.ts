import { useSyncExternalStore } from "react";
import type { LucideIcon } from "lucide-react";
import type { AxisConfig } from "../../app/config";

// The ribbon: a strip of buttons beside the left panel (Settings → Appearance → Ribbon).
// AXISNotes adds its own buttons (builtin.ts) and plugins add theirs through
// `registerRibbonItem`, the same way AXIS Hub plugs into Notes: while the plugin is turned
// off, its `available` says no and its buttons aren't shown. The user's order and hidden
// buttons are saved in the vault's config by id, so a plugin's button keeps its place.

export interface RibbonItem {
  /** Stable id, saved in the config: `core:home`, `hub:open`, … */
  id: string;
  label: string;
  Icon: LucideIcon;
  /** Who added it: "AXISNotes" or the plugin's name (shown in Settings). */
  source: string;
  run(): void;
  /** Shown only while this says yes (for example, while its plugin is turned on). */
  available?(config: AxisConfig): boolean;
}

const items = new Map<string, RibbonItem>();
const listeners = new Set<() => void>();
let snapshot: readonly RibbonItem[] = [];

function changed() {
  snapshot = [...items.values()];
  for (const l of listeners) l();
}

/** Add a button to the ribbon (a later one with the same id replaces it). Returns a remover. */
export function registerRibbonItem(item: RibbonItem): () => void {
  items.set(item.id, item);
  changed();
  return () => {
    if (items.get(item.id) !== item) return;
    items.delete(item.id);
    changed();
  };
}

export function ribbonItems(): readonly RibbonItem[] {
  return snapshot;
}

/** The registered buttons, re-rendering when a plugin adds or removes one. */
export function useRibbonItems(): readonly RibbonItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

/**
 * Available buttons in the user's order: those in `order` first, as saved, then any new
 * ones (AXISNotes' own, then plugins', so a plugin's new button appears at the end).
 */
export function arrange(
  all: readonly RibbonItem[],
  order: readonly string[],
  config: AxisConfig,
): RibbonItem[] {
  const usable = all.filter((i) => i.available?.(config) ?? true);
  // Unsaved buttons follow: AXISNotes' own first, then plugins', each as registered.
  const rank = (i: RibbonItem) => {
    const at = order.indexOf(i.id);
    if (at !== -1) return at;
    const plugin = i.source === "AXISNotes" ? 0 : usable.length;
    return order.length + plugin + usable.indexOf(i);
  };
  return [...usable].sort((a, b) => rank(a) - rank(b));
}

/**
 * The saved order after moving `id` to where `before` is (or to the end when `before` is
 * null). `shown` is the current arrangement; ids not in it (an unavailable plugin's) keep
 * their saved order after it.
 */
export function moveInOrder(
  shown: readonly string[],
  saved: readonly string[],
  id: string,
  before: string | null,
): string[] {
  const next = shown.filter((x) => x !== id);
  const at = before === null ? next.length : next.indexOf(before);
  next.splice(at === -1 ? next.length : at, 0, id);
  return [...next, ...saved.filter((x) => !next.includes(x))];
}
