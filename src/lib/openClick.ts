import type { MouseEvent } from "react";

// How a click on something that opens a note behaves everywhere (as in Obsidian and
// browsers): a click opens it here; Ctrl/Cmd+click or a middle-click (the scroll wheel)
// opens it in a new tab.

/** Event handlers for an element that opens something; spread them onto it. */
export function openOnClick(open: (newTab: boolean) => void) {
  return {
    onClick: (e: MouseEvent) => open(e.ctrlKey || e.metaKey),
    // Without this, pressing the wheel starts the browser's auto-scroll instead.
    onMouseDown: (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    },
    onAuxClick: (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      open(true);
    },
  };
}
