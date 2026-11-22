import { type CursorStyle, DEFAULT_CONFIG } from "../../app/config";
import { CURSOR_WIDTH } from "../../app/appearance";
import { Field, ResetDefaults, type SectionProps } from "./parts";

const SHAPES: { id: CursorStyle["shape"]; label: string }[] = [
  { id: "bar", label: "Bar" },
  { id: "block", label: "Block" },
  { id: "underline", label: "Underline" },
];

/** Settings → Appearance → Cursor: the text cursor's shape, thickness, colour and blinking. */
export function CursorSettings({ config, set }: SectionProps) {
  const c = config.appearance.cursor;
  const setC = (patch: Partial<CursorStyle>) =>
    set((cfg) => ({
      ...cfg,
      appearance: { ...cfg.appearance, cursor: { ...cfg.appearance.cursor, ...patch } },
    }));
  return (
    <>
      <Field label="Shape" hint="How the cursor in your notes looks.">
        <div role="radiogroup" aria-label="Cursor shape" className="settings-checks">
          {SHAPES.map((s) => (
            <label key={s.id}>
              <input
                type="radio"
                name="cursor-shape"
                checked={c.shape === s.id}
                onChange={() => setC({ shape: s.id })}
              />
              {s.label}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Thickness" hint="How thick the bar (or underline) is.">
        <span className="range-control">
          <input
            type="range"
            aria-label="Cursor thickness"
            min={CURSOR_WIDTH.min}
            max={CURSOR_WIDTH.max}
            step={1}
            value={c.width}
            disabled={c.shape === "block"}
            onChange={(e) => setC({ width: Number(e.target.value) })}
          />
          <span className="muted">{c.width === 1 ? "Thin" : `${c.width} px`}</span>
        </span>
      </Field>
      <Field label="Color" hint="The cursor in notes and in every text box.">
        <span className="range-control">
          <input
            type="color"
            aria-label="Cursor color"
            value={c.color || "#4f5bd5"}
            onChange={(e) => setC({ color: e.target.value })}
          />
          <span className="muted">{c.color ? c.color : "Theme accent"}</span>
          {c.color && <button onClick={() => setC({ color: "" })}>Use theme accent</button>}
        </span>
      </Field>
      <Field label="Blink" hint="Turn off for a steady cursor.">
        <input
          type="checkbox"
          aria-label="Cursor blinks"
          checked={c.blink}
          onChange={(e) => setC({ blink: e.target.checked })}
        />
      </Field>
      <Field label="Try it">
        <input
          aria-label="Cursor preview"
          className="cursor-preview"
          defaultValue="Click here to see your cursor"
        />
      </Field>
      <ResetDefaults
        what="cursor"
        changed={(Object.keys(c) as (keyof CursorStyle)[]).some(
          (k) => c[k] !== DEFAULT_CONFIG.appearance.cursor[k],
        )}
        onReset={() => setC(DEFAULT_CONFIG.appearance.cursor)}
      />
    </>
  );
}
