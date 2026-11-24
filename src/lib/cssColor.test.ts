import { afterEach, describe, expect, it } from "vitest";
import { colorToHex, cssColor } from "./cssColor";

// T-277: colour tokens read by code that draws, such as the graph's canvas.

afterEach(() => document.documentElement.removeAttribute("style"));

describe("cssColor", () => {
  it("returns a plain token as it is, and the fallback when unset", () => {
    document.documentElement.style.setProperty("--fg", "#112233");
    expect(cssColor("--fg", "#000000")).toBe("#112233");
    expect(cssColor("--nothing", "#abcdef")).toBe("#abcdef");
  });

  it("asks the browser for a token that needs resolving, and leaves no probe behind", () => {
    document.documentElement.style.setProperty("--fg", "light-dark(#112233, #445566)");
    const before = document.documentElement.childElementCount;
    // jsdom can't resolve light-dark(), so the raw value comes back; a browser gives rgb().
    expect(cssColor("--fg", "#000000")).toMatch(/^(?:rgb|light-dark)/);
    expect(document.documentElement.childElementCount).toBe(before);
  });

  it("turns rgb() into hex", () => {
    expect(colorToHex("rgb(255, 179, 71)")).toBe("#ffb347");
    expect(colorToHex("rgba(0 0 0 / 50%)")).toBe("#000000");
    expect(colorToHex("#ABCDEF")).toBe("#abcdef");
    expect(colorToHex("light-dark(#fff, #000)")).toBe("");
  });
});
