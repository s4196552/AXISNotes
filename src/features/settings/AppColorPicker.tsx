import { TriangleAlert } from "lucide-react";
import {
  APP_COLOR_PRESETS,
  autoText,
  contrast,
  matchingPreset,
  MIN_CONTRAST,
  normalHex,
} from "../../app/appColors";
import { type AppColors, NO_APP_COLORS } from "../../app/config";

/** The theme's own value of a colour token, if it's a plain hex colour. */
function themeColor(token: "--bg" | "--bg-sidebar" | "--fg"): string {
  return normalHex(getComputedStyle(document.documentElement).getPropertyValue(token));
}

/** One colour: a picker, what it is now ("Theme", "Auto" or the hex) and a reset. */
function ColorInput(p: {
  label: string;
  value: string;
  /** Shown in the picker while unset: what the app is using instead. */
  fallback: string;
  unsetLabel: string;
  onChange(value: string): void;
}) {
  const value = normalHex(p.value);
  return (
    <div className="app-color-input">
      <span className="app-color-label">{p.label}</span>
      <input
        type="color"
        aria-label={p.label}
        value={value || p.fallback || "#808080"}
        onChange={(e) => p.onChange(e.target.value)}
      />
      <span className="muted app-color-value">{value || p.unsetLabel}</span>
      {value && (
        <button type="button" onClick={() => p.onChange("")}>
          <span aria-hidden="true">Reset</span>
          <span className="visually-hidden">Reset {p.label.toLowerCase()}</span>
        </button>
      )}
    </div>
  );
}

/** A warning when a chosen text colour is hard to read on its background. */
function ContrastWarning(p: { surface: string; bg: string; fg: string }) {
  const bg = normalHex(p.bg);
  const fg = normalHex(p.fg);
  if (!bg || !fg) return null;
  const ratio = contrast(bg, fg);
  if (ratio >= MIN_CONTRAST) return null;
  return (
    <p className="app-colors-warning" role="status">
      <TriangleAlert size={14} aria-hidden="true" />
      {p.surface} text is low contrast ({ratio.toFixed(1)}:1) and may be hard to read. 4.5:1 or more
      is easier.
    </p>
  );
}

/**
 * Settings → Appearance → App colours: presets, the four colours, and a reset. Sidebars
 * are both side panels and the status bar; Main is the note area with its tabs.
 */
export function AppColorPicker(p: { value: AppColors; onChange(colors: AppColors): void }) {
  const c = { ...NO_APP_COLORS, ...p.value };
  const set = (patch: Partial<AppColors>) => p.onChange({ ...c, ...patch });
  const current = matchingPreset(c);
  const any = Object.values(c).some((v) => normalHex(v));
  // What the app uses where nothing is chosen, so a picker opens on the colour in use.
  const sideBg = normalHex(c.sidebarBg) || themeColor("--bg-sidebar");
  const mainBg = normalHex(c.mainBg) || themeColor("--bg");
  // Text left unset follows a chosen background, else it's the theme's.
  const textFor = (chosenBg: string) => (chosenBg ? autoText(chosenBg) : themeColor("--fg"));
  return (
    <div className="app-colors">
      <div className="app-color-grid" role="radiogroup" aria-label="App colour presets">
        {APP_COLOR_PRESETS.map((preset) => (
          <label key={preset.id} className="app-color-tile">
            <input
              type="radio"
              name="axis-app-colors"
              checked={current?.id === preset.id}
              onChange={() => p.onChange({ ...preset.colors })}
              aria-label={preset.label}
            />
            <span className="app-color-swatch" aria-hidden="true">
              <span style={{ background: preset.colors.sidebarBg, color: preset.colors.sidebarFg }}>
                Aa
              </span>
              <span style={{ background: preset.colors.mainBg, color: preset.colors.mainFg }}>
                Aa
              </span>
            </span>
            <span className="app-color-name">{preset.label}</span>
          </label>
        ))}
      </div>
      <div className="app-color-inputs">
        <ColorInput
          label="Sidebar background"
          value={c.sidebarBg}
          fallback={sideBg}
          unsetLabel="Theme"
          onChange={(sidebarBg) => set({ sidebarBg })}
        />
        <ColorInput
          label="Sidebar text"
          value={c.sidebarFg}
          fallback={textFor(normalHex(c.sidebarBg))}
          unsetLabel={normalHex(c.sidebarBg) ? "Auto" : "Theme"}
          onChange={(sidebarFg) => set({ sidebarFg })}
        />
        <ColorInput
          label="Main background"
          value={c.mainBg}
          fallback={mainBg}
          unsetLabel="Theme"
          onChange={(mainBg) => set({ mainBg })}
        />
        <ColorInput
          label="Main text"
          value={c.mainFg}
          fallback={textFor(normalHex(c.mainBg))}
          unsetLabel={normalHex(c.mainBg) ? "Auto" : "Theme"}
          onChange={(mainFg) => set({ mainFg })}
        />
      </div>
      <ContrastWarning surface="Sidebar" bg={sideBg} fg={c.sidebarFg} />
      <ContrastWarning surface="Main" bg={mainBg} fg={c.mainFg} />
      <button type="button" disabled={!any} onClick={() => p.onChange({ ...NO_APP_COLORS })}>
        Use theme colours
      </button>
    </div>
  );
}
