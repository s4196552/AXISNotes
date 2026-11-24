import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { BotOff, Check, Cpu, Sparkles, type LucideIcon } from "lucide-react";
import type { AiRule } from "../../ipc";
import { useConfig } from "../../app/config";
import { useAppStore } from "../../app/store";
import { stricter } from "../../lib/aiAccess";
import { changeSetting } from "../filetree/undo";
import { noteAccess } from "./noteAccess";
import "./ai.css";

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

// The AI access button beside a note's title: its icon shows whether AI may read and
// change this note, and its menu sets the note's own rule — the same per-file rule as the
// file tree's "AI access" menu and Settings → AI → Folder privacy, enforced by the Rust
// layer on every request. Turn the button off in Settings → AI.

const RULES: Record<AiRule, { label: string; short: string; Icon: LucideIcon }> = {
  any: { label: "Any AI", short: "AI can read this note", Icon: Sparkles },
  local: {
    label: "Local models only",
    short: "Only AI models on this device can read this note",
    Icon: Cpu,
  },
  never: { label: "Never", short: "AI can't read this note", Icon: BotOff },
};

export function NoteAiAccess({ path }: { path: string }) {
  const enabled = useConfig((s) => s.config.ai.titleButton !== false);
  const folders = useConfig((s) => s.config.ai.folders);
  const mark = useAppStore((s) => s.notes.find((n) => n.path === path)?.aiAccess);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("[aria-checked=true]")?.focus();
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  if (!enabled) return null;
  const a = noteAccess(folders, path, mark);
  const { Icon } = RULES[a.effective];
  const why =
    a.mark && stricter(a.own ?? a.inherited, a.mark) === a.mark && a.mark !== "any"
      ? ` (its “ai-access: ${a.mark}” property)`
      : !a.own && a.inherited !== "any"
        ? " (its folder's rule)"
        : "";

  const set = (r: AiRule | null) => {
    setOpen(false);
    root.current?.querySelector<HTMLElement>("button")?.focus();
    void changeSetting(`AI access for “${baseName(path)}”`, "ai.folders", path, () =>
      useConfig.getState().update((c) => {
        const next = { ...c.ai.folders };
        if (r === null) delete next[path];
        else next[path] = r;
        return { ...c, ai: { ...c.ai, folders: next } };
      }),
    );
  };

  const choices: [AiRule | null, string][] = [
    [null, `Same as its folder (${RULES[a.inherited].label})`],
    ["any", RULES.any.label],
    ["local", RULES.local.label],
    ["never", RULES.never.label],
  ];

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      root.current?.querySelector<HTMLElement>("button")?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    }
  };

  return (
    <span className="note-ai-access" ref={root}>
      <button
        type="button"
        className={`editor-tool note-ai-access-button rule-${a.effective}`}
        aria-label={`AI access: ${RULES[a.effective].label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${RULES[a.effective].short}${why}. Click to change.`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon size={15} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menu}
          className="note-ai-access-menu"
          role="menu"
          aria-label="AI access for this note"
          onKeyDown={onMenuKey}
        >
          {choices.map(([r, label]) => {
            const checked = a.own === r;
            return (
              <button
                key={label}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => set(r)}
              >
                <Check size={13} aria-hidden="true" className={checked ? "" : "unchecked"} />
                {label}
              </button>
            );
          })}
          {a.mark && a.mark !== "any" && (
            <p className="note-ai-access-hint">
              This note's “ai-access: {a.mark}” property also applies; remove it from the note's
              properties to lift it.
            </p>
          )}
        </div>
      )}
    </span>
  );
}
