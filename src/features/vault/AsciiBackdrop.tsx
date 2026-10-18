import { useEffect, useRef } from "react";
import { onThemeChange } from "../../app/appearance";
import {
  CELL,
  FONT_PX,
  cover,
  isLightColour,
  randomGlyph,
  starMask,
  tint,
  tintPosition,
} from "./asciiField";
import "./asciiBackdrop.css";

// The ASCII art behind the welcome screen: letters and digits inside a soft three-cusp
// star, tinted warm to cool (see asciiField.ts). Decorative only: hidden from screen
// readers, ignores the pointer, picks a tint for light or dark themes from --fg, draws a
// single still frame while the system asks for reduced motion (following changes to that
// setting live), and pauses while the window is hidden.

const FRAME_MS = 120; // a slow shimmer
/** Share of the glyphs that change each frame. */
const SHIMMER = 0.02;
/** Steps the tint and the fade are rounded to, so cells can be drawn in batches. */
const TINT_STEPS = 8;
const FADE_STEPS = 8;
/** Cells fainter than this aren't drawn. */
const MIN_MASK = 0.02;
/** Smallest text scale (12.5 px × 0.56 ≈ 7 px), for small windows. */
const MIN_TEXT_SCALE = 0.56;

interface Cell {
  x: number;
  y: number;
  glyph: string;
}

export function AsciiBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let still = motion?.matches ?? false;
    let width = 0;
    let height = 0;
    /** Visible cells, batched by fill style. */
    let batches: [style: string, cells: Cell[]][] = [];
    let cells: Cell[] = [];
    let fontPx = FONT_PX;
    let timer = 0;
    let disposed = false;

    /** Lay out the cells inside the star for the current size and theme. */
    function layout() {
      const rect = canvas!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const fg = getComputedStyle(canvas!).getPropertyValue("--fg");
      const light = isLightColour(fg);
      // Light text means a dark theme (the glass themes' --bg is see-through, --fg isn't).
      const dark = light ?? window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? true;

      const fit = cover(width, height);
      // The text scales with the star, as in the design; never below a readable size.
      const s = Math.max(fit.scale, MIN_TEXT_SCALE);
      const cw = CELL.width * s;
      const ch = CELL.height * s;
      fontPx = Math.round(FONT_PX * s * 10) / 10;
      const groups = new Map<string, Cell[]>();
      cells = [];
      const cols = Math.ceil(width / cw);
      const rows = Math.ceil(height / ch);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cw;
          const y = r * ch;
          // The cell's centre in the design frame.
          const fx = (x + cw / 2 - fit.x) / fit.scale;
          const fy = (y + ch / 2 - fit.y) / fit.scale;
          const mask = starMask(fx, fy);
          if (mask < MIN_MASK) continue;
          const t = Math.round(tintPosition(fx, fy) * TINT_STEPS) / TINT_STEPS;
          const m = Math.ceil(mask * FADE_STEPS) / FADE_STEPS;
          const [cr, cg, cb, ca] = tint(t, dark);
          const style = `rgba(${cr}, ${cg}, ${cb}, ${Math.round(ca * m * 1000) / 1000})`;
          const cell = { x, y, glyph: randomGlyph() };
          cells.push(cell);
          const group = groups.get(style);
          if (group) group.push(cell);
          else groups.set(style, [cell]);
        }
      }
      batches = [...groups];
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      if (width === 0 || height === 0) return;
      ctx!.font = `${fontPx}px "JetBrains Mono", "Cascadia Mono", ui-monospace, Consolas, monospace`;
      ctx!.textBaseline = "top";
      for (const [style, group] of batches) {
        ctx!.fillStyle = style;
        for (const cell of group) ctx!.fillText(cell.glyph, cell.x, cell.y);
      }
    }

    function shimmer() {
      const n = Math.max(1, Math.round(cells.length * SHIMMER));
      for (let i = 0; i < n && cells.length; i++) {
        cells[Math.floor(Math.random() * cells.length)]!.glyph = randomGlyph();
      }
    }

    function tick() {
      if (disposed || still) return;
      if (!document.hidden) {
        shimmer();
        draw();
      }
      timer = window.setTimeout(tick, FRAME_MS);
    }

    // Animate, or draw one still frame under reduced motion.
    function start() {
      window.clearTimeout(timer);
      draw();
      if (!still) timer = window.setTimeout(tick, FRAME_MS);
    }

    // Size and tint: on resize, and on theme changes (the app's theme setting, or the
    // system's light/dark switch under "Match system", which changes --fg via CSS only).
    function refresh() {
      layout();
      draw();
    }

    function onMotionChange() {
      still = motion?.matches ?? false;
      start();
    }

    const observer = new ResizeObserver(refresh);
    observer.observe(canvas);
    const stopThemeWatch = onThemeChange(refresh);
    motion?.addEventListener?.("change", onMotionChange);

    layout();
    start();

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      observer.disconnect();
      stopThemeWatch();
      motion?.removeEventListener?.("change", onMotionChange);
    };
  }, []);

  return <canvas ref={ref} className="ascii-backdrop" aria-hidden="true" />;
}
