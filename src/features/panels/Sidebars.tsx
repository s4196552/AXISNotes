import { type ReactNode, Suspense, useEffect, useRef } from "react";
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronRight,
  Clock,
  Ellipsis,
  FolderTree,
  Grid2X2,
  Hash,
  House,
  ListChecks,
  Network,
  Search,
  Sparkles,
  Settings as SettingsIcon,
  Star,
} from "lucide-react";
import { lazyNamed } from "../../app/lazy";

// The local graph (and its graph library) loads right after the first paint.
const LocalGraph = lazyNamed(() => import("../graph/GraphView"), "LocalGraph");
import { backend } from "../../ipc";
import { useConfig } from "../../app/config";
import { useLayout } from "../../app/layout";
import { HubView } from "../hub";
import { Ribbon } from "../ribbon/Ribbon";
import { useUi } from "../commands/ui";
import { type LeftPanel, useAppStore } from "../../app/store";
import {
  isFullHeight,
  PANEL_LABELS,
  type PanelId,
  setSectionOpen,
  type SidebarSide,
  usePanelRequest,
  usePlacement,
  useSectionOpen,
} from "../../app/sidebarLayout";
import { Calendar } from "../daily/Calendar";
import { FileTree } from "../filetree";
import { BacklinksPanel } from "./BacklinksPanel";
import { OutlinePanel } from "./OutlinePanel";
import { activeTab } from "../../app/tabs";
import { docKind } from "../../lib/fileKinds";
import { PanelResizer } from "./PanelResizer";
import { PanelToggle } from "./PanelToggle";
import { SearchPanel } from "./SearchPanel";
import { TagsPanel } from "./TagsPanel";
import { VaultMenu } from "../vault/VaultMenu";
import { openSidebarChat, useSidebarChat } from "../ai/sidebarChatState";
const SidebarChat = lazyNamed(() => import("../ai/SidebarChat"), "SidebarChat");
import { showSkillResults, useSkillResults } from "../skills/skillDestination";
const SkillResultsSidebar = lazyNamed(
  () => import("../skills/SkillResultsSidebar"),
  "SkillResultsSidebar",
);
import { FavoritesList } from "./FavoritesPanel";
import { AddPanelButton, SidebarMenu } from "./PanelMenus";
import {
  keepFocus,
  openPanelMenu,
  panelHandle,
  useDropMark,
  usePanelDrag,
  usePanelDragView,
} from "./panelCustomize";
import "./panels.css";

/** Icons of the panels shown as tabs in the left sidebar. */
const TAB_ICONS: Partial<Record<PanelId, typeof Search>> = {
  files: FolderTree,
  search: Search,
  tags: Hash,
  hub: Grid2X2,
};

/** Views that open in a tab of the main area (not side panels, so never shown as selected). */
const VIEWS: { label: string; title: string; Icon: typeof Search; open(): void }[] = [
  {
    label: "Home",
    title: "Home (Ctrl+Shift+H)",
    Icon: House,
    open: () => useAppStore.getState().openDashboard(""),
  },
  {
    label: "Graph view",
    title: "Graph view (Ctrl+G)",
    Icon: Network,
    open: () => useAppStore.getState().setMainView("graph"),
  },
  {
    label: "Tasks",
    title: "Tasks (Ctrl+Shift+T)",
    Icon: ListChecks,
    open: () => useAppStore.getState().setMainView("tasks"),
  },
  {
    label: "Time report",
    title: "Time report",
    Icon: Clock,
    open: () => useAppStore.getState().setMainView("time"),
  },
];

function SidebarHub() {
  return (
    <div className="sidebar-hub">
      <Suspense fallback={<p className="panel-note">Opening AXIS Hub…</p>}>
        <HubView />
      </Suspense>
    </div>
  );
}

/** What the open view offers the panels that depend on it. */
function usePanelContext() {
  const view = useAppStore((s) => s.mainView);
  const activePath = useAppStore((s) => s.activePath);
  const tabPath = useAppStore((s) => activeTab(s.tabs).path);
  const hubEnabled = useConfig((s) => s.config.hubEnabled);
  const file = view === "note" ? activePath : null;
  const kind = file ? docKind(file) : null;
  const isNote = kind === "markdown";
  return {
    file,
    isNote,
    linkable: isNote || kind === "grid" || kind === "canvas",
    onHome: view === "dashboard" && (tabPath ?? "") === "",
    hubEnabled,
  };
}
type PanelContext = ReturnType<typeof usePanelContext>;

