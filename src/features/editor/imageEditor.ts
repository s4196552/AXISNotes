import {
  EditorState,
  MapMode,
  Prec,
  StateEffect,
  StateField,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import {
  Copy,
  Crop,
  ExternalLink,
  type LucideIcon,
  RotateCcw,
  SquarePen,
  Trash2,
} from "lucide-react";
import {
  DEFAULT_IMAGE_LAYOUT,
  readImageLayout,
  validCrop,
  writeImageLayout,
  type ImageLayout,
} from "../../lib/imageLayout";
import { lucideSvg } from "./lucideSvg";

// Images in a note (T-154): click once to select (an outline; the cursor stays where it
// was), double-click to open, press and drag to put the embed on another line (Ctrl or
// Alt copies it), drag the handles on its corners and sides to resize. The size is
// written back as Obsidian's `|width`. Right-click has the rest: edit the link, copy,
// crop and exact size, reset, delete. Dragging uses pointer events: the desktop webview
// swallows HTML drag and drop on Windows (as in the file tree).

// ---- Which image is selected ----

const selectImage = StateEffect.define<number | null>();

/** Where the line of the selected image starts, or null. Moving the cursor clears it. */
export const imageSelection = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(selectImage)) return e.value;
    if (value === null || tr.selection) return null;
    return tr.docChanged ? tr.changes.mapPos(value, 1, MapMode.TrackDel) : value;
  },
});

const lineFromOf = (view: EditorView, wrap: HTMLElement) =>
  view.state.doc.lineAt(view.posAtDOM(wrap)).from;

/** The image widgets of this editor (not those inside an embedded note's editor). */
const imageWraps = (view: EditorView) =>
  [...view.contentDOM.querySelectorAll<HTMLElement>('.cm-image-embed[data-kind="image"]')].filter(
    (wrap) => wrap.closest(".cm-editor") === view.dom,
  );

/** Outline the selected image, and hide the text cursor while one is selected. */
const showSelection = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.schedule();
    }
    update(u: { docChanged: boolean; viewportChanged: boolean; startState: EditorState }) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.startState.field(imageSelection, false) !== this.view.state.field(imageSelection, false)
      )
        this.schedule();
    }
    schedule() {
      // After CodeMirror has drawn: a moved image's widget is new.
      this.view.requestMeasure({ key: this, read: () => null, write: () => this.sync() });
    }
    sync() {
      const at = this.view.state.field(imageSelection, false) ?? null;
      this.view.dom.classList.toggle("cm-image-selecting", at !== null);
      for (const wrap of imageWraps(this.view))
        wrap.classList.toggle(
          "cm-image-selected",
          at !== null && lineFromOf(this.view, wrap) === at,
        );
    }
  },
);

/** The embed line `at` starts, as it is now (null if it's gone). */
function embedLine(state: EditorState, at: number) {
  if (at > state.doc.length) return null;
  const line = state.doc.lineAt(at);
  return line.from === at ? line : null;
}

/** Changes that take line `n` out of the note. With blank lines on both sides, one of
 *  them goes too, so moving an image doesn't leave a gap behind. */
function removeLine(state: EditorState, n: number, keepNext = false) {
  const doc = state.doc;
  const line = doc.line(n);
  const blank = (k: number) => k >= 1 && k <= doc.lines && doc.line(k).text.trim() === "";
  if (!keepNext && blank(n - 1) && blank(n + 1))
    return { from: line.from, to: Math.min(doc.line(n + 1).to + 1, doc.length) };
  if (n < doc.lines) return { from: line.from, to: line.to + 1 };
  if (n > 1) return { from: doc.line(n - 1).to, to: line.to };
  return { from: 0, to: doc.length };
}

/** Delete the embed on the line starting at `at`. */
export function deleteEmbed(view: EditorView, at: number) {
  const line = embedLine(view.state, at);
  if (!line || view.state.readOnly) return;
  view.dispatch({
    changes: removeLine(view.state, line.number),
    effects: selectImage.of(null),
    userEvent: "delete",
  });
}

