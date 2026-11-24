import { useState } from "react";
import { Check, Pencil, Trash2, Undo2 } from "lucide-react";
import { fontStack, HEADING_COLORS, isBuiltinTheme, THEME_INFO } from "../../app/appearance";
import { normalHex } from "../../app/appColors";
import {
  activeStyle,
  applyStyle,
  BUILTIN_STYLES,
  captureStyle,
  fullLook,
  type Style,
} from "../../app/styles";
import { Field, type SectionProps } from "./parts";

// Settings → Appearance → Styles (T-277): a whole look (theme, fonts, typography, heading
// colors, text colors and app colors) in one click, and the user's own saved looks.

/** Roughly how a theme looks with no colors of its own, for a card's preview. */
const THEME_SWATCH: Record<"light" | "dark", { bg: string; fg: string }> = {
  light: { bg: "#ffffff", fg: "#1f1f1f" },
  dark: { bg: "#1e1e1e", fg: "#d4d4d4" },
};
const THEME_OVERRIDES: Record<string, { bg: string; fg: string }> = {
  "axis:darker": { bg: "#0b0b0c", fg: "#d4d4d4" },
  "axis:hc-dark": { bg: "#000000", fg: "#ffffff" },
  "axis:hc-light": { bg: "#ffffff", fg: "#000000" },
  "axis:eink": { bg: "#f4f3ee", fg: "#111111" },
};

function preview(style: Style) {
  const look = fullLook(style);
  const mode =
    isBuiltinTheme(style.theme) && THEME_INFO[style.theme].mode === "dark" ? "dark" : "light";
  const base = THEME_OVERRIDES[style.theme] ?? THEME_SWATCH[mode];
  const bg = normalHex(look.appColors.mainBg) || base.bg;
  const main = look.textColors.main;
  const ownText = main?.on ? normalHex(mode === "dark" ? main.dark : main.light) : "";
  const fg = ownText || normalHex(look.appColors.mainFg) || base.fg;
  const shades = (HEADING_COLORS[look.headingColors] ?? HEADING_COLORS.theme).shades;
  const headings = shades
    ? shades.slice(0, 3).map(([light, dark]) => (mode === "dark" ? dark : light))
    : ["var(--accent)", "var(--accent)", "var(--accent)"];
  return { bg, fg, headings, font: fontStack(look.noteFont, "var(--font-ui)") };
}

function StyleCard(p: { style: Style; note?: string; active: boolean; onApply(): void }) {
  const v = preview(p.style);
  return (
    <button
      type="button"
      className="style-card"
      aria-pressed={p.active}
      aria-label={`${p.style.name} style`}
      onClick={p.onApply}
    >
      <span
        className="style-card-preview"
        aria-hidden="true"
        style={{ background: v.bg, color: v.fg, fontFamily: v.font }}
      >
        <span className="style-card-heading" style={{ color: v.headings[0] }}>
          Aa
        </span>
        <span className="style-card-dots">
          {v.headings.map((c, i) => (
            <span key={i} style={{ background: c }} />
          ))}
        </span>
        <span className="style-card-text">The quick brown fox</span>
      </span>
      <span className="style-card-name">
        {p.style.name}
        {p.active && <Check size={13} aria-hidden="true" />}
      </span>
      {p.note && <span className="style-card-note muted">{p.note}</span>}
    </button>
  );
}

export function StylesSettings({ config, set }: SectionProps) {
  const own = config.styles;
  const current = activeStyle(config, [...BUILTIN_STYLES, ...own]);
  // The look before the last Style was applied, for Undo (this visit to Settings only).
  const [before, setBefore] = useState<Style | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [status, setStatus] = useState("");

  const apply = (style: Style) => {
    setBefore(captureStyle(config, "Before"));
    set((c) => applyStyle(c, style));
    setStatus(`Applied ${style.name}.`);
  };
  const undo = () => {
    if (!before) return;
    set((c) => applyStyle(c, before));
    setBefore(null);
    setStatus("Went back to the look before.");
  };
  const taken = (n: string, except?: string) =>
    own.find((s) => s.name.toLowerCase() === n.trim().toLowerCase() && s.name !== except);

  const save = () => {
    const n = name.trim();
    if (!n) return;
    const existing = taken(n);
    if (existing && !window.confirm(`Replace your style “${existing.name}” with the current look?`))
      return;
    const style = captureStyle(config, n);
    set((c) => ({
      ...c,
      styles: existing
        ? c.styles.map((s) => (s.name === existing.name ? style : s))
        : [...c.styles, style],
    }));
    setSaving(false);
    setName("");
    setStatus(`Saved ${n}.`);
  };
  const rename = (from: string) => {
    const n = newName.trim();
    if (!n || n === from) return setRenaming(null);
    if (taken(n, from)) {
      setStatus(`You already have a style called ${n}.`);
      return;
    }
    set((c) => ({
      ...c,
      styles: c.styles.map((s) => (s.name === from ? { ...s, name: n } : s)),
    }));
    setRenaming(null);
    setStatus(`Renamed ${from} to ${n}.`);
  };
  const remove = (style: Style) => {
    if (!window.confirm(`Delete your style “${style.name}”? Your current look doesn't change.`))
      return;
    set((c) => ({ ...c, styles: c.styles.filter((s) => s.name !== style.name) }));
    setStatus(`Deleted ${style.name}.`);
  };

  return (
    <>
      <Field
        label="Styles"
        hint="A whole look in one click: the theme, fonts, text size and spacing, heading colors, text colors and app colors. You can still change any of them afterwards."
      >
        <div className="style-grid">
          {BUILTIN_STYLES.map((s) => (
            <StyleCard
              key={s.id}
              style={s}
              note={s.note}
              active={current === s}
              onApply={() => apply(s)}
            />
          ))}
        </div>
        {before && (
          <button type="button" className="style-undo" onClick={undo}>
            <Undo2 size={13} aria-hidden="true" /> Undo
          </button>
        )}
      </Field>
      <Field
        label="Your styles"
        hint="Save how AXISNotes looks now (theme, fonts, typography and colors) to come back to it. Styles are kept with this vault."
      >
        <div className="style-own">
          {own.length > 0 && (
            <div className="style-grid">
              {own.map((s) => (
                <div key={s.name} className="style-own-item">
                  <StyleCard style={s} active={current === s} onApply={() => apply(s)} />
                  {renaming === s.name ? (
                    <form
                      className="style-name-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        rename(s.name);
                      }}
                    >
                      <input
                        aria-label={`New name for ${s.name}`}
                        value={newName}
                        autoFocus
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                      />
                      <button type="submit">Rename</button>
                    </form>
                  ) : (
                    <span className="style-own-actions">
                      <button
                        type="button"
                        aria-label={`Rename ${s.name}`}
                        title="Rename"
                        onClick={() => {
                          setRenaming(s.name);
                          setNewName(s.name);
                        }}
                      >
                        <Pencil size={13} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${s.name}`}
                        title="Delete"
                        onClick={() => remove(s)}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {saving ? (
            <form
              className="style-name-form"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <input
                aria-label="Style name"
                placeholder="Name"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setSaving(false)}
              />
              <button type="submit" disabled={!name.trim()}>
                Save
              </button>
              <button type="button" onClick={() => setSaving(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" onClick={() => setSaving(true)}>
              Save current look as a style…
            </button>
          )}
          {status && (
            <p className="settings-hint muted" role="status">
              {status}
            </p>
          )}
        </div>
      </Field>
    </>
  );
}
