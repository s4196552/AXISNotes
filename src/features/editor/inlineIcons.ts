import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import { backend } from "../../ipc";
import { mediaKind, parseMarkdownEmbed } from "../../lib/attachments";
import { loadAllIcons, lucideFor } from "../icons/iconSet";
import { lucideSvg } from "./lucideSvg";

export const ICON_PACK_ROOT = ".axisnotes/packs/icons/";

/** Recognize the destinations reserved for inline icons in notes. */
export function inlineIconTarget(src: string) {
  if (/^lucide:[A-Z][A-Za-z0-9]*$/.test(src)) return src;
  const path = src.replace(/^\//, "");
  if (!path.startsWith(ICON_PACK_ROOT) || path.split("/").length < 5) return null;
  if (/[:\\]/.test(path) || path.split("/").some((part) => !part || part === "." || part === ".."))
    return null;
  return mediaKind(path) === "image" ? path : null;
}

export function inlineIconMarkdown(label: string, target: string) {
  const alt = label.replace(/[[\]\\|\r\n]/g, " ").trim();
  const src = target.startsWith("lucide:")
    ? target
    : "/" + target.split("/").map(encodeURIComponent).join("/");
  return `![${alt}](<${src}>)`;
}

export function iconGraphic(target: string, label: string) {
  if (target.startsWith("lucide:")) {
    const icon = lucideFor(target);
    return icon ? lucideSvg(icon, 16) : null;
  }
  const url = backend.fileUrl(target);
  if (!url) return null;
  const image = document.createElement("img");
  image.src = url;
  image.alt = label;
  image.draggable = false;
  return image;
}

class InlineIcon extends WidgetType {
  constructor(
    readonly target: string,
    readonly label: string,
  ) {
    super();
  }

  eq(other: InlineIcon) {
    return this.target === other.target && this.label === other.label;
  }

  toDOM(view: EditorView) {
    const icon = document.createElement("span");
    icon.className = "cm-inline-note-icon";
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", this.label);
    icon.title = this.label;
    const show = () => {
      const graphic = iconGraphic(this.target, this.label);
      icon.replaceChildren(graphic ?? document.createTextNode(this.label));
      return Boolean(graphic);
    };
    if (!show() && this.target.startsWith("lucide:"))
      void loadAllIcons().then(
        () => {
          if (icon.isConnected) show();
        },
        () => {},
      );
    icon.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: view.posAtDOM(icon) + 2 } });
      view.focus();
    });
    return icon;
  }
}

function decorations(view: EditorView) {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "Image" || node.from < from || node.to > to) return;
        const image = parseMarkdownEmbed(state.sliceDoc(node.from, node.to));
        const target = image && inlineIconTarget(image.src);
        if (!target || !image) return;
        if (
          view.hasFocus &&
          state.selection.ranges.some((r) => r.from < node.to && r.to > node.from)
        )
          return;
        out.push(
          Decoration.replace({ widget: new InlineIcon(target, image.alt || "Icon") }).range(
            node.from,
            node.to,
          ),
        );
      },
    });
  }
  return Decoration.set(out, true);
}

const icons = ViewPlugin.define(
  (view) => ({
    decorations: decorations(view),
    update(update) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.focusChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      )
        this.decorations = decorations(update.view);
    },
  }),
  { decorations: (value) => value.decorations },
);

export const inlineIcons = [
  icons,
  EditorView.atomicRanges.of((view) => view.plugin(icons)?.decorations ?? Decoration.none),
];