/**
 * Put embed line `src` after line `after` (0: at the top), moving it or, with `copy`,
 * copying it. Null when that changes nothing. The image stays selected in its new place,
 * and the cursor stays off its line (a line with the cursor shows its text instead).
 */
export function relocateEmbed(
  state: EditorState,
  src: number,
  after: number,
  copy: boolean,
): TransactionSpec | null {
  const doc = state.doc;
  if (src < 1 || src > doc.lines || after < 0 || after > doc.lines) return null;
  if (!copy && (after === src || after === src - 1)) return null;
  const text = doc.line(src).text;
  // A blank line between the image and text next to it, so it stays its own paragraph
  // (the line it leaves behind is tidied the same way).
  const isText = (k: number) =>
    k >= 1 && k <= doc.lines && (copy || k !== src) && doc.line(k).text.trim() !== "";
  const padAbove = isText(after) ? "\n" : "";
  const padBelow = isText(after + 1) ? "\n" : "";
  const insertAt = after === 0 ? 0 : doc.line(after).to;
  const insert = after === 0 ? text + "\n" + padBelow : "\n" + padAbove + text + padBelow;
  const specs = [{ from: insertAt, insert }];
  if (!copy) specs.push({ ...removeLine(state, src, after === src + 1), insert: "" });
  const changes = state.changes(specs);
  const at = changes.mapPos(insertAt, -1) + (after === 0 ? 0 : 1 + padAbove.length);
  const assoc = after === 0 ? 1 : -1;
  return {
    changes,
    selection: state.selection.map(changes, assoc),
    effects: selectImage.of(at),
    userEvent: copy ? "input.copy" : "move.drop",
    scrollIntoView: false,
  };
}

// ---- Keys and the clipboard while an image is selected ----

const selectionKeys = Prec.highest(
  EditorView.domEventHandlers({
    keydown(e, view) {
      const at = view.state.field(imageSelection, false) ?? null;
      if (at === null || e.target !== view.contentDOM) return false;
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return false;
      // The browser sends keydown before copy/cut: keep the image selected until
      // those handlers copy its embed, rather than acting on the old text cursor.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[cx]$/i.test(e.key)) return false;
      const line = embedLine(view.state, at);
      if (line && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        deleteEmbed(view, at);
        return true;
      }
      if (line && e.key === "Enter") {
        e.preventDefault();
        view.dispatch({ selection: { anchor: line.to }, effects: selectImage.of(null) });
        return true;
      }
      // Anything else (Escape, arrows, typing) lets go of the image, then goes ahead.
      view.dispatch({ effects: selectImage.of(null) });
      if (e.key === "Escape") {
        e.preventDefault();
        return true;
      }
      return false;
    },
    copy: (e, view) => copyOrCut(e, view, false),
    cut: (e, view) => copyOrCut(e, view, true),
    mousedown(_e, view) {
      // A click in the text lets go of the image (an image's own clicks don't get here).
      if (view.state.field(imageSelection, false) !== null)
        view.dispatch({ effects: selectImage.of(null) });
      return false;
    },
  }),
);

/** Ctrl+C / Ctrl+X on a selected image copy its embed, which pastes back as the image. */
function copyOrCut(e: ClipboardEvent, view: EditorView, cut: boolean) {
  const at = view.state.field(imageSelection, false) ?? null;
  const line = at === null ? null : embedLine(view.state, at);
  if (!line || !e.clipboardData) return false;
  e.preventDefault();
  e.clipboardData.setData("text/plain", line.text);
  if (cut) deleteEmbed(view, line.from);
  return true;
}

/** Selecting, the outline and the keys for images; part of `embeds()`. */
export const imageSelecting = [imageSelection, showSelection, selectionKeys];

// ---- The right-click menu ----

let closeOpenMenu: (() => void) | null = null;

interface MenuItem {
  label: string;
  icon: LucideIcon;
  run: () => void;
  danger?: boolean;
}

