import { File, FileText, Folder, type LucideIcon, Shapes, Sheet } from "lucide-react";
import type { FolderIcon } from "../../app/config";
import { backend } from "../../ipc";
import { docKind } from "../../lib/fileKinds";
import { lucideSvg } from "../editor/lucideSvg";
import { imageIconPath, isLucide, loadAllIcons, lucideFor } from "../icons/iconSet";
import { TEXT_COLOR } from "../packs/packs";

// Icons for graph and tree nodes: the custom icon set on the file (the same one the file
// tree and page header show), else one for its kind. The tree draws them with React; the
// force graph paints them onto sigma's label canvas, so Lucide icons and image icons are
// turned into images first and the graph is redrawn once they have loaded.

export interface NodeIcon {
  /** The icon chosen for the file or folder, if any. */
  custom: FolderIcon | null;
  /** The icon for its kind, shown when there's no custom icon or it can't be drawn. */
  kind: LucideIcon;
}

/** A node's icon. Folder ids end with "/"; unresolved links have no file to set one on. */
export function nodeIcon(
  id: string,
  icons: Readonly<Record<string, FolderIcon>>,
  opts: { folder?: boolean; unresolved?: boolean } = {},
): NodeIcon {
  if (opts.unresolved) return { custom: null, kind: File };
  if (opts.folder) return { custom: icons[id.replace(/\/$/, "")] ?? null, kind: Folder };
  const kind = docKind(id);
  return {
    custom: icons[id] ?? null,
    kind: kind === "grid" ? Sheet : kind === "canvas" ? Shapes : FileText,
  };
}

/** Pixel size Lucide icons are rasterized at, so they stay sharp when scaled down. */
const RASTER = 64;

interface Loaded {
  img: HTMLImageElement;
  state: "loading" | "ready" | "failed";
  waiting: Set<() => void>;
}

const images = new Map<string, Loaded>();

/** An image, loaded once and shared by every graph; `onReady` hears when it's drawable. */
function image(src: string, onReady: () => void): Loaded {
  let entry = images.get(src);
  if (!entry) {
    const img = new Image();
    const loaded: Loaded = { img, state: "loading", waiting: new Set() };
    const settle = (state: Loaded["state"]) => {
      loaded.state = state;
      for (const fn of loaded.waiting) fn();
      loaded.waiting.clear();
    };
    img.onload = () => settle("ready");
    img.onerror = () => settle("failed");
    img.src = src;
    images.set(src, (entry = loaded));
  }
  if (entry.state === "loading") entry.waiting.add(onReady);
  return entry;
}

const sources = new WeakMap<LucideIcon, Map<string, string>>();

/** A Lucide icon in `color` as an image URL, made once per icon and colour. */
function lucideSrc(icon: LucideIcon, color: string): string {
  let byColor = sources.get(icon);
  if (!byColor) sources.set(icon, (byColor = new Map()));
  let src = byColor.get(color);
  if (!src) {
    const svg = lucideSvg(icon, RASTER);
    svg.setAttribute("stroke", color);
    src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.outerHTML);
    byColor.set(color, src);
  }
  return src;
}

export interface IconPainter {
  /** Paint `icon` in the `size` square at (x, y), in `color` unless it has its own. */
  draw(ctx: CanvasRenderingContext2D, icon: NodeIcon, x: number, y: number, size: number): void;
  /** Stop calling `onReady` (the graph it redraws is gone). */
  dispose(): void;
}

/**
 * Paints node icons onto a canvas. Anything not loaded yet is skipped (or drawn as the
 * kind icon) and `onReady` is called, at most once a frame, when it can be drawn.
 */
export function createIconPainter(color: string, onReady: () => void): IconPainter {
  let disposed = false;
  let frame = 0;
  const ready = () => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!disposed) onReady();
    });
  };
  let loadingAll = false;

  /** Draw an image source; false if it can't be drawn (yet). */
  const drawSrc = (
    ctx: CanvasRenderingContext2D,
    src: string,
    x: number,
    y: number,
    size: number,
  ) => {
    const entry = image(src, ready);
    if (entry.state !== "ready") return false;
    ctx.drawImage(entry.img, x, y, size, size);
    return true;
  };

  // Image icons with a colour (one-colour icon packs) are drawn as a silhouette in that
  // colour, like the CSS mask elsewhere. Tinted copies are kept per power-of-two size, so
  // zooming doesn't make a new one every frame.
  const tinted = new Map<string, HTMLCanvasElement>();
  const drawTinted = (
    ctx: CanvasRenderingContext2D,
    src: string,
    tint: string,
    x: number,
    y: number,
    size: number,
  ) => {
    const entry = image(src, ready);
    if (entry.state !== "ready") return false;
    const want = size * (window.devicePixelRatio || 1);
    const px = Math.min(256, 2 ** Math.ceil(Math.log2(Math.max(8, want))));
    const key = `${src}|${tint}|${px}`;
    let copy = tinted.get(key);
    if (!copy) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = px;
      const t = canvas.getContext("2d");
      if (!t) return false;
      t.drawImage(entry.img, 0, 0, px, px);
      t.globalCompositeOperation = "source-in";
      t.fillStyle = tint;
      t.fillRect(0, 0, px, px);
      tinted.set(key, (copy = canvas));
    }
    ctx.drawImage(copy, x, y, size, size);
    return true;
  };

  const drawCustom = (
    ctx: CanvasRenderingContext2D,
    icon: FolderIcon,
    x: number,
    y: number,
    size: number,
  ): boolean => {
    const path = imageIconPath(icon.icon);
    if (path !== null) {
      const url = backend.fileUrl(path);
      if (url === null) return false;
      // "currentColor" means the text colour, which on the canvas is the icons' colour.
      const tint = icon.color === TEXT_COLOR ? color : icon.color;
      return tint ? drawTinted(ctx, url, tint, x, y, size) : drawSrc(ctx, url, x, y, size);
    }
    if (isLucide(icon.icon)) {
      const lucide = lucideFor(icon.icon);
      if (lucide) return drawSrc(ctx, lucideSrc(lucide, icon.color ?? color), x, y, size);
      if (!loadingAll) {
        loadingAll = true;
        loadAllIcons().then(ready, () => {});
      }
      return false;
    }
    // An emoji (or any text).
    ctx.save();
    ctx.font = `${size - 1}px sans-serif`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    if (icon.color) ctx.fillStyle = icon.color;
    ctx.fillText(icon.icon, x + size / 2, y + size / 2 + 1);
    ctx.restore();
    return true;
  };

  return {
    draw(ctx, icon, x, y, size) {
      if (icon.custom && drawCustom(ctx, icon.custom, x, y, size)) return;
      drawSrc(ctx, lucideSrc(icon.kind, color), x, y, size);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
    },
  };
}
