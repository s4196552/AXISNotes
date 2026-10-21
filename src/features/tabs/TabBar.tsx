import {
  createElement,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { House, Pin, Plus, X } from "lucide-react";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { useAreaZoomProps } from "../../app/zoom";
import { usePointerDrag } from "../../app/usePointerDrag";
import {
  findGroup,
  GROUP_COLORS,
  isEmpty,
  selection,
  shownTabs,
  type Tab,
  type TabGroup,
} from "../../app/tabs";
import { groupLabel, kindIcon, TAB_PANEL_ID, tabTitle } from "./tabInfo";
import { EntryIcon } from "../icons/EntryIcon";
import "./tabs.css";

const tabDomId = (id: string) => `tab-${id}`;
const chipDomId = (id: string) => `tab-group-${id}`;

/** What's being dragged: a tab, or a whole group by its chip. */
type Drag = { kind: "tab" | "group"; id: string };
/**
 * Where it would land: list position, the group a dropped tab joins (null: none), and the
 * element showing the drop marker (a tab or chip DOM id, or "end").
 */
type Drop = { index: number; group: string | null; mark: string; side: "before" | "after" };

export function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const store = useAppStore.getState;
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [editor, setEditor] = useState<{ x: number; y: number; id: string } | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  // Keep the active tab in view when the row scrolls.
  useEffect(() => {
    document
      .getElementById(tabDomId(tabs.active))
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [tabs.active]);

  useEffect(() => {
    if (!menu && !editor) return;
    const close = () => {
      setMenu(null);
      setEditor(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu, editor]);

  /** Open a group's editor under its chip (after the chip has rendered). */
  const openEditor = (id: string) =>
    requestAnimationFrame(() => {
      const r = document.getElementById(chipDomId(id))?.getBoundingClientRect();
      if (r) setEditor({ x: r.left, y: r.bottom + 4, id });
    });

  const shown = shownTabs(tabs);

  // Arrow keys move between tabs (and open them), like any tab list; Escape clears the
  // selection.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && tabs.selected.length) {
      e.preventDefault();
      store().clearTabSelection();
      return;
    }
    if (!(e.target as Element).matches('[role="tab"]')) return;
    const i = shown.findIndex((t) => t.id === tabs.active);
    const to =
      e.key === "ArrowRight"
        ? (i + 1) % shown.length
        : e.key === "ArrowLeft"
          ? (i - 1 + shown.length) % shown.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? shown.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    const id = shown[to]!.id;
    store().activateTab(id);
    requestAnimationFrame(() => document.getElementById(tabDomId(id))?.focus());
  };

  const atEnd: Drop = { index: tabs.list.length, group: null, mark: "end", side: "after" };

  /** Where a dragged tab or group lands with the pointer at x, y. */
  const dropFor = (x: number, y: number): Drop | null => {
    const el = document.elementFromPoint(x, y);
    if (!bar.current || !el || !bar.current.contains(el)) return null;
    const tabEl = el.closest<HTMLElement>('[role="tab"]');
    const i = tabEl ? tabs.list.findIndex((t) => tabDomId(t.id) === tabEl.id) : -1;
    if (tabEl && i !== -1) {
      const r = tabEl.getBoundingClientRect();
      const after = x > r.left + r.width / 2;
      // A tab dropped next to a grouped tab joins its group.
      return {
        index: after ? i + 1 : i,
        group: tabs.list[i]!.group,
        mark: tabEl.id,
        side: after ? "after" : "before",
      };
    }
    // Dropped on a group's chip: just before that group, never inside it.
    const chip = el.closest<HTMLElement>(".tab-group-chip");
    const first = chip ? tabs.list.findIndex((t) => t.group && chipDomId(t.group) === chip.id) : -1;
    if (chip && first !== -1) return { index: first, group: null, mark: chip.id, side: "before" };
    return atEnd;
  };

  const {
    press,
    dragging,
    target: dropAt,
  } = usePointerDrag<Drag, Drop>(dropFor, (drag, at) => {
    if (drag.kind === "tab") {
      const from = tabs.list.findIndex((t) => t.id === drag.id);
      // Dropping after itself moves it one less to the right.
      store().moveTab(drag.id, from < at.index ? at.index - 1 : at.index, at.group);
    } else {
      store().moveTabGroup(drag.id, at.index);
    }
  });

  const marker = (mark: string) =>
    dropAt?.mark === mark && dragging ? `drop-${dropAt.side}` : undefined;

  // Tabs in order, each group's chip before its first tab; a collapsed group's tabs hidden.
  const items: ReactNode[] = [];
  tabs.list.forEach((tab, i) => {
    const group = findGroup(tabs, tab.group);
    if (group && tabs.list[i - 1]?.group !== group.id) {
      const count = tabs.list.filter((t) => t.group === group.id).length;
      items.push(
        <GroupChip
          key={group.id}
          group={group}
          count={count}
          marker={marker(chipDomId(group.id))}
          onEdit={() => openEditor(group.id)}
          onPress={(e) => press(e, { kind: "group", id: group.id })}
        />,
      );
    }
    if (group?.collapsed) return;
    items.push(
      <TabItem
        key={tab.id}
        tab={tab}
        group={group}
        groupEnd={!!group && tabs.list[i + 1]?.group !== group.id}
        active={tab.id === tabs.active}
        selected={tabs.selected.includes(tab.id)}
        marker={marker(tabDomId(tab.id))}
        onMenu={(x, y) => setMenu({ x, y, id: tab.id })}
        onPress={(e) => press(e, { kind: "tab", id: tab.id })}
      />,
    );
  });

  const zoomProps = useAreaZoomProps("tabs");

  return (
    // The row is the window's title bar: its empty part moves the window (see WindowControls).
    <div className="tabbar-row" data-tauri-drag-region {...zoomProps}>
      <div
        ref={bar}
        className={["tabbar", marker("end") && "drop-end"].filter(Boolean).join(" ")}
        role="tablist"
        aria-label="Open tabs"
        aria-multiselectable
        onKeyDown={onKeyDown}
        onDoubleClick={(e) => e.target === e.currentTarget && store().newTab()}
      >
        {items}
      </div>
      <button
        className="tab-new"
        aria-label="Go to Home"
        title="Home (Ctrl+Shift+H)"
        onClick={() => store().openDashboard("")}
      >
        <House size={15} aria-hidden />
      </button>
      <button
        className="tab-new"
        aria-label="New tab"
        title="New tab (Ctrl+T)"
        onClick={() => store().newTab()}
      >
        <Plus size={15} aria-hidden />
      </button>

      {menu && (
        <TabMenu
          id={menu.id}
          x={menu.x}
          y={menu.y}
          close={() => setMenu(null)}
          onNewGroup={openEditor}
        />
      )}
      {editor && (
        <GroupEditor
          key={editor.id}
          id={editor.id}
          x={editor.x}
          y={editor.y}
          close={() => setEditor(null)}
        />
      )}
    </div>
  );
}

function TabItem({
  tab,
  group,
  groupEnd,
  active,
  selected,
  marker,
  onMenu,
  onPress,
}: {
  tab: Tab;
  group: TabGroup | undefined;
  groupEnd: boolean;
  active: boolean;
  selected: boolean;
  marker: string | undefined;
  onMenu(x: number, y: number): void;
  /** A press that may become a drag. */
  onPress(e: ReactPointerEvent): void;
}) {
  const custom = useConfig((s) =>
    tab.path !== null && tab.view === "note" ? s.config.folderIcons[tab.path] : undefined,
  );
  const store = useAppStore.getState;
  const title = tabTitle(tab);
  const Kind = kindIcon(tab);
  // Looked up from a fixed table, not created during render.
  const kind = Kind
    ? createElement(Kind, { size: 14, className: "tab-icon", "aria-hidden": true })
    : null;
  const close = () => {
    if (!tab.pinned) store().closeTab(tab.id);
  };

  return (
    <div
      id={tabDomId(tab.id)}
      role="tab"
      aria-selected={active || selected}
      aria-current={active ? "page" : undefined}
      aria-controls={TAB_PANEL_ID}
      tabIndex={active ? 0 : -1}
      title={tab.path ?? title}
      data-path={tab.path ?? undefined}
      data-color={group?.color}
      className={[
        "tab",
        active && "active",
        selected && "selected",
        tab.pinned && "pinned",
        isEmpty(tab) && "empty-tab",
        group && "grouped",
        groupEnd && "group-end",
        marker,
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDown={onPress}
      // Ctrl/Cmd+click and Shift+click select tabs (for grouping); a plain click opens one.
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) store().selectTab(tab.id, "toggle");
        else if (e.shiftKey) store().selectTab(tab.id, "range");
        else store().activateTab(tab.id);
      }}
      // Middle-click closes; stop the browser's autoscroll from starting on it.
      onMouseDown={(e) => {
        if (e.button === 1 || e.shiftKey) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        close();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        if (e.key === "Delete") {
          e.preventDefault();
          close();
        }
      }}
    >
      {custom ? <EntryIcon icon={custom} size={14} fallback={kind} /> : kind}
      <span className="tab-title">{title}</span>
      {tab.pinned ? (
        <button
          className="tab-close tab-pin"
          tabIndex={-1}
          aria-label={`Unpin ${title}`}
          title="Pinned (click to unpin)"
          onClick={(e) => {
            e.stopPropagation();
            store().togglePinTab(tab.id);
          }}
        >
          <Pin size={12} aria-hidden />
        </button>
      ) : (
        <button
          className="tab-close"
          tabIndex={-1}
          aria-label={`Close ${title}`}
          title="Close (Ctrl+W)"
          onClick={(e) => {
            e.stopPropagation();
            close();
          }}
        >
          <X size={13} aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * A group's label before its tabs: a coloured circle, or the name on a coloured pill. A
 * click collapses or expands the group; right-click edits it; drag moves the whole group.
 */
function GroupChip({
  group,
  count,
  marker,
  onEdit,
  onPress,
}: {
  group: TabGroup;
  count: number;
  marker: string | undefined;
  onEdit(): void;
  /** A press that may become a drag. */
  onPress(e: ReactPointerEvent): void;
}) {
  const label = groupLabel(group);
  const tabsText = `${count} ${count === 1 ? "tab" : "tabs"}`;
  return (
    <button
      id={chipDomId(group.id)}
      className={["tab-group-chip", group.name && "named", group.collapsed && "collapsed", marker]
        .filter(Boolean)
        .join(" ")}
      data-color={group.color}
      aria-expanded={!group.collapsed}
      aria-label={`${label}, ${tabsText}`}
      title={`${label}: ${tabsText}. Click to ${group.collapsed ? "expand" : "collapse"}; right-click to edit.`}
      onPointerDown={onPress}
      onClick={() => useAppStore.getState().toggleTabGroup(group.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onEdit();
      }}
    >
      {group.name ? (
        <span className="tab-group-name">{group.name}</span>
      ) : (
        <span className="tab-group-dot" aria-hidden />
      )}
      {group.collapsed && <span className="tab-group-count">{count}</span>}
    </button>
  );
}

/** Right-click menu for a tab, or for all the selected tabs when it's one of them. */
function TabMenu(props: {
  id: string;
  x: number;
  y: number;
  close(): void;
  onNewGroup(id: string): void;
}) {
  const tabs = useAppStore((s) => s.tabs);
  const store = useAppStore.getState;
  const tab = tabs.list.find((t) => t.id === props.id);
  if (!tab) return null;
  const sel = selection(tabs);
  const targets = sel.length > 1 && sel.includes(tab.id) ? sel : [tab.id];
  const many = targets.length > 1;
  const what = many ? `${targets.length} tabs` : "tab";
  const targetTabs = tabs.list.filter((t) => targets.includes(t.id));
  const otherGroups = tabs.groups.filter((g) => targetTabs.some((t) => t.group !== g.id));
  const item = (label: string, run: () => void, className?: string) => (
    <button
      role="menuitem"
      className={className}
      onClick={() => {
        props.close();
        run();
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      className="filetree-menu tab-menu"
      role="menu"
      aria-label={many ? `${targets.length} selected tabs` : `${tabTitle(tab)} tab`}
      style={{ left: props.x, top: props.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {item(`Add ${what} to new group`, () => {
        const id = store().groupTabs(targets);
        if (id) props.onNewGroup(id);
      })}
      {otherGroups.map((g) => (
        <button
          key={g.id}
          role="menuitem"
          className="tab-menu-group"
          data-color={g.color}
          onClick={() => {
            props.close();
            store().addTabsToGroup(targets, g.id);
          }}
        >
          <span className="tab-group-dot" aria-hidden />
          Add to “{groupLabel(g)}”
        </button>
      ))}
      {targetTabs.some((t) => t.group) &&
        item("Remove from group", () => store().removeTabsFromGroup(targets))}
      <div className="tab-menu-sep" role="separator" />
      {many
        ? item(`Close ${what}`, () =>
            targetTabs.filter((t) => !t.pinned).forEach((t) => store().closeTab(t.id)),
          )
        : item("Close", () => store().closeTab(tab.id))}
      {!many && item("Close others", () => store().closeOtherTabs(tab.id))}
      {!many && item("Close tabs to the right", () => store().closeTabsToRight(tab.id))}
      {!many && item(tab.pinned ? "Unpin" : "Pin", () => store().togglePinTab(tab.id))}
    </div>
  );
}

/** Name, colour and actions for a group, under its chip. */
function GroupEditor(props: { id: string; x: number; y: number; close(): void }) {
  const group = useAppStore((s) => findGroup(s.tabs, props.id));
  const store = useAppStore.getState;
  if (!group) return null;
  const act = (run: () => void) => () => {
    props.close();
    run();
  };
  return (
    <div
      className="filetree-menu tab-group-editor"
      role="dialog"
      aria-label="Edit tab group"
      style={{ left: props.x, top: props.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && e.target instanceof HTMLInputElement)) {
          e.preventDefault();
          props.close();
        }
      }}
    >
      <input
        autoFocus
        value={group.name}
        placeholder="Name this group"
        aria-label="Group name"
        onChange={(e) => store().updateTabGroup(group.id, { name: e.target.value })}
      />
      <div className="tab-group-colors" role="radiogroup" aria-label="Group colour">
        {GROUP_COLORS.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={c === group.color}
            aria-label={c}
            title={c}
            className="tab-group-swatch"
            data-color={c}
            onClick={() => store().updateTabGroup(group.id, { color: c })}
          />
        ))}
      </div>
      <div className="tab-menu-sep" role="separator" />
      <button onClick={act(() => store().newTabInGroup(group.id))}>New tab in group</button>
      <button onClick={act(() => store().ungroupTabs(group.id))}>Ungroup</button>
      <button className="danger" onClick={act(() => store().closeTabGroup(group.id))}>
        Close group
      </button>
    </div>
  );
}
