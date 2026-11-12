import type { EditorView } from "@codemirror/view";
import { MAX_DIAGRAM_WIDTH, MIN_DIAGRAM_WIDTH } from "./mermaidInfo";

/** Drag the same handles as an image, with proportional scaling for the SVG. */
export function resizeDiagram(
  view: EditorView,
  wrap: HTMLElement,
  frame: HTMLElement,
  width: number | null,
  commit: (width: number) => boolean,
): () => void {
  const win = frame.ownerDocument.defaultView!;
  const badge = frame.ownerDocument.createElement("div");
  badge.className = "cm-image-size";
  badge.hidden = true;
  const guides = frame.ownerDocument.createElement("div");
  guides.className = "cm-mermaid-guides";
  guides.setAttribute("aria-hidden", "true");
  let pointer: AbortController | undefined;
  let cancel: (() => void) | undefined;

  function endGuides() {
    pointer?.abort();
    pointer = undefined;
    guides.remove();
  }

  function startGuides(event: PointerEvent) {
    if (event.button !== 0 || pointer || view.state.readOnly) return;
    pointer = new AbortController();
    const { signal } = pointer;
    function moveGuides(e: PointerEvent) {
      if (e.pointerId !== event.pointerId) return;
      const rect = view.dom.getBoundingClientRect();
      guides.style.setProperty("--guide-x", `${(e.clientX - rect.left) / view.scaleX}px`);
      guides.style.setProperty("--guide-y", `${(e.clientY - rect.top) / view.scaleY}px`);
    }
    function release(e: PointerEvent) {
      if (e.pointerId === event.pointerId) endGuides();
    }
    moveGuides(event);
    view.dom.append(guides);
    win.addEventListener("pointermove", moveGuides, { signal });
    win.addEventListener("pointerup", release, { signal });
    win.addEventListener("pointercancel", release, { signal });
    win.addEventListener("blur", endGuides, { signal });
    win.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") endGuides();
      },
      { signal, capture: true },
    );
  }

  frame.addEventListener("pointerdown", startGuides, true);

  function preview(next: number | null) {
    frame.style.width = next === null ? "" : `${next}px`;
    frame.toggleAttribute("data-sized", next !== null);
    view.requestMeasure();
  }

  for (const side of ["nw", "ne", "sw", "se", "w", "e"]) {
    const handle = frame.ownerDocument.createElement("div");
    handle.className = "cm-image-handle";
    handle.dataset.handle = side;
    handle.setAttribute("aria-hidden", "true");
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || cancel || view.state.readOnly) return;
      event.preventDefault();
      event.stopPropagation();
      view.focus();

      const start = frame.offsetWidth || width || 300;
      const ratio = frame.offsetHeight ? start / frame.offsetHeight : 1;
      const style = win.getComputedStyle(wrap);
      const column =
        wrap.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const max = Math.min(column > 0 ? column : MAX_DIAGRAM_WIDTH, MAX_DIAGRAM_WIDTH);
      const horizontal = side.endsWith("w") ? -1 : 1;
      const vertical = side.startsWith("n") ? -1 : side.startsWith("s") ? 1 : 0;
      let next = start;
      function move(e: PointerEvent) {
        if (e.pointerId !== event.pointerId) return;
        e.preventDefault();
        const dx = ((e.clientX - event.clientX) * horizontal) / view.scaleX;
        const dy = ((e.clientY - event.clientY) * vertical * ratio) / view.scaleY;
        const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
        next = Math.round(Math.min(max, Math.max(MIN_DIAGRAM_WIDTH, start + delta)));
        preview(next);
        badge.hidden = false;
        badge.textContent = `${next} px`;
      }
      function stop() {
        cancel = undefined;
        wrap.classList.remove("cm-mermaid-resizing");
        badge.hidden = true;
        win.removeEventListener("pointermove", move);
        win.removeEventListener("pointerup", up);
        win.removeEventListener("pointercancel", pointerCancel);
        win.removeEventListener("blur", abort);
        win.removeEventListener("keydown", key, true);
      }
      function abort() {
        stop();
        preview(width);
      }
      function up(e: PointerEvent) {
        if (e.pointerId !== event.pointerId) return;
        stop();
        if (next === start || !commit(next)) preview(width);
      }
      function pointerCancel(e: PointerEvent) {
        if (e.pointerId === event.pointerId) abort();
      }
      function key(e: KeyboardEvent) {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        abort();
      }
      cancel = stop;
      wrap.classList.add("cm-mermaid-resizing");
      win.addEventListener("pointermove", move);
      win.addEventListener("pointerup", up);
      win.addEventListener("pointercancel", pointerCancel);
      win.addEventListener("blur", abort);
      win.addEventListener("keydown", key, true);
    });
    frame.append(handle);
  }
  frame.append(badge);
  return () => {
    cancel?.();
    endGuides();
    frame.removeEventListener("pointerdown", startGuides, true);
  };
}
