import { useEffect, useRef } from "react";
import { drawStrokes, type Point, type Stroke } from "./pad";

// A writing surface for pen, touch or mouse. Strokes are kept in CSS pixels and the
// parent owns them (so it can undo, clear and export).

export interface HandwritingPadProps {
  strokes: Stroke[];
  onChange(strokes: Stroke[]): void;
  disabled?: boolean;
}

export function HandwritingPad({ strokes, onChange, disabled }: HandwritingPadProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef<Stroke | null>(null);
  const latest = useRef(strokes);

  // Redraw everything when the strokes change (undo/clear) or the pad resizes.
  useEffect(() => {
    latest.current = strokes;
    const el = canvas.current;
    if (!el) return;
    const paint = () => {
      const ctx = el.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = el.getBoundingClientRect();
      if (el.width !== Math.round(width * dpr) || el.height !== Math.round(height * dpr)) {
        el.width = Math.round(width * dpr);
        el.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawStrokes(ctx, latest.current, getComputedStyle(el).color || "#111");
    };
    paint();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(paint);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [strokes]);

  const point = (e: PointerEvent | React.PointerEvent): Point => {
    const r = canvas.current!.getBoundingClientRect();
    const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: pressure };
  };

  const drawSegment = (a: Point, b: Point) => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    drawStrokes(ctx, [[a, b]], getComputedStyle(canvas.current!).color || "#111");
  };

  return (
    <canvas
      ref={canvas}
      className="hw-pad"
      aria-label="Handwriting pad"
      role="img"
      onPointerDown={(e) => {
        if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
        e.preventDefault();
        canvas.current?.setPointerCapture?.(e.pointerId);
        const p = point(e);
        current.current = [p];
        drawSegment(p, p);
      }}
      onPointerMove={(e) => {
        const s = current.current;
        if (!s) return;
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
        for (const ev of events.length ? events : [e.nativeEvent]) {
          const p = point(ev);
          drawSegment(s[s.length - 1]!, p);
          s.push(p);
        }
      }}
      onPointerUp={() => {
        const s = current.current;
        current.current = null;
        if (s) onChange([...latest.current, s]);
      }}
      onPointerCancel={() => {
        current.current = null;
        onChange([...latest.current]);
      }}
    />
  );
}
