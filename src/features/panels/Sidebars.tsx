import { FolderTree, Hash, Search } from "lucide-react";
import { type LeftPanel, useAppStore } from "../../app/store";
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
  const vault = useAppStore((s) => s.vault);
  const panel = useAppStore((s) => s.leftPanel);
  const setPanel = useAppStore((s) => s.setLeftPanel);
  return (
    <aside className="sidebar" aria-label="Navigation">
      <header className="sidebar-header" title={vault?.root}>
        {vault?.name}
      </header>
      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar views">
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
  return (
    <aside className="sidebar sidebar-right" aria-label="Links">
      <div className="sidebar-body">
        <BacklinksPanel />
      </div>
    </aside>
  );
}
