import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { AsciiBackdrop } from "./AsciiBackdrop";
import {
  GLYPHS,
  STAR,
  cover,
  isLightColour,
  randomGlyph,
  starMask,
  tint,
  tintPosition,
} from "./asciiField";

describe("asciiField", () => {
  it("shows glyphs inside the star and nothing outside it", () => {
    // The star's middle and well inside each arm.
    expect(starMask(960, 560)).toBeGreaterThan(0.8);
    expect(starMask(960, 300)).toBeGreaterThan(0.3);
    expect(starMask(1150, 760)).toBeGreaterThan(0.3);
    expect(starMask(770, 760)).toBeGreaterThan(0.3);
    // Between the arms (the cusps curve inwards), at the corners and off the frame.
    expect(starMask(1250, 400)).toBe(0);
    expect(starMask(700, 400)).toBe(0);
    expect(starMask(960, 1000)).toBe(0);
    expect(starMask(0, 0)).toBe(0);
    expect(starMask(1920, 1080)).toBe(0);
  });

  it("keeps the mask within 0..1 and fades softly at the outline", () => {
    for (let x = 400; x <= 1500; x += 37) {
      for (let y = 50; y <= 950; y += 29) {
        const v = starMask(x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // Along a line crossing the left edge of the top arm, visibility rises gradually.
    const across = [930, 940, 945, 950, 955, 960].map((x) => starMask(x, 300));
    expect(across).toEqual([...across].sort((a, b) => a - b));
    expect(across.some((v) => v > 0 && v < across.at(-1)!)).toBe(true);
  });

  it("is a closed three-cusp outline through the reference's tips", () => {
    expect(STAR[0]).toEqual([960, 110]);
    expect(STAR).toContainEqual([1410, 880]);
    expect(STAR).toContainEqual([510, 880]);
  });

  it("tints warm at the top left and cool at the bottom right, darker on light themes", () => {
    expect(tintPosition(500, 100)).toBe(0);
    expect(tintPosition(1500, 1000)).toBe(1);
    expect(tint(0, true)).toEqual([0xd6, 0xc7, 0xb2, 0.26]);
    expect(tint(1, true)).toEqual([0x94, 0xa0, 0xb8, 0.28]);
    expect(tint(0.55, true)).toEqual([0xb5, 0xad, 0xa2, 0.22]);
    const [r, g, b] = tint(0, false);
    expect(r + g + b).toBeLessThan(0xd6 + 0xc7 + 0xb2);
  });

  it("covers any screen with the design frame, centred", () => {
    expect(cover(1920, 1080)).toEqual({ scale: 1, x: 0, y: 0 });
    const tall = cover(1000, 1080);
    expect(tall.scale).toBe(1);
    expect(tall.x).toBe(-460);
    const wide = cover(3840, 1080);
    expect(wide.scale).toBe(2);
    expect(wide.y).toBe(-540);
  });

  it("reads light and dark colours", () => {
    expect(isLightColour("#ececf1")).toBe(true);
    expect(isLightColour("#191919")).toBe(false);
    expect(isLightColour("#fff")).toBe(true);
    expect(isLightColour("rgba(28, 28, 34, 0.55)")).toBe(false);
    expect(isLightColour("oklch(0.9 0 0)")).toBeNull();
  });

  it("picks glyphs from the reference's character set", () => {
    expect(randomGlyph(() => 0)).toBe(GLYPHS[0]);
    expect(randomGlyph(() => 0.9999)).toBe(GLYPHS.at(-1));
    expect(GLYPHS).toMatch(/^[a-zA-Z0-9]+$/);
  });
});

describe("AsciiBackdrop", () => {
  const fillText = vi.fn();
  let reduced = false;
  let dark = false;
  // matchMedia fakes: flip a preference, then call `fire` to notify listeners like the browser.
  const listeners = new Map<string, Set<() => void>>();
  const fire = (query: string) => listeners.get(query)?.forEach((l) => l());
  const styles = new Set<string>();
  let ctx: Record<string, unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    fillText.mockClear();
    styles.clear();
    reduced = false;
    dark = false;
    listeners.clear();
    ctx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillText,
      font: "",
      textBaseline: "",
      set fillStyle(v: string) {
        styles.add(v);
      },
      get fillStyle() {
        return "";
      },
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 450,
    } as DOMRect);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", (q: string) => ({
      get matches() {
        return q.includes("reduce") ? reduced : q.includes("dark") ? dark : false;
      },
      addEventListener: (_: string, l: () => void) => {
        if (!listeners.has(q)) listeners.set(q, new Set());
        listeners.get(q)!.add(l);
      },
      removeEventListener: (_: string, l: () => void) => listeners.get(q)?.delete(l),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--fg");
  });

  const glyphs = (from = 0) => fillText.mock.calls.slice(from).map((c) => c[0] as string);

  it("is decorative: hidden from assistive technology", () => {
    const { container } = render(<AsciiBackdrop />);
    expect(container.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
  });

  it("draws letters and digits only inside the star", () => {
    render(<AsciiBackdrop />);
    expect(fillText).toHaveBeenCalled();
    expect(glyphs().join("")).toMatch(/^[a-zA-Z0-9]+$/);
    // 800×450 is the 1920×1080 frame at 5/12: every glyph sits inside the star's box.
    for (const [, x, y] of fillText.mock.calls as [string, number, number][]) {
      expect(x).toBeGreaterThan((510 * 5) / 12 - 10);
      expect(x).toBeLessThan((1410 * 5) / 12);
      expect(y).toBeGreaterThan((110 * 5) / 12 - 16);
      expect(y).toBeLessThan((880 * 5) / 12);
    }
  });

  it("shimmers, and stops drawing once unmounted", () => {
    const { unmount } = render(<AsciiBackdrop />);
    const first = glyphs();
    vi.advanceTimersByTime(600);
    const later = glyphs(first.length).slice(-first.length);
    expect(later).toHaveLength(first.length);
    expect(later).not.toEqual(first);
    unmount();
    const atUnmount = fillText.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(fillText.mock.calls.length).toBe(atUnmount);
  });

  it("draws one still frame when reduced motion is requested", () => {
    reduced = true;
    render(<AsciiBackdrop />);
    const drawn = fillText.mock.calls.length;
    expect(drawn).toBeGreaterThan(0);
    vi.advanceTimersByTime(1000);
    expect(fillText.mock.calls.length).toBe(drawn);
  });

  it("stops animating when reduced motion is turned on while shown, and resumes after", () => {
    render(<AsciiBackdrop />);
    reduced = true;
    fire("(prefers-reduced-motion: reduce)");
    const still = fillText.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(fillText.mock.calls.length).toBe(still);

    reduced = false;
    fire("(prefers-reduced-motion: reduce)");
    vi.advanceTimersByTime(500);
    expect(fillText.mock.calls.length).toBeGreaterThan(still);
  });

  it("pauses while the window is hidden", () => {
    render(<AsciiBackdrop />);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const before = fillText.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(fillText.mock.calls.length).toBe(before);
    hidden.mockRestore();
  });

  it("uses the reference tint on dark themes and a darker one on light themes, live", () => {
    reduced = true; // still frame: only a theme refresh can redraw
    document.documentElement.style.setProperty("--fg", "#1f2328"); // light theme
    render(<AsciiBackdrop />);
    // Red channels: the light tint runs 0x3f–0x7a, the reference (dark) tint 0x94–0xd6.
    const reds = () => [...styles].map((s) => Number(/rgba\((\d+)/.exec(s)![1]));
    expect(reds().length).toBeGreaterThan(1);
    expect(Math.max(...reds())).toBeLessThanOrEqual(0x7a);

    styles.clear();
    dark = true;
    document.documentElement.style.setProperty("--fg", "#e4e5e9"); // dark theme
    fire("(prefers-color-scheme: dark)");
    expect(reds().length).toBeGreaterThan(1);
    expect(Math.min(...reds())).toBeGreaterThanOrEqual(0x94);
  });

  it("removes its preference listeners when unmounted", () => {
    const { unmount } = render(<AsciiBackdrop />);
    unmount();
    for (const set of listeners.values()) expect(set.size).toBe(0);
  });

  it("does nothing when the canvas has no 2D context", () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    expect(() => render(<AsciiBackdrop />)).not.toThrow();
    expect(fillText).not.toHaveBeenCalled();
  });
});
