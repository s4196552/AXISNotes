import { afterEach, describe, expect, it, vi } from "vitest";
import { fitMenu, fitToViewport } from "./menuPosition";

const box = (left: number, top: number, width = 200, height = 400) => ({
  left,
  top,
  width,
  height,
});

describe("context menus stay on screen", () => {
  it("opens at the pointer when it fits", () => {
    expect(fitMenu(box(100, 100), 1000, 800)).toEqual({ left: 100, top: 100 });
  });

  it("opens above the pointer near the bottom, and left of it near the right", () => {
    // 600 + 400 would end below an 800px window: the menu ends at the pointer instead.
    expect(fitMenu(box(100, 600), 1000, 800)).toEqual({ left: 100, top: 200 });
    expect(fitMenu(box(900, 100), 1000, 800)).toEqual({ left: 700, top: 100 });
    expect(fitMenu(box(900, 600), 1000, 800)).toEqual({ left: 700, top: 200 });
  });

  it("sits against the edge when neither side of the pointer has room", () => {
    // 450px tall in a 600px window, clicked at 300: no room below or above.
    expect(fitMenu(box(100, 300, 200, 450), 1000, 600)).toEqual({ left: 100, top: 142 });
  });

  it("starts at the top and scrolls when taller than the window", () => {
    expect(fitMenu(box(100, 300, 200, 900), 1000, 600)).toEqual({
      left: 100,
      top: 8,
      maxHeight: 584,
    });
  });
});

describe("fitToViewport", () => {
  afterEach(() => vi.restoreAllMocks());

  function menuAt(rect: { left: number; top: number; width: number; height: number }) {
    const el = document.createElement("div");
    el.style.position = "fixed";
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    });
    Object.defineProperty(el, "offsetHeight", { value: rect.height });
    return el;
  }

  it("moves a menu that would leave the window back on screen", () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    const el = menuAt(box(40, 700, 180, 450));
    fitToViewport(el, 40, 700);
    expect(el.style.top).toBe("250px");
    expect(el.style.left).toBe("40px");
  });

  it("leaves a menu that fits where it was opened", () => {
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    const el = menuAt(box(40, 100, 180, 450));
    fitToViewport(el, 40, 100);
    expect(el.style.top).toBe("100px");
    expect(el.style.maxHeight).toBe("");
  });
});
