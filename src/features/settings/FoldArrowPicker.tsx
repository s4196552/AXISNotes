import type { CSSProperties } from "react";
import { FOLD_ARROWS, foldArrowVars } from "../../app/appearance";
import type { FoldArrow } from "../../app/config";

// The fold arrow choice as a row of tiles, each showing that style closed and open, drawn
// with the same CSS variables as the editor's arrows. Native radio buttons give arrow-key
// navigation and screen-reader semantics, like the theme tiles.

export function FoldArrowPicker(p: { value: FoldArrow; onChange(style: FoldArrow): void }) {
  return (
    <div className="fold-arrow-grid" role="radiogroup" aria-label="Fold arrows">
      {(Object.keys(FOLD_ARROWS) as FoldArrow[]).map((id) => (
        <label
          key={id}
          className="fold-arrow-tile"
          style={foldArrowVars(id) as CSSProperties}
          title={FOLD_ARROWS[id].label}
        >
          <input
            type="radio"
            name="axis-fold-arrow"
            value={id}
            checked={p.value === id}
            onChange={() => p.onChange(id)}
            aria-label={FOLD_ARROWS[id].label}
          />
          <span className="fold-arrow-sample" aria-hidden="true">
            <span className="fold-arrow-icon" />
            <span className="fold-arrow-icon fold-arrow-open" />
          </span>
          <span className="fold-arrow-name">{FOLD_ARROWS[id].label}</span>
        </label>
      ))}
    </div>
  );
}
