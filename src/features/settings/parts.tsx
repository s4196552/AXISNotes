import type { ReactNode } from "react";
import type { AxisConfig } from "../../app/config";
import { fontStack } from "../../app/appearance";

// Building blocks shared by the Settings pages.

export function Field(p: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-field">
      <div>
        <div className="settings-label">{p.label}</div>
        {p.hint && <div className="settings-hint muted">{p.hint}</div>}
      </div>
      <div className="settings-control">{p.children}</div>
    </div>
  );
}

export interface SectionProps {
  config: AxisConfig;
  set(fn: (c: AxisConfig) => AxisConfig): void;
}

/**
 * A font picker: the default, the vault's imported fonts, then every installed family,
 * each shown in its own font.
 */
export function FontSelect(p: {
  label: string;
  fonts: string[];
  /** Fonts imported into the vault (Typography → Import a font). */
  vaultFonts?: string[];
  value: string;
  defaultLabel: string;
  onChange(font: string): void;
}) {
  const vault = p.vaultFonts ?? [];
  // A font chosen on another computer stays listed even if it isn't installed here.
  const missing = p.value && !p.fonts.includes(p.value) && !vault.includes(p.value);
  const option = (f: string) => (
    <option key={f} value={f} style={{ fontFamily: fontStack(f, "inherit") }}>
      {f}
    </option>
  );
  return (
    <select aria-label={p.label} value={p.value} onChange={(e) => p.onChange(e.target.value)}>
      <option value="">{p.defaultLabel}</option>
      {missing && <option value={p.value}>{p.value} (not installed)</option>}
      {vault.length > 0 ? (
        <>
          <optgroup label="In this vault">{vault.map(option)}</optgroup>
          <optgroup label="Installed">{p.fonts.map(option)}</optgroup>
        </>
      ) : (
        p.fonts.map(option)
      )}
    </select>
  );
}
