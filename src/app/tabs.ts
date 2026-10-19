// Tabs in the main area, like Obsidian's: each tab shows a note (or the graph, tasks or time
// report) and has its own back/forward history. Tabs can be selected together and gathered
// into coloured groups that collapse and move as one, like Chrome's. Pure functions over
// `TabsState`; the app store (store.ts) holds the state and mirrors the active tab into
// `activePath`/`mainView`.

export type View = "note" | "graph" | "tasks" | "time";

/** What a tab shows. */
export interface Loc {
  path: string | null;
  view: View;
}

export interface Tab extends Loc {
  id: string;
  pinned: boolean;
  /** Id of the group the tab is in. A group's tabs are always next to each other. */
  group: string | null;
  back: Loc[];
  forward: Loc[];
}

/** Chrome's group colours. */
export const GROUP_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export interface TabGroup {
  id: string;
  /** Empty for an unnamed group (shown as a coloured circle). */
  name: string;
  color: GroupColor;
  /** A collapsed group's tabs are hidden, and never the active tab. */
  collapsed: boolean;
}

export interface TabsState {
  list: Tab[];
  /** Id of the active tab (always one of `list`). */
  active: string;
  /** Recently closed tabs, newest last, for "Reopen closed tab". */
  closed: Loc[];
  /** Groups that have tabs. */
  groups: TabGroup[];
  /** Tabs selected along with the active one (Ctrl/Shift+click). Never the active tab. */
  selected: string[];
}

const HISTORY_LIMIT = 50;
const CLOSED_LIMIT = 20;

