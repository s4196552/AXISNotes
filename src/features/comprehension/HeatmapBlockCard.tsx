import { createRoot, type Root } from "react-dom/client";
import { Code } from "lucide-react";
import { HeatmapCard } from "./HeatmapCard";
import type { Topic, UnitMode } from "./model";

// The card a ```heatmap block shows (loaded only when a note has one; see heatmapBlock.ts).

export interface BlockCardProps {
  spec: Omit<Topic, "id">;
  readOnly: boolean;
  onEditSource(): void;
  onUnitChange(unit: UnitMode): void;
}

export function mountBlockCard(host: HTMLElement, p: BlockCardProps): Root {
  const root = createRoot(host);
  root.render(
    p.spec.sources.length ? (
      <HeatmapCard
        topic={p.spec}
        onUnitChange={p.readOnly ? undefined : p.onUnitChange}
        actions={
          <button
            type="button"
            aria-label="Edit heatmap source"
            title="Edit the block's source"
            onClick={p.onEditSource}
          >
            <Code size={14} />
          </button>
        }
      />
    ) : (
      <div className="cm-heatmap-error" role="note">
        This heatmap has no sources yet. Add <code>source: Folder/Note.md</code> lines, or choose
        “Insert comprehension heatmap in this note” in the command palette.{" "}
        <button type="button" onClick={p.onEditSource}>
          Edit source
        </button>
      </div>
    ),
  );
  return root;
}
