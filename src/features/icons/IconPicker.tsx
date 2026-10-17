import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { type FolderIcon, useConfig } from "../../app/config";
import { loadEmoji, searchEmoji } from "../editor/quickCommands";
import { ICON_COLORS, ICONS, isLucide, loadAllIcons, loadedIcons, matchesIcon } from "./iconSet";
import "./icons.css";

/** Icons rendered per page of results, so typing stays quick with ~1,900 icons. */
export const ICON_PAGE = 240;

type Load = "loading" | "ready" | "error";

export function IconPicker({ path, onClose }: { path: string; onClose(): void }) {
  const current = useConfig((s) => s.config.folderIcons[path]);
  const update = useConfig((s) => s.update);
  const [tab, setTab] = useState<"icons" | "emoji">(
    current && !isLucide(current.icon) ? "emoji" : "icons",
  );
  const [color, setColor] = useState(current?.color ?? "");
  const [query, setQuery] = useState("");
  const [emoji, setEmoji] = useState<{ emoji: string; name: string }[]>([]);
  const [all, setAll] = useState<Record<string, LucideIcon> | null>(loadedIcons);
  const [load, setLoad] = useState<Load>(all ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);
  const [limit, setLimit] = useState(ICON_PAGE);

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

  useEffect(() => {
    if (tab !== "icons" || all) return;
    let cancelled = false;
    loadAllIcons().then(
      (icons) => {
        if (cancelled) return;
        setAll(icons);
        setLoad("ready");
      },
      () => !cancelled && setLoad("error"),
    );
    return () => {
      cancelled = true;
    };
  }, [tab, all, attempt]);

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

  const suggested = Object.entries(ICONS).filter(([name]) => matchesIcon(name, query));
  // The full set minus the suggested ones (shown first), filtered by the query.
  const rest = useMemo(
    () =>
      all
        ? Object.entries(all).filter(([name]) => !(name in ICONS) && matchesIcon(name, query))
        : [],
    [all, query],
  );
  const shown = rest.slice(0, limit);
  const customColor = color && !ICON_COLORS.includes(color) ? color : "";

  const iconButton = ([name, Icon]: [string, LucideIcon]) => (
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
            placeholder={tab === "icons" ? "Search icons…" : "Search emoji…"}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(ICON_PAGE);
            }}
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
          <label
            className={`icon-swatch icon-custom-color${customColor ? " chosen" : ""}`}
            title="Any colour"
            style={customColor ? { background: customColor } : undefined}
          >
            <input
              type="color"
              aria-label="Custom color"
              value={customColor || "#888888"}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
        </div>
        <div className="icon-scroll">
          {tab === "icons" ? (
            <>
              {suggested.length > 0 && (
                <>
                  {!query && <div className="icon-section">Suggested</div>}
                  <div className="icon-grid" role="listbox" aria-label="Suggested icons">
                    {suggested.map(iconButton)}
                  </div>
                </>
              )}
              {!query && <div className="icon-section">All icons</div>}
              {load === "loading" && <p className="icon-note">Loading all icons…</p>}
              {load === "error" && (
                <p className="icon-note" role="alert">
                  Couldn't load the full icon set.{" "}
                  <button
                    onClick={() => {
                      setLoad("loading");
                      setAttempt((n) => n + 1);
                    }}
                  >
                    Try again
                  </button>
                </p>
              )}
              {load === "ready" && (
                <>
                  <div className="icon-grid" role="listbox" aria-label="Choose an icon">
                    {shown.map(iconButton)}
                  </div>
                  {rest.length > shown.length && (
                    <button className="icon-more" onClick={() => setLimit((n) => n + ICON_PAGE)}>
                      Show more ({(rest.length - shown.length).toLocaleString()} left)
                    </button>
                  )}
                  {query && suggested.length === 0 && rest.length === 0 && (
                    <p className="icon-note">No icons match “{query}”.</p>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="icon-grid" role="listbox" aria-label="Choose an emoji">
              {emoji.map((e) => (
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
          )}
        </div>
        <div className="icon-picker-actions">
          {current && <button onClick={() => save(null)}>Remove icon</button>}
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
