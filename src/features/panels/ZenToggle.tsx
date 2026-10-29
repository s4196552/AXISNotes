import { Maximize2, Minimize2 } from "lucide-react";
import { useConfig } from "../../app/config";
import { useLayout } from "../../app/layout";
import { toggleZen } from "../../app/zen";
import { formatHotkey } from "../commands/hotkeys";
import { allCommands, shortcutOf } from "../commands/registry";

/** Enter Zen mode from the tab row, or leave it once the top edge has revealed the row. */
export function ZenToggle() {
  const zen = useLayout((s) => s.zen);
  useConfig((s) => s.config.hotkeys);
  const cmd = allCommands().find((c) => c.id === "zen-mode");
  const key = cmd && shortcutOf(cmd);
  const label = zen ? "Leave Zen mode" : "Zen mode";
  const Icon = zen ? Minimize2 : Maximize2;
  return (
    <button
      className="side-panels-toggle zen-toggle"
      aria-label={label}
      aria-pressed={zen}
      title={key ? `${label} (${formatHotkey(key)})` : label}
      onClick={toggleZen}
    >
      <Icon size={15} />
    </button>
  );
}
