import { PanelLeft, PanelRight } from "lucide-react";
import { useConfig } from "../../app/config";
import { isPanelOpen, toggleLeftPanel, toggleRightPanel, useLayout } from "../../app/layout";
import { formatHotkey } from "../commands/hotkeys";
import { allCommands, shortcutOf } from "../commands/registry";

const SIDES = {
  left: { name: "left", Icon: PanelLeft, command: "toggle-left-panel", toggle: toggleLeftPanel },
  right: {
    name: "right",
    Icon: PanelRight,
    command: "toggle-right-panel",
    toggle: toggleRightPanel,
  },
} as const;

/** Hides or shows one side panel. Its icon has the bar on that side; pressed while hidden. */
export function PanelToggle({ side, className }: { side: "left" | "right"; className: string }) {
  const { name, Icon, command, toggle } = SIDES[side];
  const hidden = !useLayout((s) => isPanelOpen(s, side));
  // Re-render when shortcuts are remapped in Settings, so the tooltip stays right.
  useConfig((s) => s.config.hotkeys);
  const cmd = allCommands().find((c) => c.id === command);
  const key = cmd && shortcutOf(cmd);
  const label = `${hidden ? "Show" : "Hide"} ${name} panel`;
  return (
    <button
      className={className}
      aria-label={label}
      aria-pressed={hidden}
      title={key ? `${label} (${formatHotkey(key)})` : label}
      onClick={toggle}
    >
      <Icon size={15} />
    </button>
  );
}
