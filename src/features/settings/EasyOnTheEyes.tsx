import type { AxisConfig } from "../../app/config";
import { NIGHT_LIGHT } from "../../app/appearance";
import { Field, type SectionProps } from "./parts";

/** Settings → Appearance → Theme & layout: Night light and the E-ink theme. */
export function EasyOnTheEyes({ config, set }: SectionProps) {
  const a = config.appearance;
  const setA = (patch: Partial<AxisConfig["appearance"]>) =>
    set((c) => ({ ...c, appearance: { ...c.appearance, ...patch } }));
  const eink = config.theme === "axis:eink";
  return (
    <section aria-label="Easy on the eyes">
      <h3>Easy on the eyes</h3>
      <Field
        label="Night light"
        hint="A warm filter over the whole window that cuts blue light, with any theme."
      >
        <input
          type="checkbox"
          aria-label="Night light"
          checked={a.nightLight}
          onChange={(e) => setA({ nightLight: e.target.checked })}
        />
      </Field>
      {a.nightLight && (
        <Field label="Warmth" hint="How strong the night light is.">
          <span className="range-control">
            <input
              type="range"
              aria-label="Night light warmth"
              min={NIGHT_LIGHT.min}
              max={NIGHT_LIGHT.max}
              step={NIGHT_LIGHT.step}
              value={a.nightLightStrength}
              onChange={(e) => setA({ nightLightStrength: Number(e.target.value) })}
            />
            <span className="muted">{a.nightLightStrength}%</span>
          </span>
        </Field>
      )}
      <Field
        label="E-ink"
        hint="The E-ink theme: black on white, greys only (pictures too) and no animations, like an e-reader. Turning it off goes back to Match system."
      >
        <input
          type="checkbox"
          aria-label="E-ink"
          checked={eink}
          onChange={(e) => set((c) => ({ ...c, theme: e.target.checked ? "axis:eink" : "system" }))}
        />
      </Field>
    </section>
  );
}