/**
 * Whether a panel has something to show now: the calendar isn't shown on Home (which has
 * its own), a note's outline and graph need a note, its links a note, grid or canvas.
 */
function available(id: PanelId, ctx: PanelContext): boolean {
  switch (id) {
    case "hub":
      return ctx.hubEnabled;
    case "calendar":
      return !ctx.onHome;
    case "outline":
    case "graph":
      return ctx.isNote;
    case "backlinks":
      return ctx.linkable;
    default:
      return true;
  }
}

function SectionToggle({
  title,
  open,
  onToggle,
  handle,
}: {
  title: string;
  open: boolean;
  onToggle(): void;
  handle: ReturnType<typeof panelHandle>;
}) {
  return (
    <button
      type="button"
      className="side-section-toggle"
      aria-expanded={open}
      title={`${title}: drag to move, Alt+↑ / Alt+↓ to reorder, right-click for more`}
      {...handle}
      onClick={onToggle}
    >
      {open ? (
        <ChevronDown size={13} aria-hidden="true" />
      ) : (
        <ChevronRight size={13} aria-hidden="true" />
      )}
      {title}
    </button>
  );
}

/** The ⋯ button beside a section's heading: the panel's menu (move, remove). */
function PanelMenuButton({
  id,
  side,
  group,
}: {
  id: PanelId;
  side: SidebarSide;
  group: PanelId[];
}) {
  return (
    <button
      type="button"
      className="side-section-menu"
      aria-label={`${PANEL_LABELS[id]} panel options`}
      title="Move or remove this panel"
      aria-haspopup="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => openPanelMenu(e, id, side, group)}
    >
      <Ellipsis size={14} aria-hidden="true" />
    </button>
  );
}

/** The body of a panel shown as a section. */
function sectionBody(id: PanelId, ctx: PanelContext): ReactNode {
  switch (id) {
    case "favorites":
      return <FavoritesList />;
    case "files":
      return <FileTree />;
    case "search":
      return <SearchPanel />;
    case "tags":
      return <TagsPanel />;
    case "hub":
      return <SidebarHub />;
    case "calendar":
      return <Calendar />;
    case "outline":
      return ctx.file ? <OutlinePanel path={ctx.file} /> : null;
    case "backlinks":
      return <BacklinksPanel />;
    case "graph":
      return null;
  }
}

/** Sections that take the room left over (a tall list) instead of their own height. */
const GROWS: ReadonlySet<PanelId> = new Set(["files", "search", "tags", "hub", "backlinks"]);

/**
 * One panel as a folding section: its heading folds it (remembered per device), drags it
 * and has its menu. `group` is the panels shown with it, in order, for moving by keyboard.
 */
function PanelSection({
  id,
  side,
  group,
  ctx,
}: {
  id: PanelId;
  side: SidebarSide;
  group: PanelId[];
  ctx: PanelContext;
}) {
  const isOpen = useSectionOpen();
  const press = usePanelDrag();
  const mark = useDropMark(id);
  const open = isOpen(id);
  const title = PANEL_LABELS[id];
  const toggle = () => {
    // The lazy graph replaces its heading when it folds: keep keyboard focus on the new one.
    if (document.activeElement?.matches(".side-section-toggle")) keepFocus(id);
    setSectionOpen(id, !open);
  };
  const head = (
    <>
      <SectionToggle
        title={title}
        open={open}
        onToggle={toggle}
        handle={panelHandle(press, id, side, group, "column")}
      />
      <PanelMenuButton id={id} side={side} group={group} />
    </>
  );

  if (id === "graph" && open) {
    return (
      <div className="side-panel" data-panel-id={id} {...mark}>
        <Suspense fallback={null}>
          <LocalGraph toggle={<span className="side-section-headline">{head}</span>} />
        </Suspense>
      </div>
    );
  }
  const grows = open && GROWS.has(id);
  return (
    <section
      className={["side-section", `side-${id}`, grows ? "grow" : ""].join(" ")}
      aria-label={id === "graph" ? title : `${title} section`}
      data-panel-id={id}
      {...mark}
    >
      <h2 className="side-section-head">{head}</h2>
      {open && sectionBody(id, ctx)}
    </section>
  );
}

