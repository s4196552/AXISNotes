import type { ReactNode } from "react";
import { BUILTIN_THEMES, type BuiltinTheme, THEME_INFO } from "../../app/appearance";
import "./themePicker.css";

// The theme choice as a grid of tiles. Each tile is a miniature of the app drawn with
// that theme's own tokens (`data-theme-preview`), so it looks right whatever theme is on.
// Native radio buttons give arrow-key navigation and screen-reader semantics.

/** A tiny app: sidebar with a selected row, a note with a title, text and a tag. */
function Miniature({ theme }: { theme: Exclude<BuiltinTheme, "system"> }) {
  return (
    <span className="tp" data-theme-preview={theme} aria-hidden="true">
      <span className="tp-shell">
        <span className="tp-side">
          <span className="tp-line tp-w60" />
          <span className="tp-line tp-active" />
          <span className="tp-line tp-w50" />
        </span>
        <span className="tp-main">
          <span className="tp-title" />
          <span className="tp-line" />
          <span className="tp-line tp-w80" />
          <span className="tp-row">
            <span className="tp-pill" />
            <span className="tp-line tp-w40" />
          </span>
        </span>
      </span>
    </span>
  );
}

function Preview({ theme }: { theme: BuiltinTheme }) {
  if (theme !== "system") return <Miniature theme={theme} />;
  // "Match system": light and dark side by side.
  return (
    <span className="tp-split" aria-hidden="true">
      <Miniature theme="light" />
      <Miniature theme="dark" />
    </span>
  );
}

export function ThemePicker(p: {
  value: string;
  /** User themes (CSS files in .axisnotes/themes). */
  custom: string[];
  onChange(theme: string): void;
}) {
  const tile = (value: string, label: string, note: string, preview: ReactNode) => (
    <label key={value} className="theme-tile" data-theme-id={value}>
      <input
        type="radio"
        name="axis-theme"
        value={value}
        checked={p.value === value}
        onChange={() => p.onChange(value)}
        aria-label={label}
        aria-describedby={`theme-note-${value}`}
      />
      {preview}
      <span className="theme-tile-text">
        <span className="theme-tile-name">{label}</span>
        <span className="theme-tile-note muted" id={`theme-note-${value}`}>
          {note}
        </span>
      </span>
    </label>
  );
  return (
    <div className="settings-field settings-field-wide">
      <div>
        <div className="settings-label" id="theme-label">
          Theme
        </div>
        <div className="settings-hint muted">
          Custom themes are CSS files in .axisnotes/themes that override the color variables.
        </div>
      </div>
      <div className="theme-grid" role="radiogroup" aria-labelledby="theme-label">
        {BUILTIN_THEMES.map((t) =>
          tile(t, THEME_INFO[t].label, THEME_INFO[t].note, <Preview theme={t} />),
        )}
        {p.custom.map((t) =>
          tile(
            t,
            t,
            "Custom theme",
            <span className="tp tp-custom" aria-hidden="true">
              Aa
            </span>,
          ),
        )}
      </div>
    </div>
  );
}
