import type { CSSProperties } from "react";
import { RotateCcw } from "lucide-react";
import { MAIN_TEXT_SUGGESTED, TEXT_COLOR_KINDS } from "../../app/appearance";
import { type TextColor, type TextColorKind, type TextColors, isHexColor } from "../../app/config";

// Settings → Appearance → Typography: optional colors for main text (notes and the
// interface, T-277) and for bold, italic, strikethrough and math text in notes and AI
// answers. Each is off by default; on, it uses the user's color for light and for dark
// themes, or the theme's suggestion (a neutral for main text). The Markdown in the file
// never changes.

/** What a color box starts at before a color is picked (the default theme's suggestion). */
const SUGGESTED: Record<TextColorKind, { light: string; dark: string }> = {
  main: MAIN_TEXT_SUGGESTED,
  bold: { light: "#4f5bd5", dark: "#8a93ff" },
  italic: { light: "#0f766e", dark: "#5eead4" },
  strike: { light: "#6a6f77", dark: "#8d9199" },
  math: { light: "#9333ea", dark: "#d8b4fe" },
};

const SAMPLE_STYLE: Record<TextColorKind, CSSProperties> = {
  main: {},
  bold: { fontWeight: 700 },
  italic: { fontStyle: "italic" },
  strike: { textDecoration: "line-through" },
  math: { fontFamily: "KaTeX_Main, 'Times New Roman', serif", fontStyle: "italic" },
};

const MODES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const;

export function TextColorSettings(p: { value: TextColors; onChange(next: TextColors): void }) {
  const setKind = (id: TextColorKind, patch: Partial<TextColor>) =>
    p.onChange({ ...p.value, [id]: { ...p.value[id], ...patch } });
  return (
    <div className="text-color-list">
      {TEXT_COLOR_KINDS.map((k) => {
        const c = p.value[k.id];
        const custom = isHexColor(c.light) || isHexColor(c.dark);
        return (
          <div key={k.id} className="text-color-row" data-on={c.on || undefined}>
            <label className="text-color-toggle">
              <input
                type="checkbox"
                aria-label={
                  k.id === "main" ? "Color main text" : `Color ${k.label.toLowerCase()} text`
                }
                checked={c.on}
                onChange={(e) => setKind(k.id, { on: e.target.checked })}
              />
              <span style={SAMPLE_STYLE[k.id]}>{k.label}</span>
            </label>
            {MODES.map((m) => {
              const own = c[m.id];
              const shown = isHexColor(own) ? own : SUGGESTED[k.id][m.id];
              return (
                <label
                  key={m.id}
                  className="text-color-chip"
                  data-mode={m.id}
                  title={
                    isHexColor(own)
                      ? `${k.label} in ${m.id} themes: ${own}`
                      : k.id === "main"
                        ? `${k.label} in ${m.id} themes: ${shown}`
                        : `${k.label} in ${m.id} themes: the theme's color`
                  }
                >
                  <span
                    className="text-color-chip-sample"
                    style={{
                      ...SAMPLE_STYLE[k.id],
                      color: c.on
                        ? isHexColor(own)
                          ? own
                          : k.id === "main"
                            ? shown
                            : `var(${k.css}-theme)`
                        : undefined,
                    }}
                  >
                    {m.label}
                  </span>
                  <input
                    type="color"
                    aria-label={`${k.label} color in ${m.id} themes`}
                    value={shown}
                    disabled={!c.on}
                    onChange={(e) => setKind(k.id, { [m.id]: e.target.value })}
                  />
                </label>
              );
            })}
            <button
              type="button"
              aria-label={`Reset ${k.label.toLowerCase()} color`}
              title="Back to the theme's colors"
              className="text-color-reset"
              disabled={!custom}
              onClick={() => setKind(k.id, { light: "", dark: "" })}
            >
              <RotateCcw size={13} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
