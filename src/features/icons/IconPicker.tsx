import { useEffect, useState } from "react";
import { type FolderIcon, useConfig } from "../../app/config";
import { loadEmoji, searchEmoji } from "../editor/quickCommands";
import { ICON_COLORS, ICONS } from "./iconSet";
import "./icons.css";

export function IconPicker({ path, onClose }: { path: string; onClose(): void }) {
  const current = useConfig((s) => s.config.folderIcons[path]);
  const update = useConfig((s) => s.update);
  const [tab, setTab] = useState<"icons" | "emoji">(
    current && !current.icon.startsWith("lucide:") ? "emoji" : "icons",
  );
  const [color, setColor] = useState(current?.color ?? "");
  const [query, setQuery] = useState("");
  const [emoji, setEmoji] = useState<{ emoji: string; name: string }[]>([]);

  useEffect(() => {
    if (tab !== "emoji") return;
    let cancelled = false;
    void loadEmoji().then((data) => {
      if (!cancelled) setEmoji(searchEmoji(data, query || "a", 120));
    });
    return () => {
      cancelled = true;
    };
  }, [tab, query]);

  const save = (icon: FolderIcon | null) => {
    void update((c) => {
      const folderIcons = { ...c.folderIcons };
      if (icon) folderIcons[path] = icon;
      else delete folderIcons[path];
      return { ...c, folderIcons };
    });
    onClose();
  };
  const pick = (icon: string) => save(color ? { icon, color } : { icon });

  const icons = Object.entries(ICONS).filter(([name]) =>
    name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal icon-picker"
        role="dialog"
        aria-label={`Icon for ${path}`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="icon-picker-top">
          <div role="tablist" className="icon-tabs">
            <button role="tab" aria-selected={tab === "icons"} onClick={() => setTab("icons")}>
              Icons
            </button>
            <button role="tab" aria-selected={tab === "emoji"} onClick={() => setTab("emoji")}>
              Emoji
            </button>
          </div>
          <input
            aria-label="Filter icons"
            placeholder="Filter…"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="icon-colors" role="radiogroup" aria-label="Color">
          {ICON_COLORS.map((c) => (
            <button
              key={c || "none"}
              role="radio"
              aria-checked={color === c}
              aria-label={c ? `Color ${c}` : "Default color"}
              className="icon-swatch"
              style={{ background: c || "var(--fg-muted)" }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <div className="icon-grid" role="listbox" aria-label="Choose an icon">
          {tab === "icons"
            ? icons.map(([name, Icon]) => (
                <button
                  key={name}
                  role="option"
                  aria-selected={current?.icon === `lucide:${name}`}
                  aria-label={name}
                  title={name}
                  onClick={() => pick(`lucide:${name}`)}
                >
                  <Icon size={18} style={color ? { color } : undefined} />
                </button>
              ))
            : emoji.map((e) => (
                <button
                  key={e.emoji}
                  role="option"
                  aria-selected={current?.icon === e.emoji}
                  aria-label={e.name.replace(/_/g, " ")}
                  title={e.name.replace(/_/g, " ")}
                  onClick={() => pick(e.emoji)}
                >
                  {e.emoji}
                </button>
              ))}
        </div>
        <div className="icon-picker-actions">
          {current && <button onClick={() => save(null)}>Remove icon</button>}
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
