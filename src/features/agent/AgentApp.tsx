import { useEffect, useRef, useState } from "react";
import { type AgentView, backend } from "../../ipc";
import { saveAgentPosition } from "./agentSettings";
import { loadAgentImages, useAgentImageUrls } from "./agentImages";
import { AgentFigure } from "./AgentFigure";
import { AgentChatButton, AgentChatPanel, type ChatActions } from "./AgentChatPanel";

// The page inside the Agent's own window (src/main.tsx renders it for `?agent`). It only
// draws what the main window sends and passes back clicks, drags and menu choices: it
// never reads notes or talks to an AI provider.

const MENU = [
  { id: "open", label: "Open AXISNotes" },
  { id: "sleep", label: "Sleep now" },
  { id: "hide", label: "Hide the Agent" },
] as const;

export function AgentApp() {
  const side = backend.agentSide;
  const [view, setView] = useState<AgentView | null>(null);
  const images = useAgentImageUrls((s) => s.images);
  const press = useRef<{ x: number; y: number; dragging: boolean } | null>(null);

  useEffect(() => {
    if (!side) return;
    let stop: (() => void)[] = [];
    let gone = false;
    void Promise.all([side.onView(setView), side.onMoved(saveAgentPosition)]).then((uns) => {
      if (gone) uns.forEach((u) => u());
      else stop = uns;
      void side.post({ kind: "ready" });
    });
    return () => {
      gone = true;
      stop.forEach((u) => u());
    };
  }, [side]);

  const version = view?.imagesVersion;
  useEffect(() => {
    if (version !== undefined) void loadAgentImages(version);
  }, [version]);

  if (!side || !view) return null;
  const chat: ChatActions = {
    open: () => void side.post({ kind: "chat-open" }),
    close: () => void side.post({ kind: "chat-close" }),
    send: (text) => void side.post({ kind: "chat-send", text }),
    stop: () => void side.post({ kind: "chat-stop" }),
    useNote: (on) => void side.post({ kind: "chat-use-note", on }),
    draft: () => void side.post({ kind: "chat-draft" }),
  };
  const cell = Math.round(view.size * 1.25);
  return (
    <div className="agent-window-root">
      <div
        className="agent-window-figure"
        style={{ width: cell, height: cell }}
        onPointerDown={(e) => {
          if (e.button === 0) press.current = { x: e.clientX, y: e.clientY, dragging: false };
        }}
        onPointerMove={(e) => {
          const p = press.current;
          if (!p || p.dragging || !(e.buttons & 1)) return;
          if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return;
          p.dragging = true;
          void side.startDragging();
        }}
        onPointerUp={() => {
          const p = press.current;
          press.current = null;
          if (p && !p.dragging) void side.post({ kind: "open" });
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          void side.showMenu(MENU.map((m) => ({ ...m }))).then((id) => {
            const item = MENU.find((m) => m.id === id);
            if (item) void side.post({ kind: item.id });
          });
        }}
      >
        <AgentFigure
          state={view.state}
          size={view.size}
          image={images[view.state]}
          detail={view.detail}
        />
      </div>
      <div className="agent-under" style={{ width: cell }}>
        <AgentChatButton on={chat} open={view.chat !== null} />
      </div>
      {view.chat && <AgentChatPanel chat={view.chat} on={chat} />}
    </div>
  );
}
