import { FeatureBoundary } from "../modules/FeatureBoundary";
import { Suspense, useState } from "react";
import {
  Clock,
  FolderTree,
  Hash,
  ListChecks,
  Network,
  Search,
  Settings as SettingsIcon,
} from "lucide-react";
import { lazyNamed } from "../../app/lazy";

// The local graph loads only when expanded by the user.
const LocalGraph = lazyNamed(() => import("../graph/GraphView"), "LocalGraph");
import { useFeatureEnabled } from "../modules/features";
import { useUi } from "../commands/ui";
import { type LeftPanel, useAppStore } from "../../app/store";
import { Calendar } from "../daily/Calendar";
import { FileTree } from "../filetree";
import { BacklinksPanel } from "./BacklinksPanel";
import { SearchPanel } from "./SearchPanel";
import { TagsPanel } from "./TagsPanel";
import "./panels.css";

const TABS: { id: LeftPanel; label: string; Icon: typeof Search }[] = [
  { id: "files", label: "Files", Icon: FolderTree },
  { id: "search", label: "Search", Icon: Search },
  { id: "tags", label: "Tags", Icon: Hash },
];

export function LeftSidebar() {
  const graphEnabled = useFeatureEnabled("graph");
  const timeEnabled = useFeatureEnabled("timeTracking");
  const vault = useAppStore((s) => s.vault);
  const panel = useAppStore((s) => s.leftPanel);
  const setPanel = useAppStore((s) => s.setLeftPanel);
  return (
    <aside className="sidebar" aria-label="Navigation">
      <header className="sidebar-header" title={vault?.root}>
        <span className="sidebar-vault">{vault?.name}</span>
        <button
          className="sidebar-settings"
          aria-label="Settings"
          title="Settings (Ctrl+,)"
          onClick={() => useUi.getState().open({ kind: "settings" })}
        >
          <SettingsIcon size={15} />
        </button>
      </header>
      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar views">
        {graphEnabled && (
          <button
            className="sidebar-graph"
            aria-label="Graph view"
            title="Graph view (Ctrl+G)"
            onClick={() => useAppStore.getState().setMainView("graph")}
          >
            <Network size={15} />
          </button>
        )}
        <button
          className="sidebar-graph"
          aria-label="Tasks"
          title="Tasks (Ctrl+Shift+T)"
          onClick={() => useAppStore.getState().setMainView("tasks")}
        >
          <ListChecks size={15} />
        </button>
        {timeEnabled && (
          <button
            className="sidebar-graph"
            aria-label="Time report"
            title="Time report"
            onClick={() => useAppStore.getState().setMainView("time")}
          >
            <Clock size={15} />
          </button>
        )}
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
      <div className="sidebar-body" role="tabpanel">
        {panel === "files" && <FileTree />}
        {panel === "search" && <SearchPanel />}
        {panel === "tags" && <TagsPanel />}
      </div>
    </aside>
  );
}

export function RightSidebar() {
  const graphEnabled = useFeatureEnabled("graph");
  const activePath = useAppStore((s) => s.activePath);
  const [graphOpen, setGraphOpen] = useState(false);
  return (
    <aside className="sidebar sidebar-right" aria-label="Links">
      <Calendar />
      {graphEnabled && activePath && (
        <div>
          <button aria-expanded={graphOpen} onClick={() => setGraphOpen(!graphOpen)}>
            {graphOpen ? "Hide local graph" : "Show local graph"}
          </button>
          {graphOpen && (
            <Suspense fallback={<span className="muted">Loading graph…</span>}>
              <FeatureBoundary name="Local graph" onDismiss={() => setGraphOpen(false)}>
                <LocalGraph />
              </FeatureBoundary>
            </Suspense>
          )}
        </div>
      )}
      <div className="sidebar-body">
        <BacklinksPanel />
      </div>
    </aside>
  );
}
