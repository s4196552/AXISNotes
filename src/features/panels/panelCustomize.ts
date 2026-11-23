import { useEffect, useRef } from "react";
import { create } from "zustand";
import { usePointerDrag } from "../../app/usePointerDrag";
import {
  moveToSide,
  type PanelId,
  placeBeside,
  type SidebarSide,
  updatePlacement,
} from "../../app/sidebarLayout";

// Customizing the sidebars (T-275): dragging a panel's tab or section heading to reorder it
// or move it to the other sidebar, the same with the keyboard, each panel's menu, and each
// sidebar's Add panel menu.

export const OTHER: Record<SidebarSide, SidebarSide> = { left: "right", right: "left" };
export const SIDE_NAME: Record<SidebarSide, string> = {
  left: "left sidebar",
  right: "right sidebar",
};

// ---- Focus that follows a moved panel ----

/** The panel whose handle should take focus when it next renders (after a keyboard move). */
let refocus: PanelId | null = null;

/** A ref for a panel's handle that takes focus back after a keyboard move or a fold. */
export function handleRef(id: PanelId) {
  return (el: HTMLElement | null) => {
    if (!el || refocus !== id) return;
    const lost = document.activeElement === document.body || document.activeElement === null;
    if (lost || document.activeElement === el) {
      el.focus();
      refocus = null;
    }
  };
}

/** How long a handle that isn't on screen yet (the lazy Local graph) may still take focus. */
const REFOCUS_WAIT = 3000;

/**
 * Keep focus on `id`'s handle through the re-render a change causes. A handle that mounts
 * later (the Local graph loads on demand) takes focus from `handleRef` when it appears.
 */
export function keepFocus(id: PanelId) {
  refocus = id;
  requestAnimationFrame(() => {
    if (refocus !== id) return;
    const el = document.querySelector<HTMLElement>(`[data-panel-handle="${id}"]`);
    if (!el) {
      setTimeout(() => {
        if (refocus === id) refocus = null;
      }, REFOCUS_WAIT);
      return;
    }
    refocus = null;
    const lost = document.activeElement === document.body || document.activeElement === null;
    if (lost) el.focus();
  });
}

/** After `id` leaves its sidebar, focus the panel next to it, or the sidebar's Add panel. */
export function focusAfterRemoving(id: PanelId, group: readonly PanelId[], side: SidebarSide) {
  const at = group.indexOf(id);
  const next = group[at + 1] ?? group[at - 1];
  if (next) {
    keepFocus(next);
    return;
  }
  requestAnimationFrame(() => {
    const lost = document.activeElement === document.body || document.activeElement === null;
    if (lost) document.querySelector<HTMLElement>(`[data-add-panel="${side}"]`)?.focus();
  });
}

// ---- Moving panels ----

/** Move `id` one place along `group` (the panels shown with it, in order). */
export function nudgePanel(id: PanelId, group: readonly PanelId[], step: number) {
  const to = group.indexOf(id) + step;
  if (to < 0 || to >= group.length || group.indexOf(id) === -1) return;
  keepFocus(id);
  void updatePlacement((p) => placeBeside(p, id, group[to]!, step > 0));
}

export function movePanelTo(id: PanelId, side: SidebarSide) {
  keepFocus(id);
  void updatePlacement((p) => moveToSide(p, id, side));
}

// ---- Dragging panels ----

/** Where a dragged panel would land: beside a panel, or at the end of a sidebar. */
export interface PanelDrop {
  side: SidebarSide;
  id: PanelId | null;
  after: boolean;
}

/** What is being dragged where, shared so both sidebars can draw it. */
export const usePanelDragView = create<{ dragging: PanelId | null; target: PanelDrop | null }>(
  () => ({ dragging: null, target: null }),
);

function dropAt(x: number, y: number, dragged: PanelId): PanelDrop | null {
  const hit = document.elementFromPoint(x, y);
  const sideEl = hit?.closest<HTMLElement>("[data-panel-side]");
  if (!sideEl) return null;
  const side = sideEl.dataset.panelSide as SidebarSide;
  const el = hit?.closest<HTMLElement>("[data-panel-id]");
  if (!el || !sideEl.contains(el)) return { side, id: null, after: true };
  const id = el.dataset.panelId as PanelId;
  if (id === dragged) return null;
  const r = el.getBoundingClientRect();
  // Tabs sit in a row; sections are full-width rows in a column.
  const across = r.width > r.height * 2.5;
  return { side, id, after: across ? y > r.top + r.height / 2 : x > r.left + r.width / 2 };
}

