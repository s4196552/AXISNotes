import { useEffect, useRef } from "react";
import { ASCII_RAMP, CELL, brightness, glyphFor } from "./asciiField";
import "./asciiBackdrop.css";

// Faint animated ASCII art behind the welcome screen. Decorative only: hidden from
// screen readers, ignores the pointer, takes its colour from the theme's --fg, draws a
// single still frame when the system asks for reduced motion, and pauses while the
// window is hidden.

const FRAME_MS = 80; // ~12 fps is plenty for slow drift
const ALPHA_LEVELS = 6; // glyphs are batched by opacity to limit fillStyle changes

export function AsciiBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let width = 0;
    let height = 0;
    let colour = "#888";
    let timer = 0;
    let disposed = false;

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      colour = getComputedStyle(canvas!).getPropertyValue("--fg").trim() || colour;
    }

    function draw(t: number) {
      ctx!.clearRect(0, 0, width, height);
      if (width === 0 || height === 0) return;
      const cols = Math.ceil(width / CELL.width);
      const rows = Math.ceil(height / CELL.height);
      const aspect = width / height;
      const levels: [glyph: string, x: number, y: number][][] = Array.from(
        { length: ALPHA_LEVELS },
        () => [],
      );
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const v = brightness(c / cols, r / rows, t, aspect);
          const glyph = glyphFor(v);
          if (glyph === ASCII_RAMP[0]) continue;
          const level = Math.min(ALPHA_LEVELS - 1, Math.floor(v * ALPHA_LEVELS));
          levels[level]?.push([glyph, c * CELL.width, r * CELL.height]);
        }
      }
      ctx!.font = `${CELL.height - 2}px ui-monospace, Consolas, "Cascadia Mono", monospace`;
      ctx!.textBaseline = "top";
      ctx!.fillStyle = colour;
      levels.forEach((batch, l) => {
        ctx!.globalAlpha = 0.05 + (l / (ALPHA_LEVELS - 1)) * 0.13;
        for (const [glyph, x, y] of batch) ctx!.fillText(glyph, x, y);
      });
      ctx!.globalAlpha = 1;
    }

    function tick() {
      if (disposed) return;
      if (!document.hidden) draw(performance.now() / 1000);
      timer = window.setTimeout(tick, FRAME_MS);
    }

    const observer = new ResizeObserver(() => {
      resize();
      if (still) draw(0);
    });
    observer.observe(canvas);
    // The theme can change while the welcome screen is up (data-theme on <html>).
    const themeWatch = new MutationObserver(() => {
      resize();
      if (still) draw(0);
    });
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style", "class"],
    });

    resize();
    if (still) draw(0);
    else tick();

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      observer.disconnect();
      themeWatch.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="ascii-backdrop" aria-hidden="true" />;
}