function openMenu(x: number, y: number, items: MenuItem[]) {
  closeOpenMenu?.();
  const menu = document.createElement("div");
  menu.className = "filetree-menu cm-image-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Image");
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  for (const item of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    if (item.danger) b.className = "danger";
    const icon = lucideSvg(item.icon);
    icon.classList.add("menu-icon");
    b.append(icon, item.label);
    b.addEventListener("click", () => {
      close();
      item.run();
    });
    menu.append(b);
  }
  // Clicking the menu keeps the editor focused.
  menu.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  const close = () => {
    menu.remove();
    window.removeEventListener("mousedown", close);
    window.removeEventListener("blur", close);
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("keydown", onKey, true);
    if (closeOpenMenu === close) closeOpenMenu = null;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  window.addEventListener("mousedown", close);
  window.addEventListener("blur", close);
  window.addEventListener("scroll", close, true);
  window.addEventListener("keydown", onKey, true);
  closeOpenMenu = close;
  document.body.append(menu);
  // Keep it in the window.
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = `${Math.max(0, x - r.width)}px`;
  if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(0, y - r.height)}px`;
}

// ---- Dragging an image to another line ----

/** Where dropping at (x, y) puts the image: after line `after`, drawn at `y`. */
export function dropTarget(view: EditorView, x: number, y: number) {
  const r = view.dom.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  const top = view.documentTop;
  const block = view.lineBlockAtHeight(y - top);
  const doc = view.state.doc;
  return y < top + block.top + block.height / 2
    ? { after: doc.lineAt(block.from).number - 1, y: top + block.top }
    : { after: doc.lineAt(block.to).number, y: top + block.bottom };
}

/** The nearest element that scrolls the note up and down. */
function scrollerOf(view: EditorView): HTMLElement {
  for (let el: HTMLElement | null = view.scrollDOM; el; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))
      return el;
  }
  return view.scrollDOM;
}

const DRAG_START = 5;
const MIN_WIDTH = 24;

export interface ImageActions {
  /** Show the embed's text for editing. */
  editLink(): void;
  /** Open the image itself (in a new tab with Ctrl). */
  open(newTab: boolean): void;
}

/** All transforms belong to this occurrence in the note; the source image is untouched. */
export function imageTools(
  view: EditorView,
  wrap: HTMLElement,
  img: HTMLImageElement,
  source: string,
  actions: ImageActions,
): () => void {
  const original = readImageLayout(source).layout;
  let current = structuredClone(original);
  let closed = false;
  const readOnly = view.state.readOnly;
  const box = document.createElement("div");
  box.className = "cm-image-box";
  const frame = document.createElement("div");
  frame.className = "cm-image-frame";
  img.draggable = false;
  frame.append(img);
  box.append(frame);
  const ratio = (layout: ImageLayout) => {
    const [left, top, right, bottom] = layout.crop;
    return (
      ((img.naturalWidth || 400) * (100 - left - right)) /
      ((img.naturalHeight || 300) * (100 - top - bottom))
    );
  };
  const preview = (layout: ImageLayout) => {
    const [left, top, right, bottom] = layout.crop;
    const x = 100 - left - right,
      y = 100 - top - bottom;
    const naturalWidth = ((img.naturalWidth || 400) * x) / 100;
    const width = layout.width ?? (layout.height ? layout.height * ratio(layout) : naturalWidth);
    frame.style.width = `${width}px`;
    frame.style.aspectRatio = String(layout.height ? width / layout.height : ratio(layout));
    img.style.width = `${10000 / x}%`;
    img.style.height = `${10000 / y}%`;
    img.style.left = `${(-100 * left) / x}%`;
    img.style.top = `${(-100 * top) / y}%`;
    if (layout.width) img.width = layout.width;
    else img.removeAttribute("width");
    if (layout.height) img.height = layout.height;
    else img.removeAttribute("height");
    view.requestMeasure();
  };
  const onLoad = () => {
    if (!closed) preview(current);
  };
  img.addEventListener("load", onLoad);
  /** This image's line, if it still holds this embed. */
  const ownLine = () => {
    if (closed || !wrap.isConnected) return null;
    const line = view.state.doc.lineAt(view.posAtDOM(wrap));
    return line.text === source ? line : null;
  };
  const commit = (layout: ImageLayout) => {
    if (view.state.readOnly) return false;
    const line = ownLine();
    if (!line) return false;
    const insert = writeImageLayout(source, layout);
    // The line is rewritten, so a selected image is selected again on it.
    const selected = view.state.field(imageSelection, false) === line.from;
    if (insert !== source)
      view.dispatch({
        changes: { from: line.from, to: line.to, insert },
        effects: selected ? selectImage.of(line.from) : [],
      });
    return true;
  };
  const select = () => {
    const line = ownLine();
    if (line) view.dispatch({ effects: selectImage.of(line.from) });
  };

  // ---- Crop and exact size (from the right-click menu) ----
  const editor = document.createElement("form");
  editor.className = "cm-image-controls";
  editor.hidden = true;
  editor.setAttribute("aria-label", "Image size and crop");
  const fields: HTMLInputElement[] = [];
  const field = (label: string, initial: number | null, maximum: number, parent: HTMLElement) => {
    const container = document.createElement("label");
    container.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = maximum === 9999 ? "1" : "0";
    input.max = String(maximum);
    input.step = maximum === 9999 ? "1" : "0.1";
    input.value = initial === null ? "" : String(initial);
    input.setAttribute("aria-label", label);
    container.append(input);
    parent.append(container);
    fields.push(input);
    return input;
  };
  const button = (label: string, run: () => void, parent: HTMLElement) => {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    el.addEventListener("click", run);
    parent.append(el);
    return el;
  };
  const dimensions = document.createElement("div");
  dimensions.className = "cm-image-dimensions";
  const width = field("Width (px)", original.width, 9999, dimensions);
  const height = field("Height (px)", original.height, 9999, dimensions);
  const lockLabel = document.createElement("label");
  const lock = document.createElement("input");
  lock.type = "checkbox";
  lock.checked = original.height === null;
  lockLabel.append(lock, document.createTextNode("Keep proportions"));
  const cropFields = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = "Crop edges (%)";
  cropFields.append(legend);
  const crop = ["Left", "Top", "Right", "Bottom"].map((label, i) =>
    field(`${label} crop (%)`, original.crop[i]!, 99.9, cropFields),
  );
  const message = document.createElement("p");
  message.className = "cm-image-message";
  message.setAttribute("role", "status");
  const read = (): ImageLayout | null => {
    if (!fields.every((input) => input.checkValidity())) return null;
    const values = crop.map((input) => (input.value === "" ? NaN : input.valueAsNumber));
    if (!validCrop(values)) return null;
    return {
      width: width.value === "" ? null : width.valueAsNumber,
      height: height.value === "" ? null : height.valueAsNumber,
      crop: values,
    };
  };
  const update = () => {
    const next = read();
    message.textContent = next
      ? "Changes apply to this image in this note. The original stays intact."
      : "Use dimensions from 1–9999 px and leave some image visible on both axes.";
    if (next) {
      current = next;
      preview(next);
    }
  };
  width.addEventListener("input", () => {
    // A width alone already preserves the original cropped proportions.
    if (lock.checked) height.value = "";
    update();
  });
  height.addEventListener("input", () => {
    if (lock.checked && height.value && height.checkValidity())
      width.value = String(
        Math.max(1, Math.min(9999, Math.round(height.valueAsNumber * ratio(current)))),
      );
    update();
  });
  lock.addEventListener("change", () => {
    if (lock.checked) height.value = "";
    update();
  });
  crop.forEach((input) => input.addEventListener("input", update));
  const formActions = document.createElement("div");
  formActions.className = "cm-image-tools";
  button(
    "Reset size and crop",
    () => {
      width.value = height.value = "";
      crop.forEach((input) => {
        input.value = "0";
      });
      lock.checked = true;
      update();
    },
    formActions,
  );
  const cancel = () => {
    current = structuredClone(original);
    preview(current);
    editor.hidden = true;
    view.focus();
    view.requestMeasure();
  };
  button("Cancel", cancel, formActions);
  const apply = document.createElement("button");
  apply.type = "submit";
  apply.textContent = "Apply image changes";
  formActions.append(apply);
  editor.append(dimensions, lockLabel, cropFields, message, formActions);
  editor.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = read();
    if (!next) {
      update();
      return;
    }
    if (!commit(next))
      message.textContent = "The image link changed. Reopen its controls and try again.";
    else {
      editor.hidden = true;
      view.requestMeasure();
    }
  });
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  });
  const openControls = () => {
    width.value = original.width === null ? "" : String(original.width);
    height.value = original.height === null ? "" : String(original.height);
    crop.forEach((input, i) => {
      input.value = String(original.crop[i]);
    });
    lock.checked = original.height === null;
    editor.hidden = false;
    update();
    width.focus();
    view.requestMeasure();
  };

  // ---- Resizing by the handles ----
  const badge = document.createElement("div");
  badge.className = "cm-image-size";
  badge.hidden = true;
  let resizing: { stop: () => void } | null = null;
  const startResize = (e: PointerEvent, handle: string) => {
    const startWidth =
      frame.getBoundingClientRect().width || current.width || img.naturalWidth || 400;
    const startHeight = frame.getBoundingClientRect().height || current.height || 0;
    const shape = current.height && current.width ? current.height / current.width : null;
    const dirX = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
    const dirY = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
    const proportion = startHeight > 0 ? startWidth / startHeight : ratio(current);
    // Not wider than the text column (it would only show that wide).
    const column = view.contentDOM.clientWidth;
    const max = Math.min(9999, column > 0 ? column : 9999);
    let next: ImageLayout | null = null;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      ev.preventDefault();
      const dx = (ev.clientX - e.clientX) * dirX;
      const dy = (ev.clientY - e.clientY) * dirY * proportion;
      const grow = dirY === 0 ? dx : dirX === 0 ? dy : Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      const w = Math.round(Math.max(MIN_WIDTH, Math.min(max, startWidth + grow)));
      next = { ...current, width: w, height: shape ? Math.max(1, Math.round(w * shape)) : null };
      preview(next);
      badge.hidden = false;
      badge.textContent = `${w} × ${Math.round(next.height ?? w / ratio(next))}`;
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("keydown", onKey, true);
      wrap.classList.remove("cm-image-resizing");
      badge.hidden = true;
      resizing = null;
    };
    const abort = () => {
      stop();
      preview(current);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      stop();
      if (!next || next.width === original.width) return preview(current);
      if (commit(next)) current = next;
      else preview(current);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      abort();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", abort);
    window.addEventListener("keydown", onKey, true);
    wrap.classList.add("cm-image-resizing");
    resizing = { stop: abort };
  };
  if (!readOnly) {
    for (const handle of ["nw", "ne", "sw", "se", "w", "e"]) {
      const el = document.createElement("div");
      el.className = "cm-image-handle";
      el.dataset.handle = handle;
      el.setAttribute("aria-hidden", "true");
      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || resizing) return;
        e.preventDefault();
        e.stopPropagation();
        view.focus();
        select();
        startResize(e, handle);
      });
      box.append(el);
    }
    box.append(badge);
  }

  // ---- Selecting, opening and dragging the image ----
  let dragging: { stop: () => void } | null = null;
  const startDrag = (e: PointerEvent) => {
    let started = false;
    let target: { after: number; y: number } | null = null;
    let x = e.clientX,
      y = e.clientY,
      copy = false,
      frameId: number | undefined;
    const marker = document.createElement("div");
    marker.className = "cm-image-drop-line";
    const ghost = document.createElement("img");
    ghost.className = "cm-image-ghost";
    ghost.src = img.src;
    ghost.alt = "";
    const scroller = scrollerOf(view);
    const srcLine = () => ownLine()?.number ?? null;
    const place = () => {
      const src = srcLine();
      target = dropTarget(view, x, y);
      const useful =
        target && src !== null && (copy || (target.after !== src && target.after !== src - 1));
      marker.hidden = !useful;
      if (target && useful) {
        const r = view.contentDOM.getBoundingClientRect();
        marker.style.left = `${r.left}px`;
        marker.style.width = `${r.width}px`;
        marker.style.top = `${target.y - 1}px`;
      }
      ghost.style.left = `${x + 12}px`;
      ghost.style.top = `${y + 12}px`;
      ghost.classList.toggle("copy", copy);
      document.body.classList.toggle("cm-image-drag-copy", copy);
    };
    // Scroll while held near the top or bottom of the note.
    const tick = () => {
      const r = scroller.getBoundingClientRect();
      const edge = Math.min(40, r.height / 4);
      const step = y < r.top + edge ? -12 : y > r.bottom - edge ? 12 : 0;
      if (step) {
        scroller.scrollTop += step;
        place();
      }
      frameId = requestAnimationFrame(tick);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      if (ev.pointerType === "mouse" && (ev.buttons & 1) === 0) return stop();
      x = ev.clientX;
      y = ev.clientY;
      copy = ev.ctrlKey || ev.altKey || ev.metaKey;
      if (!started) {
        if (Math.hypot(x - e.clientX, y - e.clientY) < DRAG_START) return;
        started = true;
        wrap.classList.add("cm-image-dragging");
        document.body.classList.add("cm-image-drag-active");
        document.body.append(marker, ghost);
        frameId = requestAnimationFrame(tick);
      }
      ev.preventDefault();
      place();
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const wasDragging = started;
      x = ev.clientX;
      y = ev.clientY;
      copy = ev.ctrlKey || ev.altKey || ev.metaKey;
      const src = srcLine();
      const drop = wasDragging ? dropTarget(view, x, y) : null;
      stop();
      if (!drop || src === null || view.state.readOnly) return;
      const spec = relocateEmbed(view.state, src, drop.after, copy);
      if (spec) view.dispatch(spec);
      view.focus();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        stop();
      } else if (started && ["Control", "Alt", "Meta"].includes(ev.key)) {
        copy = ev.type === "keydown";
        place();
      }
    };
    const stop = () => {
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      marker.remove();
      ghost.remove();
      wrap.classList.remove("cm-image-dragging");
      document.body.classList.remove("cm-image-drag-active", "cm-image-drag-copy");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      dragging = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    dragging = { stop };
  };
  frame.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // Keep the click off CodeMirror (no cursor into the embed's text) and the webview's
    // own image dragging; the editor keeps the keyboard for Delete, Enter and Ctrl+C.
    e.preventDefault();
    view.focus();
    select();
    if (!view.state.readOnly && !dragging && !resizing) startDrag(e);
  });
  frame.addEventListener("dblclick", (e) => {
    e.preventDefault();
    actions.open(e.ctrlKey || e.metaKey);
  });
  frame.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    view.focus();
    select();
    const editable = !view.state.readOnly;
    const sized =
      original.width !== null ||
      original.height !== null ||
      original.crop.some((n, i) => n !== DEFAULT_IMAGE_LAYOUT.crop[i]);
    const items: MenuItem[] = [
      { label: "Open image", icon: ExternalLink, run: () => actions.open(false) },
      { label: "Edit link", icon: SquarePen, run: actions.editLink },
      {
        label: "Copy embed",
        icon: Copy,
        run: () => void navigator.clipboard?.writeText(source).catch(() => {}),
      },
    ];
    if (editable) {
      items.push({ label: "Crop and exact size…", icon: Crop, run: openControls });
      if (sized)
        items.push({
          label: "Reset size and crop",
          icon: RotateCcw,
          run: () => void commit(DEFAULT_IMAGE_LAYOUT),
        });
      items.push({
        label: "Delete image",
        icon: Trash2,
        danger: true,
        run: () => {
          const line = ownLine();
          if (line) deleteEmbed(view, line.from);
        },
      });
    }
    openMenu(e.clientX, e.clientY, items);
  });
  wrap.replaceChildren(box, editor);
  wrap.classList.toggle("cm-image-editable", !readOnly);
  // Controls are outside CodeMirror's editable text and keep native input events.
  wrap.contentEditable = "false";
  preview(current);
  return () => {
    closed = true;
    dragging?.stop();
    resizing?.stop();
    img.removeEventListener("load", onLoad);
  };
}
