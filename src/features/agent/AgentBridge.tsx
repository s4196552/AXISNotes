import { useEffect, useRef, useState } from "react";
import { type AgentMessage, type AgentView, backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import {
  agentStateAt,
  BUSY_STATES,
  dismiss,
  noteUserActivity,
  sleepNow,
  trackAiActivity,
  useAgentActivity,
} from "./agentModel";
import { loadAgentPosition, useAgentSettings } from "./agentSettings";
import { loadAgentImages, useAgentImagesVersion, useAgentImageUrls } from "./agentImages";
import { AgentFigure } from "./AgentFigure";

// Runs in the main window while the Agent is on. It works out the Agent's state from AI
// activity and the clock, and shows it: in its own always-on-top window on the desktop
// (so it stays visible over other programs), or floating in the page in a browser.
// Turning the Agent off unmounts this, which stops every listener, timer and window.

interface Shown {
  view: AgentView;
  visible: boolean;
}

function compute(): Shown {
  const s = useAgentSettings.getState();
  const at = agentStateAt(useAgentActivity.getState(), Date.now(), s.sleepMinutes * 60_000);
  return {
    view: {
      state: at.state,
      detail: at.detail,
      size: s.size,
      imagesVersion: useAgentImagesVersion.getState().version,
    },
    visible: s.mode === "always" || BUSY_STATES.includes(at.state),
  };
}

/**
 * Keep the view current: recompute on AI activity, settings and image changes, and when
 * the state times out (Done back to Idle, Idle to Sleeping). No polling.
 */
function useAgentView(): Shown {
  const [shown, setShown] = useState<Shown>(compute);

  useEffect(() => {
    const stopTracking = trackAiActivity();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      const next = compute();
      setShown((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
      const s = useAgentSettings.getState();
      const { until } = agentStateAt(
        useAgentActivity.getState(),
        Date.now(),
        s.sleepMinutes * 60_000,
      );
      if (until !== null) timer = setTimeout(refresh, Math.max(0, until - Date.now()) + 25);
    };
    refresh();
    const unsubscribe = [
      useAgentActivity.subscribe(refresh),
      useAgentSettings.subscribe(refresh),
      useAgentImagesVersion.subscribe(refresh),
    ];
    // Using the app keeps the Agent awake.
    const onUse = () => noteUserActivity();
    window.addEventListener("pointerdown", onUse, true);
    window.addEventListener("keydown", onUse, true);
    return () => {
      clearTimeout(timer);
      unsubscribe.forEach((u) => u());
      stopTracking();
      window.removeEventListener("pointerdown", onUse, true);
      window.removeEventListener("keydown", onUse, true);
    };
  }, []);

  return shown;
}

/** Clicking the Agent: bring the app forward, and open the note a finished run was in. */
async function openFromAgent() {
  const { last } = useAgentActivity.getState();
  await backend.agentHost?.focusMain();
  if (last?.status === "ok" && last.path) useAppStore.getState().openFile(last.path);
  dismiss();
}

function hideAgent() {
  useAgentSettings.getState().update({ mode: "off" });
  useAppStore
    .getState()
    .notify("The Agent is hidden. Turn it back on in Settings → Agent or the command palette.");
}

function handle(m: AgentMessage, send: () => void) {
  if (m.kind === "ready") send();
  else if (m.kind === "open") void openFromAgent();
  else if (m.kind === "sleep") sleepNow();
  else if (m.kind === "hide") hideAgent();
}

export function AgentBridge() {
  const mode = useAgentSettings((s) => s.mode);
  if (mode === "off") return null;
  return backend.agentHost ? <WindowAgent /> : <InlineAgent />;
}

/** The desktop: the Agent's own window. */
function WindowAgent() {
  const host = backend.agentHost!;
  const { view, visible } = useAgentView();
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  }, [view]);

  // Open or close the window (again when the size changes, as it's sized to fit).
  useEffect(() => {
    if (!visible) return;
    let closed = false;
    void host.open(loadAgentPosition(), view.size).then(
      () => !closed && void host.send(latest.current),
      () => {},
    );
    return () => {
      closed = true;
      void host.close();
    };
  }, [host, visible, view.size]);

  useEffect(() => {
    if (visible) void host.send(view).catch(() => {});
  }, [host, view, visible]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    void host
      .onMessage((m) => handle(m, () => void host.send(latest.current)))
      .then((un) => (gone ? un() : (stop = un)));
    return () => {
      gone = true;
      stop?.();
    };
  }, [host]);

  return null;
}

const INLINE_KEY = "axis.agent.inlinePosition";

function loadInline(): { right: number; bottom: number } {
  try {
    const v = JSON.parse(localStorage.getItem(INLINE_KEY) ?? "null") as {
      right?: unknown;
      bottom?: unknown;
    } | null;
    if (v && typeof v.right === "number" && typeof v.bottom === "number")
      return { right: v.right, bottom: v.bottom };
  } catch {
    /* no storage */
  }
  return { right: 24, bottom: 36 };
}

/** A browser: the Agent floats in the page; drag it anywhere in the window. */
function InlineAgent() {
  const { view, visible } = useAgentView();
  const [pos, setPos] = useState(loadInline);
  const [menu, setMenu] = useState(false);
  const images = useAgentImageUrls((s) => s.images);
  useEffect(() => void loadAgentImages(view.imagesVersion), [view.imagesVersion]);
  const drag = useRef<{ x: number; y: number; right: number; bottom: number; moved: boolean }>(
    null,
  );

  if (!visible) return null;
  return (
    <div
      className="agent-inline"
      style={{ right: pos.right, bottom: pos.bottom }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY, ...pos, moved: false };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 4) return;
        d.moved = true;
        setPos({
          right: Math.max(0, Math.min(window.innerWidth - view.size, d.right - dx)),
          bottom: Math.max(0, Math.min(window.innerHeight - view.size, d.bottom - dy)),
        });
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d?.moved) {
          try {
            localStorage.setItem(INLINE_KEY, JSON.stringify(pos));
          } catch {
            /* no storage */
          }
        } else if (d) {
          setMenu(false);
          void openFromAgent();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu((m) => !m);
      }}
    >
      {menu && (
        <div className="agent-inline-menu" role="menu" aria-label="Agent">
          {(
            [
              ["open", "Open AXISNotes"],
              ["sleep", "Sleep now"],
              ["hide", "Hide the Agent"],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              role="menuitem"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                setMenu(false);
                handle({ kind }, () => {});
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <AgentFigure
        state={view.state}
        size={view.size}
        image={images[view.state]}
        detail={view.detail}
      />
    </div>
  );
}
