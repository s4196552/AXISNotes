import { useMemo, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { type AxisConfig } from "../../app/config";
import { effectiveShortcut, formatHotkey, hotkeyFromEvent, parseHotkey } from "../commands/hotkeys";
import { allCommands, shortcutOf } from "../commands/registry";

// Settings → Keyboard shortcuts: every command, its shortcut, and remapping by pressing
// the new keys. Overrides live in `.axisnotes/config.json` (`hotkeys`).

interface Props {
  config: AxisConfig;
  set(fn: (c: AxisConfig) => AxisConfig): void;
}

export function HotkeysSettings({ config, set }: Props) {
  const [recording, setRecording] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const commands = useMemo(
    () =>
      allCommands()
        .filter((c) => c.label.toLowerCase().includes(filter.toLowerCase()))
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label)),
    // `config` changes when a shortcut changes; the list re-reads the bindings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter, config.hotkeys],
  );

  /** Set a command's shortcut (null = back to its default, "" = none). */
  const bind = (id: string, hotkey: string | null) =>
    set((c) => {
      const hotkeys = { ...c.hotkeys };
      const cmd = allCommands().find((x) => x.id === id);
      let result = hotkey;
      if (hotkey === null) {
        delete hotkeys[id];
        result = cmd?.shortcut ? formatHotkey(cmd.shortcut) : "";
      } else hotkeys[id] = hotkey;
      // One shortcut, one command: take it from any other command that has it.
      if (result)
        for (const other of allCommands()) {
          const s = effectiveShortcut(other.id, other.shortcut, hotkeys);
          if (other.id !== id && s && formatHotkey(s) === result) hotkeys[other.id] = "";
        }
      return { ...c, hotkeys };
    });

  return (
    <>
      <input
        className="hotkeys-filter"
        aria-label="Filter commands"
        placeholder="Filter commands…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ul className="hotkeys" aria-label="Keyboard shortcuts">
        {commands.map((c) => {
          const s = shortcutOf(c);
          const changed = c.id in config.hotkeys;
          return (
            <li key={c.id}>
              <span className="hotkeys-label">{c.label}</span>
              {recording === c.id ? (
                <button
                  className="hotkeys-key recording"
                  autoFocus
                  onBlur={() => setRecording(null)}
                  onKeyDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === "Escape") return setRecording(null);
                    const hk = hotkeyFromEvent(e.nativeEvent);
                    if (!hk || !parseHotkey(hk)) return;
                    bind(c.id, hk);
                    setRecording(null);
                  }}
                >
                  Press keys…
                </button>
              ) : (
                <button
                  className="hotkeys-key"
                  aria-label={`Shortcut for ${c.label}`}
                  title="Click, then press the new shortcut"
                  onClick={() => setRecording(c.id)}
                >
                  {s ? formatHotkey(s) : <span className="muted">None</span>}
                </button>
              )}
              {s && (
                <button
                  className="ai-icon"
                  aria-label={`Remove shortcut for ${c.label}`}
                  onClick={() => bind(c.id, "")}
                >
                  <X size={13} />
                </button>
              )}
              {changed && (
                <button
                  className="ai-icon"
                  aria-label={`Reset shortcut for ${c.label}`}
                  title="Back to the default"
                  onClick={() => bind(c.id, null)}
                >
                  <RotateCcw size={13} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