/** A sidebar's stacked sections, in order. */
function SectionStack({
  ids,
  side,
  ctx,
  className,
  children,
}: {
  ids: PanelId[];
  side: SidebarSide;
  ctx: PanelContext;
  className: string;
  children?: ReactNode;
}) {
  return (
    <div className={className}>
      {ids.map((id) => (
        <PanelSection key={id} id={id} side={side} group={ids} ctx={ctx} />
      ))}
      {children}
    </div>
  );
}

/** A drag is over the empty part of this sidebar: it would land at the end. */
function useDropAtEnd(side: SidebarSide) {
  return usePanelDragView(
    (s) => s.dragging !== null && s.target?.side === side && s.target.id === null,
  );
}

function PanelTab({
  id,
  selected,
  onSelect,
  handle,
}: {
  id: PanelId;
  selected: boolean;
  onSelect(): void;
  handle: ReturnType<typeof panelHandle>;
}) {
  const mark = useDropMark(id);
  const Icon = TAB_ICONS[id] ?? (id === "favorites" ? Star : CalendarIcon);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={PANEL_LABELS[id]}
      title={`${PANEL_LABELS[id]}: drag to move, Alt+← / Alt+→ to reorder, right-click for more`}
      className={selected ? "active" : undefined}
      data-panel-id={id}
      {...mark}
      {...handle}
      onClick={onSelect}
    >
      <Icon size={15} />
    </button>
  );
}

/**
 * The left sidebar: the full-height panels placed here (Files, Search, Tags, Hub) as tabs,
 * one shown at a time, under any stacked panels placed here (Favorites first, by default).
 */
export function LeftSidebar() {
  const vault = useAppStore((s) => s.vault);
  const selected = useAppStore((s) => s.leftPanel);
  const ctx = usePanelContext();
  const placement = usePlacement();
  const tabs = placement.left.filter((id) => isFullHeight(id) && available(id, ctx));
  const sections = placement.left.filter((id) => !isFullHeight(id) && available(id, ctx));
  const panel = tabs.includes(selected) ? selected : (tabs[0] ?? null);
  const setPanel = useAppStore((s) => s.setLeftPanel);
  const ribbon = useConfig((s) => s.config.ribbon.enabled);
  const press = usePanelDrag();
  const dropEnd = useDropAtEnd("left");
  return (
    <aside
      className={[ribbon ? "sidebar with-ribbon" : "sidebar", dropEnd ? "panel-drop-end" : ""]
        .join(" ")
        .trim()}
      aria-label="Navigation"
      data-panel-side="left"
    >
      {ribbon && <Ribbon />}
      <div className="sidebar-main">
        <header className="sidebar-header" title={vault?.root} data-tauri-drag-region>
          <VaultMenu />
          <PanelToggle side="left" className="sidebar-settings" />
          <AddPanelButton side="left" className="sidebar-settings" />
          <button
            className="sidebar-settings"
            aria-label="Settings"
            title="Settings (Ctrl+,)"
            onClick={() => useUi.getState().open({ kind: "settings" })}
          >
            <SettingsIcon size={15} />
          </button>
        </header>
        {/* Panel tabs on the left; buttons that open a view in a tab after a divider. */}
        <div className="sidebar-tabs">
          {tabs.length > 0 && (
            <div className="sidebar-seg" role="tablist" aria-label="Sidebar panels">
              {tabs.map((id) => (
                <PanelTab
                  key={id}
                  id={id}
                  selected={panel === id}
                  onSelect={() => setPanel(id as LeftPanel)}
                  handle={panelHandle(press, id, "left", tabs, "row")}
                />
              ))}
            </div>
          )}
          {/* With the ribbon on, these are its buttons instead. */}
          {!ribbon && (
            <div className="sidebar-views" role="toolbar" aria-label="Open a view">
              {VIEWS.map(({ label, title, Icon, open }) => (
                <button key={label} aria-label={label} title={title} onClick={open}>
                  <Icon size={15} />
                </button>
              ))}
            </div>
          )}
        </div>
        {sections.length > 0 && (
          <SectionStack
            ids={sections}
            side="left"
            ctx={ctx}
            className={panel ? "side-stack side-stack-top" : "side-stack"}
          />
        )}
        {panel && (
          <div className="sidebar-body" role="tabpanel" aria-label={PANEL_LABELS[panel]}>
            {panel === "files" && <FileTree />}
            {panel === "search" && <SearchPanel />}
            {panel === "tags" && <TagsPanel />}
            {panel === "hub" && <SidebarHub />}
          </div>
        )}
        {!panel && sections.length === 0 && (
          <p className="panel-note muted side-hint">
            No panels here. Add one with the + button above, or drag one here from the right
            sidebar.
          </p>
        )}
      </div>
      <SidebarMenu side="left" />
      <PanelResizer side="left" />
    </aside>
  );
}

