import type { ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { useAppStore } from "../../app/store";
import { noteName } from "../../lib/markdown";
import "./viewHeader.css";

interface ViewHeaderProps {
  icon: LucideIcon;
  title: string;
  /** Filters and counts, after the title. */
  children?: ReactNode;
  /** Buttons at the right end. */
  actions?: ReactNode;
}

/**
 * The top bar of a view that opens in a tab (Graph, Tasks, Time): its icon and name, its
 * filters, and its actions. The tab's own × closes it; when the tab came from a note,
 * a button goes back to that note.
 */
export function ViewHeader({ icon: Icon, title, children, actions }: ViewHeaderProps) {
  const notePath = useAppStore((s) => s.activePath);
  const name = notePath ? noteName(notePath.slice(notePath.lastIndexOf("/") + 1)) : null;
  return (
    <header className="graph-toolbar view-header">
      <span className="view-header-title">
        <span className="view-header-icon" aria-hidden="true">
          <Icon size={15} />
        </span>
        <h1>{title}</h1>
      </span>
      {children}
      <div className="view-header-actions">
        {actions}
        {name && (
          <button
            className="view-back"
            title={`Back to ${name}`}
            onClick={() => useAppStore.getState().setMainView("note")}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            <span>Back to {name}</span>
          </button>
        )}
      </div>
    </header>
  );
}
