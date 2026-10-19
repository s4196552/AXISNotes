import { type EntryColors, useConfig } from "../../app/config";
import { ROW_BACKGROUNDS, ROW_TEXT_COLORS, rowColorProps, rowColors } from "./rowColorsModel";
import "../icons/icons.css";
import "./filetree.css";

// "Change colours…" for a file-tree row: a background and a text colour, each a preset
// swatch, any colour, or the theme default. Every pick is saved at once, so the row in
// the tree updates while the dialog is open.

function Swatches(props: {
  label: string;
  presets: string[];
  value: string;
  onChange(v: string): void;
}) {
  const custom = props.value && !props.presets.includes(props.value) ? props.value : "";
  return (
    <div className="row-colors-group">
      <div className="row-colors-label">{props.label}</div>
      <div className="icon-colors" role="radiogroup" aria-label={props.label}>
        {props.presets.map((c) => (
          <button
            key={c || "none"}
            role="radio"
            aria-checked={props.value === c}
            aria-label={c ? `${props.label} ${c}` : `Default ${props.label.toLowerCase()}`}
            title={c ? c : "Theme default"}
            className={`icon-swatch${c ? "" : " row-swatch-default"}`}
            style={c ? { background: c } : undefined}
            onClick={() => props.onChange(c)}
          />
        ))}
        <label
          className={`icon-swatch icon-custom-color${custom ? " chosen" : ""}`}
          title="Any colour"
          style={custom ? { background: custom } : undefined}
        >
          <input
            type="color"
            aria-label={`Custom ${props.label.toLowerCase()}`}
            // The picker only takes #rrggbb; a translucent preset opens at its base hue.
            value={custom ? custom.slice(0, 7) : "#888888"}
            onChange={(e) => props.onChange(e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

export function RowColorsDialog({ path, onClose }: { path: string; onClose(): void }) {
  const colors = rowColors(useConfig((s) => s.config.entryColors[path])) ?? {};
  const update = useConfig((s) => s.update);
  const name = path.split("/").pop()!.replace(/\.md$/i, "");

  const save = (next: EntryColors) =>
    void update((c) => {
      const entryColors = { ...c.entryColors };
      const clean: EntryColors = {};
      if (next.background) clean.background = next.background;
      if (next.text) clean.text = next.text;
      if (clean.background || clean.text) entryColors[path] = clean;
      else delete entryColors[path];
      return { ...c, entryColors };
    });

  const preview = rowColorProps(rowColors(colors));
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal row-colors"
        role="dialog"
        aria-label={`Colours for ${name}`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="row-colors-title">Colours for “{name}”</div>
        <div
          className={`filetree-row row-colors-preview ${preview.className}`}
          style={preview.style}
          aria-hidden="true"
        >
          <span className="filetree-name">{name}</span>
        </div>
        <Swatches
          label="Background"
          presets={ROW_BACKGROUNDS}
          value={colors.background ?? ""}
          onChange={(background) => save({ ...colors, background })}
        />
        <Swatches
          label="Text"
          presets={ROW_TEXT_COLORS}
          value={colors.text ?? ""}
          onChange={(text) => save({ ...colors, text })}
        />
        <div className="row-colors-actions">
          <button onClick={() => save({})} disabled={!colors.background && !colors.text}>
            Reset
          </button>
          <button className="primary" autoFocus onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
