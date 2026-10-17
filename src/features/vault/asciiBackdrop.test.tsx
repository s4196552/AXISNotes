import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { AsciiBackdrop } from "./AsciiBackdrop";
import { ASCII_RAMP, brightness, glyphFor } from "./asciiField";

describe("asciiField", () => {
  it("keeps brightness within 0..1 across the screen and over time", () => {
    for (const t of [0, 7.5, 1234]) {
      for (let x = 0; x <= 1; x += 0.05) {
        for (let y = 0; y <= 1; y += 0.05) {
          const v = brightness(x, y, t, 16 / 9);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("is bright inside a blob and empty far from every blob", () => {
    expect(brightness(0.3, 0.3, 0)).toBeGreaterThan(0.5);
    expect(brightness(0.55, 0.05, 0)).toBe(0);
  });

  it("maps brightness to glyphs from empty to dense", () => {
    expect(glyphFor(0)).toBe(" ");
    expect(glyphFor(1)).toBe(ASCII_RAMP[ASCII_RAMP.length - 1]);
    expect(glyphFor(-3)).toBe(" ");
    expect(glyphFor(9)).toBe(ASCII_RAMP[ASCII_RAMP.length - 1]);
  });
});

describe("AsciiBackdrop", () => {
  const fillText = vi.fn();
  let reduced = false;

  beforeEach(() => {
    vi.useFakeTimers();
    fillText.mockClear();
    reduced = false;
    const ctx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillText,
      font: "",
      textBaseline: "",
      fillStyle: "",
      globalAlpha: 1,
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 400,
      height: 300,
    } as DOMRect);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduced && q.includes("reduce") }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("is decorative: hidden from assistive technology", () => {
    const { container } = render(<AsciiBackdrop />);
    expect(container.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
  });

  it("animates, and stops drawing once unmounted", () => {
    const { unmount } = render(<AsciiBackdrop />);
    expect(fillText).toHaveBeenCalled();
    const first = fillText.mock.calls.length;
    vi.advanceTimersByTime(500);
    expect(fillText.mock.calls.length).toBeGreaterThan(first);
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

  it("does nothing when the canvas has no 2D context", () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    expect(() => render(<AsciiBackdrop />)).not.toThrow();
    expect(fillText).not.toHaveBeenCalled();
  });
});
