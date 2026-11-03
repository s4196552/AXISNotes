import { createElement, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { useFitToViewport } from "../../app/menuPosition";
import { activeTab, type Loc } from "../../app/tabs";
import { formatHotkey } from "../commands/hotkeys";
import { allCommands, shortcutOf } from "../commands/registry";
import { kindIcon, tabTitle } from "./tabInfo";

/** Mouse buttons 4 and 5, the side buttons most mice have for Back and Forward. */
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

const SIDES = {
  back: { Icon: ArrowLeft, command: "go-back", word: "Back" },
  forward: { Icon: ArrowRight, command: "go-forward", word: "Forward" },
} as const;
type Side = keyof typeof SIDES;

/**
 * Back and Forward through the files and views the active tab has shown, like a browser's.
 * Right-click either button for its list of places; the mouse's side buttons work too.
 */
export function NavButtons() {
  const tab = useAppStore((s) => activeTab(s.tabs));
  const [menu, setMenu] = useState<{ side: Side; x: number; y: number } | null>(null);
  // Re-render when shortcuts are remapped in Settings, so the tooltips stay right.
  useConfig((s) => s.config.hotkeys);

  useEffect(() => {
    const isSide = (e: MouseEvent) => e.button === MOUSE_BACK || e.button === MOUSE_FORWARD;
    // Stop the webview acting on the side buttons itself.
    const onDown = (e: MouseEvent) => {
      if (isSide(e)) e.preventDefault();
    };
    const onUp = (e: MouseEvent) => {
      if (!isSide(e)) return;
      e.preventDefault();
      const store = useAppStore.getState();
      if (e.button === MOUSE_BACK) store.goBack();
      else store.goForward();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  // Nearest place first.
  const places = (side: Side) => [...(side === "back" ? tab.back : tab.forward)].reverse();

  const commands = allCommands();
  const button = (side: Side) => {
    const { Icon, command, word } = SIDES[side];
    const next = places(side)[0];
    const cmd = commands.find((c) => c.id === command);
    const key = cmd && shortcutOf(cmd);
    const label = next ? `${word} to ${tabTitle(next)}` : word;
    return (
      <button
        className="tab-new tab-nav-button"
        aria-label={label}
        title={key ? `${label} (${formatHotkey(key)})` : label}
        disabled={!next}
        onClick={() => {
          const store = useAppStore.getState();
          if (side === "back") store.goBack();
          else store.goForward();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ side, x: r.left, y: r.bottom + 4 });
        }}
      >
        <Icon size={15} aria-hidden />
      </button>
    );
  };

  return (
    <div className="tab-nav" role="group" aria-label="History">
      {button("back")}
      {button("forward")}
      {menu && (
        <HistoryMenu
          side={menu.side}
          places={places(menu.side)}
          x={menu.x}
          y={menu.y}
          close={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/** The places Back (or Forward) can go to, nearest first; picking one jumps straight there. */
function HistoryMenu(props: { side: Side; places: Loc[]; x: number; y: number; close(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFitToViewport(ref, props.x, props.y);
  if (!props.places.length) return null;
  return (
    <div
      ref={ref}
      className="filetree-menu tab-menu"
      role="menu"
      aria-label={`${SIDES[props.side].word} history`}
      style={{ left: props.x, top: props.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {props.places.map((loc, i) => {
        const Kind = kindIcon(loc);
        return (
          <button
            // Places can repeat, so the position is part of the key.
            key={`${i}:${loc.view}:${loc.path ?? ""}`}
            role="menuitem"
            title={loc.path ?? undefined}
            onClick={() => {
              props.close();
              useAppStore.getState().goHistory(props.side === "back" ? -(i + 1) : i + 1);
            }}
          >
            {Kind && createElement(Kind, { size: 15, className: "menu-icon", "aria-hidden": true })}
            {tabTitle(loc)}
          </button>
        );
      })}
    </div>
  );
}
