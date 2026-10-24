import { EditorView } from "@codemirror/view";
import {
  readImageLayout,
  validCrop,
  writeImageLayout,
  type ImageLayout,
} from "../../lib/imageLayout";

/** All transforms belong to this occurrence in the note; the source image is untouched. */
export function imageTools(
  view: EditorView,
  wrap: HTMLElement,
  img: HTMLImageElement,
  source: string,
  editLink: () => void,
): () => void {
  const original = readImageLayout(source).layout;
  let current = structuredClone(original);
  let closed = false;
  const frame = document.createElement("div");
  frame.className = "cm-image-frame";
  img.draggable = false;
  frame.append(img);
  const toolbar = document.createElement("div");
  toolbar.className = "cm-image-tools";
  const button = (label: string, run: () => void, parent = toolbar) => {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = label;
    el.addEventListener("click", run);
    parent.append(el);
    return el;
  };
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
  const commit = (layout: ImageLayout) => {
    if (closed || view.state.readOnly || !wrap.isConnected) return false;
    const line = view.state.doc.lineAt(view.posAtDOM(wrap));
    if (line.text !== source) return false;
    const insert = writeImageLayout(source, layout);
    if (insert !== source) view.dispatch({ changes: { from: line.from, to: line.to, insert } });
    return true;
  };
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
  const actions = document.createElement("div");
  actions.className = "cm-image-tools";
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
    actions,
  );
  const cancel = () => {
    current = structuredClone(original);
    preview(current);
    editor.hidden = true;
    edit.focus();
    view.requestMeasure();
  };
  button("Cancel", cancel, actions);
  const apply = document.createElement("button");
  apply.type = "submit";
  apply.textContent = "Apply image changes";
  actions.append(apply);
  editor.append(dimensions, lockLabel, cropFields, message, actions);
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
  const edit = button("Edit image", () => {
    editor.hidden = !editor.hidden;
    if (!editor.hidden) {
      width.value = original.width === null ? "" : String(original.width);
      height.value = original.height === null ? "" : String(original.height);
      crop.forEach((input, i) => {
        input.value = String(original.crop[i]);
      });
      lock.checked = original.height === null;
      update();
      width.focus();
    } else {
      current = structuredClone(original);
      preview(current);
    }
    view.requestMeasure();
  });
  edit.disabled = view.state.readOnly;
  button("Edit link", editLink);
  wrap.replaceChildren(frame, toolbar, editor);
  // Controls are outside CodeMirror's editable text and keep native input events.
  wrap.contentEditable = "false";
  preview(current);
  return () => {
    closed = true;
    img.removeEventListener("load", onLoad);
  };
}
