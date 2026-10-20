import { Suspense } from "react";
import {
  Clock,
  FolderTree,
  Hash,
  House,
  ListChecks,
  Network,
  Search,
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
import { PanelResizer } from "./PanelResizer";
import { PanelToggle } from "./PanelToggle";
import { SearchPanel } from "./SearchPanel";
import { TagsPanel } from "./TagsPanel";
import { VaultMenu } from "../vault/VaultMenu";
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

export function RightSidebar() {
  return (
    <aside className="sidebar sidebar-right" aria-label="Links">
      {/* Under the window's own buttons, level with the tab row; it moves the window. */}
      {backend.windowFrame && <div className="sidebar-right-head" data-tauri-drag-region />}
      <Calendar />
      <Suspense fallback={null}>
        <LocalGraph />
      </Suspense>
      <div className="sidebar-body">
        <BacklinksPanel />
      </div>
      <PanelResizer side="right" />
    </aside>
  );
}
