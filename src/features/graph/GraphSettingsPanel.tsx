import { Plus, RotateCcw, X } from "lucide-react";
import {
  DEFAULT_DISPLAY,
  DEFAULT_FORCES,
  GROUP_COLORS,
  RANGES,
  type GraphSettings,
} from "./graphSettings";

// The graph's settings panel, laid out like Obsidian's: Filters, Groups, Display and
// Forces, each a collapsible section.

type Update = (change: (s: GraphSettings) => GraphSettings) => void;

function Slider(props: {
  label: string;
  range: keyof typeof RANGES;
  value: number;
  onChange(v: number): void;
}) {
  const [min, max, step] = RANGES[props.range];
  return (
    <label className="graph-slider">
      <span>{props.label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="graph-toggle">
      <span>{props.label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}

export function GraphSettingsPanel(props: {
  settings: GraphSettings;
  update: Update;
  onAnimate(): void;
  onClose(): void;
}) {
  const { settings: s, update } = props;
  const display = (patch: Partial<GraphSettings["display"]>) =>
    update((v) => ({ ...v, display: { ...v.display, ...patch } }));
  const forces = (patch: Partial<GraphSettings["forces"]>) =>
    update((v) => ({ ...v, forces: { ...v.forces, ...patch } }));
  const setGroups = (change: (g: GraphSettings["groups"]) => GraphSettings["groups"]) =>
    update((v) => ({ ...v, groups: change(v.groups) }));

  return (
    <aside className="graph-settings" aria-label="Graph settings">
      <header>
        <button type="button" className="graph-animate" onClick={props.onAnimate}>
          Animate
        </button>
        <button type="button" aria-label="Close graph settings" onClick={props.onClose}>
          <X size={14} />
        </button>
      </header>

      <details open>
        <summary>Filters</summary>
        <Toggle
          label="Orphans"
          checked={s.showOrphans}
          onChange={(v) => update((x) => ({ ...x, showOrphans: v }))}
        />
        <Toggle
          label="Unresolved links"
          checked={s.showUnresolved}
          onChange={(v) => update((x) => ({ ...x, showUnresolved: v }))}
        />
      </details>

      <details open>
        <summary>Groups</summary>
        {s.groups.map((g, i) => (
          <div className="graph-group" key={i}>
            <input
              type="text"
              aria-label={`Group ${i + 1} query`}
              placeholder="text, tag:x, path:x"
              value={g.query}
              onChange={(e) =>
                setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, query: e.target.value } : x)))
              }
            />
            <input
              type="color"
              aria-label={`Group ${i + 1} colour`}
              value={g.color}
              onChange={(e) =>
                setGroups((gs) => gs.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))
              }
            />
            <button
              type="button"
              aria-label={`Remove group ${i + 1}`}
              onClick={() => setGroups((gs) => gs.filter((_, j) => j !== i))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="graph-new-group"
          onClick={() =>
            setGroups((gs) => [
              ...gs,
              { query: "", color: GROUP_COLORS[gs.length % GROUP_COLORS.length] ?? "#0090ff" },
            ])
          }
        >
          <Plus size={14} /> New group
        </button>
      </details>

      <details open>
        <summary>Display</summary>
        <Toggle
          label="Arrows"
          checked={s.display.arrows}
          onChange={(v) => display({ arrows: v })}
        />
        <Toggle label="Icons" checked={s.display.icons} onChange={(v) => display({ icons: v })} />
        <Slider
          label="Text fade threshold"
          range="textFade"
          value={s.display.textFade}
          onChange={(v) => display({ textFade: v })}
        />
        <Slider
          label="Node size"
          range="nodeSize"
          value={s.display.nodeSize}
          onChange={(v) => display({ nodeSize: v })}
        />
        <Slider
          label="Link thickness"
          range="linkThickness"
          value={s.display.linkThickness}
          onChange={(v) => display({ linkThickness: v })}
        />
        <button type="button" className="graph-reset" onClick={() => display(DEFAULT_DISPLAY)}>
          <RotateCcw size={12} /> Restore display defaults
        </button>
      </details>

      <details open>
        <summary>Forces</summary>
        <Slider
          label="Center force"
          range="center"
          value={s.forces.center}
          onChange={(v) => forces({ center: v })}
        />
        <Slider
          label="Repel force"
          range="repel"
          value={s.forces.repel}
          onChange={(v) => forces({ repel: v })}
        />
        <Slider
          label="Link force"
          range="linkForce"
          value={s.forces.linkForce}
          onChange={(v) => forces({ linkForce: v })}
        />
        <Slider
          label="Link distance"
          range="linkDistance"
          value={s.forces.linkDistance}
          onChange={(v) => forces({ linkDistance: v })}
        />
        <button type="button" className="graph-reset" onClick={() => forces(DEFAULT_FORCES)}>
          <RotateCcw size={12} /> Restore force defaults
        </button>
      </details>
    </aside>
  );
}
