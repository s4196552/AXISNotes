// Keyboard shortcuts as text ("Ctrl+Shift+K"), so users can remap commands in
// `.axisnotes/config.json` (`hotkeys: { "<command id>": "Ctrl+Shift+K" | "" }`).

export interface Shortcut {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS", "AltGraph"]);

/** "Ctrl+Shift+K" → shortcut; "" or invalid → null. "Cmd" is accepted for Ctrl. */
export function parseHotkey(text: string): Shortcut | null {
  const parts = text
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const s: Shortcut = { key: "" };
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === "ctrl" || l === "cmd" || l === "mod" || l === "meta") s.mod = true;
    else if (l === "shift") s.shift = true;
    else if (l === "alt" || l === "option") s.alt = true;
    else if (s.key) return null;
    else s.key = p.length === 1 ? p.toLowerCase() : p;
  }
  return s.key ? s : null;
}

export function formatHotkey(s: Shortcut): string {
  return [
    s.mod && "Ctrl",
    s.shift && "Shift",
    s.alt && "Alt",
    s.key.length === 1 ? s.key.toUpperCase() : s.key,
  ]
    .filter(Boolean)
    .join("+");
}

/** The hotkey a key press makes, or null while only modifiers are held. */
export function hotkeyFromEvent(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const key = e.key === " " ? "Space" : e.key;
  return formatHotkey({
    key: key.length === 1 ? key.toLowerCase() : key,
    mod: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
  });
}

export function matches(
  s: Shortcut,
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
): boolean {
  const key = e.key === " " ? "Space" : e.key;
  return (
    s.key.toLowerCase() === key.toLowerCase() &&
    Boolean(s.mod) === (e.ctrlKey || e.metaKey) &&
    Boolean(s.shift) === e.shiftKey &&
    Boolean(s.alt) === e.altKey
  );
}

/** The shortcut in effect: the user's override ("" = none) or the default. */
export function effectiveShortcut(
  id: string,
  fallback: Shortcut | undefined,
  overrides: Record<string, string>,
): Shortcut | undefined {
  if (!(id in overrides)) return fallback;
  return parseHotkey(overrides[id]!) ?? undefined;
}
