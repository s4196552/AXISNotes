import type { CSSProperties } from "react";
import { HEADING_COLORS, headingColorVars } from "../../app/appearance";
import type { HeadingColors } from "../../app/config";

// The heading colour preset as a row of tiles, each showing H1–H3 in its colours (drawn
// with the same --heading-N variables as the editor). Native radio buttons, like the
// theme and fold arrow tiles.

/** "Theme default" previews in the theme's own heading colour. */
const THEME_VARS = Object.fromEntries(
  [1, 2, 3, 4, 5, 6].map((n) => [`--heading-${n}`, "var(--heading)"]),
);

export function HeadingColorPicker(p: {
  value: HeadingColors;
  onChange(preset: HeadingColors): void;
}) {
  return (
    <div className="heading-color-grid" role="radiogroup" aria-label="Heading colours">
      {(Object.keys(HEADING_COLORS) as HeadingColors[]).map((id) => (
        <label
          key={id}
          className="heading-color-tile"
          style={(headingColorVars(id) ?? THEME_VARS) as CSSProperties}
        >
          <input
            type="radio"
            name="axis-heading-colors"
            value={id}
            checked={p.value === id}
            onChange={() => p.onChange(id)}
            aria-label={HEADING_COLORS[id].label}
          />
          <span className="heading-color-sample" aria-hidden="true">
            <span style={{ color: "var(--heading-1)" }}>H1</span>
            <span style={{ color: "var(--heading-2)" }}>H2</span>
            <span style={{ color: "var(--heading-3)" }}>H3</span>
          </span>
          <span className="heading-color-name">{HEADING_COLORS[id].label}</span>
        </label>
      ))}
    </div>
  );
}