/** Start dragging a panel from its handle (pointer events, like the ribbon's drag). */
export function usePanelDrag() {
  const { press, dragging, target } = usePointerDrag<PanelId, PanelDrop>(dropAt, (id, at) => {
    void updatePlacement((p) =>
      at.id ? placeBeside(p, id, at.id, at.after) : moveToSide(p, id, at.side),
    );
  });
  // Only the handle a drag started from reports it (and clears it when it ends).
  const owns = useRef(false);
  useEffect(() => {
    if (dragging === null && !owns.current) return;
    owns.current = dragging !== null;
    usePanelDragView.setState({ dragging, target });
  }, [dragging, target]);
  return press;
}

/** Attributes that draw a drag over panel `id`. */
export function useDropMark(id: PanelId) {
  const dragging = usePanelDragView((s) => s.dragging === id);
  const drop = usePanelDragView((s) =>
    s.target?.id === id ? (s.target.after ? "after" : "before") : undefined,
  );
  return { "data-dragging": dragging ? "" : undefined, "data-drop": drop };
}

// ---- Menus ----

type OpenMenu =
  | { kind: "panel"; id: PanelId; side: SidebarSide; group: PanelId[]; x: number; y: number }
  | { kind: "add"; side: SidebarSide; x: number; y: number };

export const usePanelMenu = create<{
  menu: OpenMenu | null;
  opener: HTMLElement | null;
}>(() => ({ menu: null, opener: null }));

/** Where a menu opens: at the pointer, or under the element for the keyboard. */
function menuPoint(e: { clientX?: number; clientY?: number; currentTarget: Element }) {
  if (e.clientX || e.clientY) return { x: e.clientX ?? 0, y: e.clientY ?? 0 };
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 2 };
}

/** A right-click, or a key press that opens the menu (no pointer position). */
interface MenuEvent {
  clientX?: number;
  clientY?: number;
  currentTarget: HTMLElement;
  preventDefault(): void;
  stopPropagation(): void;
}

export function openPanelMenu(e: MenuEvent, id: PanelId, side: SidebarSide, group: PanelId[]) {
  e.preventDefault();
  e.stopPropagation();
  usePanelMenu.setState({
    menu: { kind: "panel", id, side, group, ...menuPoint(e) },
    opener: e.currentTarget,
  });
}

export function openAddMenu(e: React.MouseEvent<HTMLElement>, side: SidebarSide) {
  const r = e.currentTarget.getBoundingClientRect();
  usePanelMenu.setState({
    menu: { kind: "add", side, x: r.left, y: r.bottom + 2 },
    opener: e.currentTarget,
  });
}

export function closeMenu(refocusOpener = true) {
  const { opener } = usePanelMenu.getState();
  usePanelMenu.setState({ menu: null, opener: null });
  if (refocusOpener && opener?.isConnected) opener.focus();
}

/**
 * Props for a panel's handle (its tab, or its section's fold button): drag it, Alt + arrow
 * keys move it along `group` (`axis` says which arrows), and the context menu (right-click,
 * Shift+F10 or the menu key) has the rest.
 */
export function panelHandle(
  press: ReturnType<typeof usePanelDrag>,
  id: PanelId,
  side: SidebarSide,
  group: PanelId[],
  axis: "row" | "column",
) {
  const back = axis === "row" ? "ArrowLeft" : "ArrowUp";
  const forward = axis === "row" ? "ArrowRight" : "ArrowDown";
  return {
    "data-panel-handle": id,
    ref: handleRef(id),
    onPointerDown: (e: React.PointerEvent) => press(e, id),
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => openPanelMenu(e, id, side, group),
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      // The menu key and Shift+F10 open the panel's menu (not every webview sends a
      // contextmenu event for them).
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        openPanelMenu(e, id, side, group);
        return;
      }
      if (!e.altKey || (e.key !== back && e.key !== forward)) return;
      e.preventDefault();
      nudgePanel(id, group, e.key === forward ? 1 : -1);
    },
  };
}
