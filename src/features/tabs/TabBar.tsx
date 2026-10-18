import { createElement, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Pin, Plus, X } from "lucide-react";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { isEmpty, type Tab } from "../../app/tabs";
import { kindIcon, TAB_PANEL_ID, tabTitle } from "./tabInfo";
import { PATH_MIME } from "../../lib/fileKinds";
import { EntryIcon } from "../icons/EntryIcon";
import "./tabs.css";

const tabDomId = (id: string) => `tab-${id}`;

export function TabBar() {
  const tabs = useAppStore((s) => s.tabs);
  const store = useAppStore.getState;
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  // Keep the active tab in view when the row scrolls.
  useEffect(() => {
    document
      .getElementById(tabDomId(tabs.active))
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [tabs.active]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  // Arrow keys move between tabs (and open them), like any tab list.
  const onKeyDown = (e: KeyboardEvent) => {
    const i = tabs.list.findIndex((t) => t.id === tabs.active);
    const to =
      e.key === "ArrowRight"
        ? (i + 1) % tabs.list.length
        : e.key === "ArrowLeft"
          ? (i - 1 + tabs.list.length) % tabs.list.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.list.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    const id = tabs.list[to]!.id;
    store().activateTab(id);
    requestAnimationFrame(() => document.getElementById(tabDomId(id))?.focus());
  };

  const drop = (index: number) => {
    if (dragging) {
      const from = tabs.list.findIndex((t) => t.id === dragging);
      // Dropping after itself moves it one less to the right.
      store().moveTab(dragging, from < index ? index - 1 : index);
    }
    setDragging(null);
    setDropAt(null);
  };

  const menuTab = menu && tabs.list.find((t) => t.id === menu.id);

  return (
    <div className="tabbar-row">
      <div
        ref={bar}
        className="tabbar"
        role="tablist"
        aria-label="Open tabs"
        onKeyDown={onKeyDown}
        onDoubleClick={(e) => e.target === e.currentTarget && store().newTab()}
        onDragOver={(e) => {
          if (!dragging) return;
          e.preventDefault();
          if (e.target === e.currentTarget) setDropAt(tabs.list.length);
        }}
        onDrop={(e) => {
          if (!dragging) return;
          e.preventDefault();
          drop(dropAt ?? tabs.list.length);
        }}
      >
        {tabs.list.map((tab, i) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === tabs.active}
            dropBefore={dropAt === i && dragging !== null}
            dropAfter={dropAt === tabs.list.length && i === tabs.list.length - 1 && !!dragging}
            onMenu={(x, y) => setMenu({ x, y, id: tab.id })}
            onDragStart={() => setDragging(tab.id)}
            onDragEnd={() => {
              setDragging(null);
              setDropAt(null);
            }}
            onDragOverHalf={(after) => setDropAt(after ? i + 1 : i)}
          />
        ))}
      </div>
      <button
        className="tab-new"
        aria-label="New tab"
        title="New tab (Ctrl+T)"
        onClick={() => store().newTab()}
      >
        <Plus size={15} aria-hidden />
      </button>

      {menu && menuTab && (
        <div
          className="filetree-menu tab-menu"
          role="menu"
          aria-label={`${tabTitle(menuTab)} tab`}
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MenuItem label="Close" onClick={() => store().closeTab(menu.id)} close={setMenu} />
          <MenuItem
            label="Close others"
            onClick={() => store().closeOtherTabs(menu.id)}
            close={setMenu}
          />
          <MenuItem
            label="Close tabs to the right"
            onClick={() => store().closeTabsToRight(menu.id)}
            close={setMenu}
          />
          <MenuItem
            label={menuTab.pinned ? "Unpin" : "Pin"}
            onClick={() => store().togglePinTab(menu.id)}
            close={setMenu}
          />
        </div>
      )}
    </div>
  );
}

function TabItem({
  tab,
  active,
  dropBefore,
  dropAfter,
  onMenu,
  onDragStart,
  onDragEnd,
  onDragOverHalf,
}: {
  tab: Tab;
  active: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onMenu(x: number, y: number): void;
  onDragStart(): void;
  onDragEnd(): void;
  onDragOverHalf(after: boolean): void;
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
      aria-selected={active}
      aria-controls={TAB_PANEL_ID}
      tabIndex={active ? 0 : -1}
      title={tab.path ?? title}
      data-path={tab.path ?? undefined}
      className={[
        "tab",
        active && "active",
        tab.pinned && "pinned",
        isEmpty(tab) && "empty-tab",
        dropBefore && "drop-before",
        dropAfter && "drop-after",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable
      onClick={() => store().activateTab(tab.id)}
      // Middle-click closes; stop the browser's autoscroll from starting on it.
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
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
      onDragStart={(e) => {
        // The app's own path type only (a canvas takes it as a note card); plain text would
        // drop the file path into a note.
        if (tab.path) e.dataTransfer?.setData(PATH_MIME, tab.path);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onDragOverHalf(e.clientX > r.left + r.width / 2);
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

function MenuItem(props: { label: string; onClick(): void; close(v: null): void }) {
  return (
    <button
      role="menuitem"
      onClick={() => {
        props.close(null);
        props.onClick();
      }}
    >
      {props.label}
    </button>
  );
}
