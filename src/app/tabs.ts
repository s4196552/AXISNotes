// Tabs in the main area, like Obsidian's: each tab shows a note (or the graph, tasks or time
// report) and has its own back/forward history. Pure functions over `TabsState`; the app
// store (store.ts) holds the state and mirrors the active tab into `activePath`/`mainView`.

export type View = "note" | "graph" | "tasks" | "time";

/** What a tab shows. */
export interface Loc {
  path: string | null;
  view: View;
}

export interface Tab extends Loc {
  id: string;
  pinned: boolean;
  back: Loc[];
  forward: Loc[];
}

export interface TabsState {
  list: Tab[];
  /** Id of the active tab (always one of `list`). */
  active: string;
  /** Recently closed tabs, newest last, for "Reopen closed tab". */
  closed: Loc[];
}

const HISTORY_LIMIT = 50;
const CLOSED_LIMIT = 20;

let seq = 0;
const nextId = () => `tab-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const EMPTY: Loc = { path: null, view: "note" };

export function makeTab(loc: Loc = EMPTY, pinned = false): Tab {
  return { id: nextId(), path: loc.path, view: loc.view, pinned, back: [], forward: [] };
}

/** One empty tab. */
export function initialTabs(): TabsState {
  const tab = makeTab();
  return { list: [tab], active: tab.id, closed: [] };
}

export const activeTab = (s: TabsState): Tab => s.list.find((t) => t.id === s.active) ?? s.list[0]!;

const sameLoc = (a: Loc, b: Loc) => a.path === b.path && a.view === b.view;
/** A "New tab": no note and no other view. */
export const isEmpty = (l: Loc) => l.path === null && l.view === "note";
const locOf = (t: Tab): Loc => ({ path: t.path, view: t.view });
const capped = <T>(list: T[], max: number) => (list.length > max ? list.slice(-max) : list);

function replace(s: TabsState, tab: Tab): TabsState {
  return { ...s, list: s.list.map((t) => (t.id === tab.id ? tab : t)) };
}

/** Insert `tab` after the active tab and activate it. */
function insertAfterActive(s: TabsState, tab: Tab): TabsState {
  const i = s.list.findIndex((t) => t.id === s.active);
  const list = [...s.list];
  list.splice(i + 1, 0, tab);
  return { ...s, list, active: tab.id };
}

/**
 * Show `loc` in the active tab (remembering where it was, for Back), or in a new tab when
 * `newTab` is set or the active tab is pinned to another note.
 */
export function navigate(s: TabsState, loc: Loc, opts: { newTab?: boolean } = {}): TabsState {
  const cur = activeTab(s);
  if (opts.newTab || (cur.pinned && !isEmpty(cur) && !sameLoc(cur, loc))) {
    return insertAfterActive(s, makeTab(loc));
  }
  if (sameLoc(cur, loc)) return s;
  // An empty tab isn't worth going back to.
  const back = isEmpty(cur) ? cur.back : [...cur.back, locOf(cur)];
  return replace(s, {
    ...cur,
    ...loc,
    back: capped(back, HISTORY_LIMIT),
    forward: [],
  });
}

export function newTab(s: TabsState): TabsState {
  return insertAfterActive(s, makeTab());
}

export function activate(s: TabsState, id: string): TabsState {
  return s.list.some((t) => t.id === id) && s.active !== id ? { ...s, active: id } : s;
}

/** Close one tab. The last tab is replaced by an empty one. */
export function closeTab(s: TabsState, id: string): TabsState {
  const i = s.list.findIndex((t) => t.id === id);
  if (i === -1) return s;
  const gone = s.list[i]!;
  const closed = isEmpty(gone) ? s.closed : capped([...s.closed, locOf(gone)], CLOSED_LIMIT);
  const list = s.list.filter((t) => t.id !== id);
  if (list.length === 0) {
    const tab = makeTab();
    return { list: [tab], active: tab.id, closed };
  }
  // The tab to the right takes over, else the one to the left.
  const active = s.active === id ? list[Math.min(i, list.length - 1)]!.id : s.active;
  return { list, active, closed };
}

/** Close every unpinned tab except `id`. */
export function closeOthers(s: TabsState, id: string): TabsState {
  return s.list.reduce((acc, t) => (t.id === id || t.pinned ? acc : closeTab(acc, t.id)), {
    ...activate(s, id),
  });
}

/** Close the unpinned tabs to the right of `id`. */
export function closeToRight(s: TabsState, id: string): TabsState {
  const i = s.list.findIndex((t) => t.id === id);
  if (i === -1) return s;
  const right = s.list.slice(i + 1).filter((t) => !t.pinned);
  const start = right.some((t) => t.id === s.active) ? activate(s, id) : s;
  return right.reduce((acc, t) => closeTab(acc, t.id), start);
}

/** Activate the tab `delta` places away, wrapping around. */
export function cycle(s: TabsState, delta: number): TabsState {
  const n = s.list.length;
  const i = s.list.findIndex((t) => t.id === s.active);
  return activate(s, s.list[(((i + delta) % n) + n) % n]!.id);
}

/** Activate the tab at `index` (0-based); -1 is the last tab. Out of range does nothing. */
export function goTo(s: TabsState, index: number): TabsState {
  const tab = index === -1 ? s.list.at(-1) : s.list[index];
  return tab ? activate(s, tab.id) : s;
}

export function back(s: TabsState): TabsState {
  const cur = activeTab(s);
  const to = cur.back.at(-1);
  if (!to) return s;
  return replace(s, {
    ...cur,
    ...to,
    back: cur.back.slice(0, -1),
    forward: [...cur.forward, locOf(cur)],
  });
}

export function forward(s: TabsState): TabsState {
  const cur = activeTab(s);
  const to = cur.forward.at(-1);
  if (!to) return s;
  return replace(s, {
    ...cur,
    ...to,
    forward: cur.forward.slice(0, -1),
    back: [...cur.back, locOf(cur)],
  });
}

/** Move tab `id` to position `to` in the list. */
export function moveTab(s: TabsState, id: string, to: number): TabsState {
  const from = s.list.findIndex((t) => t.id === id);
  if (from === -1) return s;
  const list = [...s.list];
  const [tab] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(to, list.length)), 0, tab!);
  return { ...s, list };
}

export function togglePin(s: TabsState, id: string): TabsState {
  const tab = s.list.find((t) => t.id === id);
  return tab ? replace(s, { ...tab, pinned: !tab.pinned }) : s;
}

/** Bring back the most recently closed tab, next to the active one. */
export function reopenClosed(s: TabsState): TabsState {
  const loc = s.closed.at(-1);
  if (!loc) return s;
  return insertAfterActive({ ...s, closed: s.closed.slice(0, -1) }, makeTab(loc));
}

const isSameOrInside = (path: string, dir: string) => path === dir || path.startsWith(dir + "/");

function mapLocs(s: TabsState, f: (loc: Loc) => Loc | null): TabsState {
  const mapList = (locs: Loc[]) => locs.map(f).filter((l): l is Loc => l !== null);
  return {
    ...s,
    list: s.list.map((t) => {
      const here = f(locOf(t)) ?? EMPTY;
      return { ...t, ...here, back: mapList(t.back), forward: mapList(t.forward) };
    }),
    closed: mapList(s.closed),
  };
}

/** A file or folder was renamed or moved: every tab and history entry follows it. */
export function renamePath(s: TabsState, from: string, to: string): TabsState {
  return mapLocs(s, (l) =>
    l.path !== null && isSameOrInside(l.path, from)
      ? { ...l, path: to + l.path.slice(from.length) }
      : l,
  );
}

/** Close tabs showing notes for which `keep` is false, and forget them in histories. */
export function dropPaths(s: TabsState, keep: (path: string) => boolean): TabsState {
  const doomed = s.list.filter((t) => t.path !== null && t.view === "note" && !keep(t.path));
  const closed = doomed.reduce((acc, t) => closeTab(acc, t.id), s);
  // Closing them remembered them for "Reopen closed tab"; they're gone, so don't.
  return mapLocs({ ...closed, closed: s.closed }, (l) =>
    l.path !== null && !keep(l.path) ? null : l,
  );
}

/** A file or folder was trashed. */
export const removePath = (s: TabsState, path: string) =>
  dropPaths(s, (p) => !isSameOrInside(p, path));

// ---- Saving per vault (open tabs, pins and the active tab; not history) ----

interface Saved {
  tabs: { path: string | null; view: View; pinned?: boolean }[];
  active: number;
}

const VIEWS: readonly View[] = ["note", "graph", "tasks", "time"];

export function serialize(s: TabsState): string {
  const saved: Saved = {
    tabs: s.list.map((t) => ({
      path: t.path,
      view: t.view,
      ...(t.pinned ? { pinned: true } : {}),
    })),
    active: Math.max(
      0,
      s.list.findIndex((t) => t.id === s.active),
    ),
  };
  return JSON.stringify(saved);
}

/** Saved tabs, or one empty tab when there's nothing usable. */
export function deserialize(text: string | null): TabsState {
  try {
    const saved = JSON.parse(text ?? "") as Saved;
    const list = (Array.isArray(saved.tabs) ? saved.tabs : [])
      .filter(
        (t) =>
          t && (t.path === null || typeof t.path === "string") && VIEWS.includes(t.view as View),
      )
      .map((t) => makeTab({ path: t.path, view: t.view }, t.pinned === true));
    if (!list.length) return initialTabs();
    const i = Number.isInteger(saved.active) ? saved.active : 0;
    return { list, active: (list[i] ?? list[0]!).id, closed: [] };
  } catch {
    return initialTabs();
  }
}
