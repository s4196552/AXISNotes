import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppStore } from "../../app/store";
import { getActiveEditor } from "./activeEditor";
import { createPortal } from "react-dom";
import { type ChatContext, openSidebarChat } from "../ai/sidebarChatState";

export function NoteContextMenu({
  x,
  y,
  context,
  onClose,
}: {
  x: number;
  y: number;
  context: ChatContext;
  onClose(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const rect = menu.current!.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(x, innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(y, innerHeight - rect.height - 4)),
    });
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [x, y]);
  useEffect(() => {
    const outside = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);
  async function clipboard(action: "copy" | "cut" | "paste") {
    try {
      if (action !== "paste") await navigator.clipboard.writeText(context.text);
      if (action !== "copy") {
        const insert = action === "paste" ? await navigator.clipboard.readText() : "";
        const active = getActiveEditor();
        if (active?.path !== context.path || active.view.state.doc.toString() !== context.doc)
          throw new Error("The note changed. Select the text again.");
        const range = context.selection ? context : active.view.state.selection.main;
        active.view.dispatch({ changes: { from: range.from, to: range.to, insert } });
      }
    } catch (e) {
      useAppStore.getState().notify(e instanceof Error ? e.message : String(e));
    }
    onClose();
  }
  const label = context.selection ? "selection" : "note";
  return createPortal(
    <div
      ref={menu}
      className="note-ai-menu"
      role="menu"
      aria-label="Note actions"
      style={position}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>("button")];
        const next =
          (buttons.indexOf(document.activeElement as HTMLButtonElement) +
            (e.key === "ArrowDown" ? 1 : -1) +
            buttons.length) %
          buttons.length;
        buttons[next]?.focus();
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          openSidebarChat(context, `Explain this ${label}.`);
          onClose();
        }}
      >
        Ask AI about this {label}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          openSidebarChat(context);
          onClose();
        }}
      >
        Send {label} to AI chat
      </button>
      {context.selection && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            void clipboard("copy");
          }}
        >
          Copy selection
        </button>
      )}
      {context.selection && (
        <button type="button" role="menuitem" onClick={() => void clipboard("cut")}>
          Cut selection
        </button>
      )}
      <button type="button" role="menuitem" onClick={() => void clipboard("paste")}>
        Paste
      </button>
    </div>,
    document.body,
  );
}