let seq = 0;
const nextId = (kind = "tab") => `${kind}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const EMPTY: Loc = { path: null, view: "note" };

export function makeTab(loc: Loc = EMPTY, pinned = false): Tab {
  return {
    id: nextId(),
    path: loc.path,
    view: loc.view,
    pinned,
    group: null,
    back: [],
    forward: [],
  };
}

/** One empty tab. */
export function initialTabs(): TabsState {
  const tab = makeTab();
  return { list: [tab], active: tab.id, closed: [], groups: [], selected: [] };
}

export const activeTab = (s: TabsState): Tab => s.list.find((t) => t.id === s.active) ?? s.list[0]!;

const sameLoc = (a: Loc, b: Loc) => a.path === b.path && a.view === b.view;
/** A "New tab": no note and no other view. */
export const isEmpty = (l: Loc) => l.path === null && l.view === "note";
const locOf = (t: Tab): Loc => ({ path: t.path, view: t.view });
const capped = <T>(list: T[], max: number) => (list.length > max ? list.slice(-max) : list);

export const findGroup = (s: TabsState, id: string | null) =>
  id === null ? undefined : s.groups.find((g) => g.id === id);

/** Whether a tab shows in the bar (its group isn't collapsed). */
export const isShown = (s: TabsState, t: Tab) => !findGroup(s, t.group)?.collapsed;

/** Tabs that show in the bar, in order. */
export const shownTabs = (s: TabsState) => s.list.filter((t) => isShown(s, t));

/** The active tab plus the selected ones, in tab order. */
export const selection = (s: TabsState): string[] =>
  s.list.filter((t) => t.id === s.active || s.selected.includes(t.id)).map((t) => t.id);

/**
 * Keep the rules after a change: groups without tabs go, tabs forget groups that went, each
 * group's tabs sit together (gathered at its first tab), and the selection only holds tabs
 * that still exist.
 */
function tidy(s: TabsState): TabsState {
  const used = new Set(s.list.map((t) => t.group));
  const groups = s.groups.filter((g) => used.has(g.id));
  const known = new Set(groups.map((g) => g.id));
  const list = s.list.map((t) => (t.group && !known.has(t.group) ? { ...t, group: null } : t));
  const out: Tab[] = [];
  const placed = new Set<string>();
  for (const t of list) {
    if (!t.group) out.push(t);
    else if (!placed.has(t.group)) {
      placed.add(t.group);
      out.push(...list.filter((u) => u.group === t.group));
    }
  }
  const ids = new Set(out.map((t) => t.id));
  const selected = s.selected.filter((id) => ids.has(id) && id !== s.active);
  return { ...s, list: out, groups, selected };
}

/** The shown tab nearest index `i` of `list`: that index first, then right, then left. */
function nearestShown(s: TabsState, list: Tab[], i: number): Tab | undefined {
  return (
    list.slice(i).find((t) => isShown(s, t)) ??
    list
      .slice(0, i)
      .reverse()
      .find((t) => isShown(s, t))
  );
}

function replace(s: TabsState, tab: Tab): TabsState {
  return { ...s, list: s.list.map((t) => (t.id === tab.id ? tab : t)) };
}

/** Insert `tab` after the active tab (in its group) and activate it. */
function insertAfterActive(s: TabsState, tab: Tab): TabsState {
  const i = s.list.findIndex((t) => t.id === s.active);
  const list = [...s.list];
  list.splice(i + 1, 0, { ...tab, group: activeTab(s).group });
  return { ...s, list, active: tab.id, selected: [] };
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

/** Activate a tab, expanding its group if it's collapsed, and clear the selection. */
export function activate(s: TabsState, id: string): TabsState {
  const tab = s.list.find((t) => t.id === id);
  if (!tab) return s;
  const hidden = !isShown(s, tab);
  if (s.active === id && !hidden && !s.selected.length) return s;
  const groups = hidden
    ? s.groups.map((g) => (g.id === tab.group ? { ...g, collapsed: false } : g))
    : s.groups;
  return { ...s, active: id, groups, selected: [] };
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
    return { list: [tab], active: tab.id, closed, groups: [], selected: [] };
  }
  let active = s.active;
  if (s.active === id) {
    // The tab to the right takes over, else the one to the left (skipping hidden tabs).
    const next = nearestShown(s, list, i);
    if (next) active = next.id;
    else {
      const tab = makeTab();
      list.push(tab);
      active = tab.id;
    }
  }
  return tidy({ ...s, list, active, closed });
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

/** Activate the shown tab `delta` places away, wrapping around. */
export function cycle(s: TabsState, delta: number): TabsState {
  const shown = shownTabs(s);
  const n = shown.length;
  const i = shown.findIndex((t) => t.id === s.active);
  return activate(s, shown[(((i + delta) % n) + n) % n]!.id);
}

/** Activate the shown tab at `index` (0-based); -1 is the last. Out of range does nothing. */
export function goTo(s: TabsState, index: number): TabsState {
  const shown = shownTabs(s);
  const tab = index === -1 ? shown.at(-1) : shown[index];
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

/**
 * Move tab `id` to position `to` in the list (counted without it). `group` puts it in that
 * group, or in none for null; left out, the tab keeps its group.
 */
export function moveTab(s: TabsState, id: string, to: number, group?: string | null): TabsState {
  const from = s.list.findIndex((t) => t.id === id);
  if (from === -1) return s;
  const list = [...s.list];
  const [tab] = list.splice(from, 1);
  const into = group === undefined ? tab!.group : group && findGroup(s, group) ? group : null;
  list.splice(Math.max(0, Math.min(to, list.length)), 0, { ...tab!, group: into });
  return tidy({ ...s, list });
}

export function togglePin(s: TabsState, id: string): TabsState {
  const tab = s.list.find((t) => t.id === id);
  return tab ? replace(s, { ...tab, pinned: !tab.pinned }) : s;
}

// ---- Selecting and grouping ----

/**
 * Ctrl/Cmd+click ("toggle") adds a tab to the selection or takes it out; Shift+click
 * ("range") selects the shown tabs from the active one to it. The active tab stays.
 */
export function selectTab(s: TabsState, id: string, mode: "toggle" | "range"): TabsState {
  if (id === s.active || !s.list.some((t) => t.id === id)) return s;
  if (mode === "toggle") {
    const selected = s.selected.includes(id)
      ? s.selected.filter((x) => x !== id)
      : [...s.selected, id];
    return { ...s, selected };
  }
  const shown = shownTabs(s);
  const a = shown.findIndex((t) => t.id === s.active);
  const b = shown.findIndex((t) => t.id === id);
  if (a === -1 || b === -1) return s;
  const range = shown.slice(Math.min(a, b), Math.max(a, b) + 1);
  return { ...s, selected: range.map((t) => t.id).filter((x) => x !== s.active) };
}

export const clearSelection = (s: TabsState): TabsState =>
  s.selected.length ? { ...s, selected: [] } : s;

/** The first colour no group uses yet (then round again). */
function nextColor(s: TabsState): GroupColor {
  const used = new Set(s.groups.map((g) => g.color));
  return (
    GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[s.groups.length % GROUP_COLORS.length]!
  );
}

/**
 * Put tabs `ids` in a new group, gathered where the first of them is. The new group is the
 * last of `groups`.
 */
export function groupTabs(
  s: TabsState,
  ids: string[],
  opts: { name?: string; color?: GroupColor } = {},
): TabsState {
  const members = s.list.filter((t) => ids.includes(t.id));
  if (!members.length) return s;
  const group: TabGroup = {
    id: nextId("group"),
    name: opts.name ?? "",
    color: opts.color ?? nextColor(s),
    collapsed: false,
  };
  const at = s.list.indexOf(members[0]!);
  const rest = s.list.filter((t) => !ids.includes(t.id));
  const list = [
    ...rest.slice(0, at),
    ...members.map((t) => ({ ...t, group: group.id })),
    ...rest.slice(at),
  ];
  return tidy({ ...s, list, groups: [...s.groups, group], selected: [] });
}

/** Move tabs `ids` to the end of group `groupId`, expanding it. */
export function addToGroup(s: TabsState, ids: string[], groupId: string): TabsState {
  if (!findGroup(s, groupId)) return s;
  const moving = s.list.filter((t) => ids.includes(t.id) && t.group !== groupId);
  if (!moving.length) return s;
  const rest = s.list.filter((t) => !moving.includes(t));
  const end = rest.findLastIndex((t) => t.group === groupId);
  const list = [
    ...rest.slice(0, end + 1),
    ...moving.map((t) => ({ ...t, group: groupId })),
    ...rest.slice(end + 1),
  ];
  const groups = s.groups.map((g) => (g.id === groupId ? { ...g, collapsed: false } : g));
  return tidy({ ...s, list, groups, selected: [] });
}

/**
 * Take tabs `ids` out of their groups. A tab at the start of its group stays where it is
 * (just before the group); others move to just after it.
 */
export function removeFromGroup(s: TabsState, ids: string[]): TabsState {
  let list = s.list;
  // Right to left, so tabs moved after a group keep their order.
  for (const t of [...s.list].reverse()) {
    if (!ids.includes(t.id) || !t.group) continue;
    const i = list.indexOf(t);
    const rest = list.filter((u) => u !== t);
    const first = rest.findIndex((u) => u.group === t.group);
    const at = first === -1 || first >= i ? i : rest.findLastIndex((u) => u.group === t.group) + 1;
    rest.splice(at, 0, { ...t, group: null });
    list = rest;
  }
  return list === s.list ? s : tidy({ ...s, list, selected: [] });
}

/** Ungroup: the tabs stay where they are and the group goes. */
export function ungroup(s: TabsState, groupId: string): TabsState {
  if (!findGroup(s, groupId)) return s;
  const list = s.list.map((t) => (t.group === groupId ? { ...t, group: null } : t));
  return tidy({ ...s, list });
}

export function closeGroup(s: TabsState, groupId: string): TabsState {
  return s.list.filter((t) => t.group === groupId).reduce((acc, t) => closeTab(acc, t.id), s);
}

export function updateGroup(
  s: TabsState,
  groupId: string,
  patch: Partial<Pick<TabGroup, "name" | "color">>,
): TabsState {
  if (!findGroup(s, groupId)) return s;
  return { ...s, groups: s.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)) };
}

/**
 * Collapse or expand a group. Collapsing the active tab's group makes the nearest tab
 * outside it active, or a new empty tab when there's none.
 */
export function toggleGroup(s: TabsState, groupId: string): TabsState {
  const group = findGroup(s, groupId);
  if (!group) return s;
  const next: TabsState = {
    ...s,
    groups: s.groups.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)),
    selected: s.selected.filter((id) => s.list.find((t) => t.id === id)?.group !== groupId),
  };
  if (group.collapsed || activeTab(s).group !== groupId) return next;
  const i = s.list.findIndex((t) => t.id === s.active);
  const to = nearestShown(next, s.list, i);
  if (to) return { ...next, active: to.id };
  const tab = makeTab();
  return { ...next, list: [...s.list, tab], active: tab.id };
}

/** A new empty tab at the end of a group, active. */
export function newTabInGroup(s: TabsState, groupId: string): TabsState {
  if (!findGroup(s, groupId)) return s;
  const tab = { ...makeTab(), group: groupId };
  const end = s.list.findLastIndex((t) => t.group === groupId);
  const list = [...s.list];
  list.splice(end + 1, 0, tab);
  const groups = s.groups.map((g) => (g.id === groupId ? { ...g, collapsed: false } : g));
  return { ...s, list, groups, active: tab.id, selected: [] };
}

/**
 * Move a whole group so it starts at position `to` of the list (counted with its own tabs).
 * It never lands inside another group: it goes after that group instead.
 */
export function moveGroup(s: TabsState, groupId: string, to: number): TabsState {
  const block = s.list.filter((t) => t.group === groupId);
  if (!block.length) return s;
  const before = s.list.slice(0, to).filter((t) => t.group !== groupId);
  const after = s.list.slice(to).filter((t) => t.group !== groupId);
  while (before.length && after[0]?.group && before.at(-1)!.group === after[0].group) {
    before.push(after.shift()!);
  }
  return { ...s, list: [...before, ...block, ...after] };
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

// ---- Saving per vault (open tabs, pins, groups and the active tab; not history) ----

interface Saved {
  tabs: { path: string | null; view: View; pinned?: boolean; group?: number }[];
  active: number;
  groups?: { name: string; color: GroupColor; collapsed?: boolean }[];
}

const VIEWS: readonly View[] = ["note", "graph", "tasks", "time"];

export function serialize(s: TabsState): string {
  const saved: Saved = {
    tabs: s.list.map((t) => ({
      path: t.path,
      view: t.view,
      ...(t.pinned ? { pinned: true } : {}),
      ...(t.group ? { group: s.groups.findIndex((g) => g.id === t.group) } : {}),
    })),
    active: Math.max(
      0,
      s.list.findIndex((t) => t.id === s.active),
    ),
    ...(s.groups.length
      ? {
          groups: s.groups.map((g) => ({
            name: g.name,
            color: g.color,
            ...(g.collapsed ? { collapsed: true } : {}),
          })),
        }
      : {}),
  };
  return JSON.stringify(saved);
}

/** Saved tabs, or one empty tab when there's nothing usable. */
export function deserialize(text: string | null): TabsState {
  try {
    const saved = JSON.parse(text ?? "") as Saved;
    const groups: TabGroup[] = (Array.isArray(saved.groups) ? saved.groups : []).map((g) => ({
      id: nextId("group"),
      name: typeof g?.name === "string" ? g.name : "",
      color: GROUP_COLORS.includes(g?.color) ? g.color : "grey",
      collapsed: g?.collapsed === true,
    }));
    const list = (Array.isArray(saved.tabs) ? saved.tabs : [])
      .filter(
        (t) =>
          t && (t.path === null || typeof t.path === "string") && VIEWS.includes(t.view as View),
      )
      .map((t) => ({
        ...makeTab({ path: t.path, view: t.view }, t.pinned === true),
        group: (Number.isInteger(t.group) && groups[t.group!]?.id) || null,
      }));
    if (!list.length) return initialTabs();
    const i = Number.isInteger(saved.active) ? saved.active : 0;
    const active = (list[i] ?? list[0]!).id;
    // tidy() keeps the rules; activate() makes sure the active tab isn't hidden.
    return activate(tidy({ list, active: "", closed: [], groups, selected: [] }), active);
  } catch {
    return initialTabs();
  }
}
