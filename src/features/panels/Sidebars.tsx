import { Suspense, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FolderTree,
  Hash,
  House,
  ListChecks,
  Network,
  Search,
  Sparkles,
  Settings as SettingsIcon,
} from "lucide-react";
import { lazyNamed } from "../../app/lazy";

// The local graph (and its graph library) loads right after the first paint.
const LocalGraph = lazyNamed(() => import("../graph/GraphView"), "LocalGraph");
import { backend } from "../../ipc";
import { useUi } from "../commands/ui";
import { type LeftPanel, useAppStore } from "../../app/store";
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
import "./panels.css";

const TABS: { id: LeftPanel; label: string; Icon: typeof Search }[] = [
  { id: "files", label: "Files", Icon: FolderTree },
  { id: "search", label: "Search", Icon: Search },
  { id: "tags", label: "Tags", Icon: Hash },
];

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

export function LeftSidebar() {
  const vault = useAppStore((s) => s.vault);
  const panel = useAppStore((s) => s.leftPanel);
  const setPanel = useAppStore((s) => s.setLeftPanel);
  return (
    <aside className="sidebar" aria-label="Navigation">
      <header className="sidebar-header" title={vault?.root} data-tauri-drag-region>
        <VaultMenu />
        <PanelToggle side="left" className="sidebar-settings" />
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
        <div className="sidebar-seg" role="tablist" aria-label="Sidebar panels">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={panel === id}
              aria-label={label}
              title={label}
              className={panel === id ? "active" : undefined}
              onClick={() => setPanel(id)}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
        <div className="sidebar-views" role="toolbar" aria-label="Open a view">
          {VIEWS.map(({ label, title, Icon, open }) => (
            <button key={label} aria-label={label} title={title} onClick={open}>
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>
      <div className="sidebar-body" role="tabpanel">
        {panel === "files" && <FileTree />}
        {panel === "search" && <SearchPanel />}
        {panel === "tags" && <TagsPanel />}
      </div>
      <PanelResizer side="left" />
    </aside>
  );
}

const SECTIONS_KEY = "axisnotes:right-panel-sections";
type SectionId = "calendar" | "outline" | "graph";

/** Which right-panel sections are open (this device; all open at first). */
function useOpenSections() {
  const [open, setOpen] = useState<Record<SectionId, boolean>>(() => {
    try {
      return {
        calendar: true,
        outline: true,
        graph: true,
        ...JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? "{}"),
      };
    } catch {
      return { calendar: true, outline: true, graph: true };
    }
  });
  const toggle = (id: SectionId) =>
    setOpen((o) => {
      const next = { ...o, [id]: !o[id] };
      try {
        localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
      } catch {
        // Not remembered, that's all.
      }
      return next;
    });
  return [open, toggle] as const;
}

function SectionToggle({
  title,
  open,
  onToggle,
  buttonRef,
}: {
  title: string;
  open: boolean;
  onToggle(): void;
  buttonRef?(button: HTMLButtonElement | null): void;
}) {
  return (
    <button ref={buttonRef} className="side-section-toggle" aria-expanded={open} onClick={onToggle}>
      {open ? (
        <ChevronDown size={13} aria-hidden="true" />
      ) : (
        <ChevronRight size={13} aria-hidden="true" />
      )}
      {title}
    </button>
  );
}

/**
 * The right panel shows what fits the open view: the calendar (not on Home, which has its
 * own), and for a note its outline, local graph and links. Grids and canvases get their
 * links; Graph, Tasks and Time only the calendar. Sections fold, remembered per device.
 */
export function RightSidebar() {
  const chat = useSidebarChat((s) => s.open);
  const root = useAppStore((s) => s.vault?.root);
  const view = useAppStore((s) => s.mainView);
  const activePath = useAppStore((s) => s.activePath);
  const tabPath = useAppStore((s) => activeTab(s.tabs).path);
  const [open, toggle] = useOpenSections();
  // The lazy graph replaces its header on collapse. Keep keyboard focus on its replacement.
  const refocusGraph = useRef(false);
  const graphToggle = (
    <SectionToggle
      title="Local graph"
      open={open.graph}
      buttonRef={(button) => {
        if (button && refocusGraph.current) {
          if (document.activeElement === document.body) button.focus();
          refocusGraph.current = false;
        }
      }}
      onToggle={() => {
        refocusGraph.current = document.activeElement?.matches(".side-section-toggle") ?? false;
        toggle("graph");
      }}
    />
  );
  const file = view === "note" ? activePath : null;
  const kind = file ? docKind(file) : null;
  const isNote = kind === "markdown";
  const linkable = isNote || kind === "grid" || kind === "canvas";
  const onHome = view === "dashboard" && (tabPath ?? "") === "";
  return (
    <aside className="sidebar sidebar-right" aria-label="Links">
      {/* Under the window's own buttons, level with the tab row; it moves the window. */}
      {backend.windowFrame && <div className="sidebar-right-head" data-tauri-drag-region />}
      <div className="sidebar-tabs" role="tablist" aria-label="Right sidebar panels">
        <button
          type="button"
          role="tab"
          aria-selected={!chat}
          onClick={() => useSidebarChat.setState({ open: false })}
        >
          Note details
        </button>
        <button type="button" role="tab" aria-selected={chat} onClick={() => openSidebarChat(null)}>
          <Sparkles size={14} /> AI chat
        </button>
      </div>
      {chat ? (
        <Suspense fallback={<p className="panel-note">Opening AI chat…</p>}>
          <SidebarChat key={root} />
        </Suspense>
      ) : (
        <>
          {!onHome && (
            <section className="side-section" aria-label="Calendar section">
              <h2 className="side-section-head">
                <SectionToggle
                  title="Calendar"
                  open={open.calendar}
                  onToggle={() => toggle("calendar")}
                />
              </h2>
              {open.calendar && <Calendar />}
            </section>
          )}
          {isNote && file && (
            <section className="side-section side-outline" aria-label="Outline section">
              <h2 className="side-section-head">
                <SectionToggle
                  title="Outline"
                  open={open.outline}
                  onToggle={() => toggle("outline")}
                />
              </h2>
              {open.outline && <OutlinePanel path={file} />}
            </section>
          )}
          {isNote &&
            (open.graph ? (
              <Suspense fallback={null}>
                <LocalGraph toggle={graphToggle} />
              </Suspense>
            ) : (
              <section className="side-section" aria-label="Local graph">
                <h2 className="side-section-head">{graphToggle}</h2>
              </section>
            ))}
          {linkable && (
            <div className="sidebar-body">
              <BacklinksPanel />
            </div>
          )}
          {!file && (
            <p className="panel-note muted side-hint">Open a note to see its outline and links.</p>
          )}
        </>
      )}
      <PanelResizer side="right" />
    </aside>
  );
}
