import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useRibbon, useRibbonDrag } from "../ribbon/Ribbon";
import { Field, type SectionProps } from "./parts";

/** Settings → Appearance → Ribbon: turn it on or off; show, hide and reorder its buttons. */
export function RibbonSettings({ config, set }: SectionProps) {
  const { arranged, hidden, move } = useRibbon();
  const ids = arranged.map((i) => i.id);
  const drag = useRibbonDrag(ids, move);
  const setRibbon = (patch: Partial<typeof config.ribbon>) =>
    set((c) => ({ ...c, ribbon: { ...c.ribbon, ...patch } }));
  return (
    <>
      <Field
        label="Show the ribbon"
        hint="A column of buttons beside the left panel. While it's off, Home, Graph view, Tasks and Time report are back above the panel."
      >
        <input
          type="checkbox"
          aria-label="Show the ribbon"
          checked={config.ribbon.enabled}
          onChange={(e) => setRibbon({ enabled: e.target.checked })}
        />
      </Field>
      <div className="settings-field settings-field-wide">
        <div>
          <div className="settings-label" id="ribbon-buttons-label">
            Buttons
          </div>
          <div className="settings-hint muted">
            Drag to reorder (or use the arrows); untick to hide. Plugins add their own buttons,
            shown while the plugin is on.
          </div>
        </div>
        <ul className="ribbon-settings-list" aria-labelledby="ribbon-buttons-label">
          {arranged.map((item, i) => (
            <li key={item.id} className="ribbon-settings-row" {...drag(item.id)}>
              <GripVertical size={14} className="grip" aria-hidden="true" />
              <item.Icon size={16} aria-hidden="true" />
              <span className="ribbon-settings-label">
                {item.label}
                {item.source !== "AXISNotes" && (
                  <span className="ribbon-settings-source"> · added by {item.source}</span>
                )}
              </span>
              <input
                type="checkbox"
                aria-label={`Show ${item.label}`}
                checked={!hidden.includes(item.id)}
                onChange={(e) =>
                  setRibbon({
                    hidden: e.target.checked
                      ? config.ribbon.hidden.filter((h) => h !== item.id)
                      : [...config.ribbon.hidden, item.id],
                  })
                }
              />
              <button
                aria-label={`Move ${item.label} up`}
                disabled={i === 0}
                onClick={() => move(item.id, ids[i - 1]!)}
              >
                <ArrowUp size={13} aria-hidden="true" />
              </button>
              <button
                aria-label={`Move ${item.label} down`}
                disabled={i === ids.length - 1}
                onClick={() => move(item.id, ids[i + 2] ?? null)}
              >
                <ArrowDown size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {(config.ribbon.order.length > 0 || config.ribbon.hidden.length > 0) && (
          <button onClick={() => setRibbon({ order: [], hidden: [] })}>Reset buttons</button>
        )}
      </div>
    </>
  );
}