/**
 * The right panel shows what fits the open view, as folding sections in the user's order:
 * by default the calendar (not on Home, which has its own), and for a note its outline,
 * local graph and links. Grids and canvases get their links; Graph, Tasks and Time only the
 * calendar. Any panel can be moved here, or away (T-275). Sections fold, remembered per
 * device.
 */
export function RightSidebar() {
  const chat = useSidebarChat((s) => s.open);
  const results = useSkillResults((s) => s.open);
  const hubEnabled = useConfig((s) => s.loaded && s.config.hubEnabled);
  const selected = useLayout((s) => s.rightPanel);
  // Skill results and AI chat open on top of the chosen panel (details or Hub).
  const hub = !chat && !results && hubEnabled && selected === "hub";
  // AI chat opened from elsewhere (the note's right-click menu) comes to the front.
  const chatWasOpen = useRef(chat);
  useEffect(() => {
    if (chat && !chatWasOpen.current) useSkillResults.setState({ open: false });
    chatWasOpen.current = chat;
  }, [chat]);
  const root = useAppStore((s) => s.vault?.root);
  const ctx = usePanelContext();
  const placement = usePlacement();
  const sections = placement.right.filter((id) => available(id, ctx));
  const needsNote = placement.right.some((id) => ["outline", "graph", "backlinks"].includes(id));
  const dropEnd = useDropAtEnd("right");

  function selectPanel(panel: typeof selected) {
    useLayout.getState().setRightPanel(panel);
    useSidebarChat.setState({ open: false });
    useSkillResults.setState({ open: false });
  }

  // A command asked for a panel that lives here: show Note details with it in view.
  useEffect(
    () =>
      usePanelRequest.subscribe(({ id }) => {
        useSidebarChat.setState({ open: false });
        useSkillResults.setState({ open: false });
        requestAnimationFrame(() =>
          document
            .querySelector(`.sidebar-right [data-panel-id="${id}"]`)
            ?.scrollIntoView?.({ block: "nearest" }),
        );
      }),
    [],
  );

  return (
    <aside
      className={dropEnd ? "sidebar sidebar-right panel-drop-end" : "sidebar sidebar-right"}
      aria-label="Right sidebar"
      data-panel-side="right"
    >
      {/* Under the window's own buttons, level with the tab row; it moves the window. */}
      {backend.windowFrame && <div className="sidebar-right-head" data-tauri-drag-region />}
      <div className="sidebar-tabs">
        <div className="sidebar-right-tabs" role="tablist" aria-label="Right sidebar panels">
          <button
            type="button"
            role="tab"
            aria-selected={!chat && !results && !hub}
            onClick={() => selectPanel("details")}
          >
            Note details
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={chat && !results}
            onClick={() => {
              useSkillResults.setState({ open: false });
              openSidebarChat(null);
            }}
          >
            <Sparkles size={14} /> AI chat
          </button>
          {hubEnabled && (
            <button type="button" role="tab" aria-selected={hub} onClick={() => selectPanel("hub")}>
              <Grid2X2 size={14} aria-hidden="true" /> AXIS Hub
            </button>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={results}
            onClick={() => showSkillResults()}
          >
            Skill results
          </button>
        </div>
        <AddPanelButton side="right" className="sidebar-add-panel" />
      </div>
      {results ? (
        <Suspense fallback={<p className="panel-note">Opening skill results…</p>}>
          <SkillResultsSidebar key={root} />
        </Suspense>
      ) : chat ? (
        <Suspense fallback={<p className="panel-note">Opening AI chat…</p>}>
          <SidebarChat key={root} />
        </Suspense>
      ) : hub ? (
        <div className="sidebar-body" role="tabpanel" aria-label="AXIS Hub">
          <SidebarHub />
        </div>
      ) : (
        <SectionStack ids={sections} side="right" ctx={ctx} className="side-stack">
          {!ctx.file && needsNote && (
            <p className="panel-note muted side-hint">Open a note to see its outline and links.</p>
          )}
          {placement.right.length === 0 && (
            <p className="panel-note muted side-hint">
              No panels here. Add one with the + button above, or drag one here from the left
              sidebar.
            </p>
          )}
        </SectionStack>
      )}
      <SidebarMenu side="right" />
      <PanelResizer side="right" />
    </aside>
  );
}
