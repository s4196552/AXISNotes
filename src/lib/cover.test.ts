import { describe, expect, it } from "vitest";
import { coverY, GRADIENTS, imageCover, parseCover, roundY } from "./cover";

describe("parseCover", () => {
  it("reads vault images in the Obsidian Banners forms", () => {
    expect(parseCover("[[Trips/coast.jpg]]")).toEqual({ kind: "image", target: "Trips/coast.jpg" });
    expect(parseCover("![[coast.jpg]]")).toEqual({ kind: "image", target: "coast.jpg" });
    expect(parseCover("[[coast.jpg|Coast]]")).toEqual({ kind: "image", target: "coast.jpg" });
    expect(parseCover("  attachments/a b.png ")).toEqual({
      kind: "image",
      target: "attachments/a b.png",
    });
    expect(parseCover(imageCover("x/y.png"))).toEqual({ kind: "image", target: "x/y.png" });
  });

  it("reads gradients, colours and web addresses", () => {
    expect(parseCover("gradient:Dusk")).toEqual({
      kind: "gradient",
      name: "dusk",
      css: GRADIENTS.dusk!.css,
    });
    expect(parseCover("gradient:nope")).toBeNull();
    expect(parseCover("#0090ff")).toEqual({ kind: "color", color: "#0090ff" });
    expect(parseCover("#abc")).toEqual({ kind: "color", color: "#abc" });
    expect(parseCover("https://example.com/a.jpg")).toEqual({
      kind: "remote",
      url: "https://example.com/a.jpg",
    });
  });

  it("ignores empty and non-text values", () => {
    expect(parseCover(undefined)).toBeNull();
    expect(parseCover("   ")).toBeNull();
    expect(parseCover(42)).toBeNull();
    expect(parseCover(["a.png"])).toBeNull();
    expect(parseCover("[[]]")).toBeNull();
  });
});

describe("coverY", () => {
  it("reads 0–1, percentages and junk", () => {
    expect(coverY(0.3)).toBe(0.3);
    expect(coverY("0.25")).toBe(0.25);
    expect(coverY(40)).toBe(0.4);
    expect(coverY(-2)).toBe(0);
    expect(coverY(500)).toBe(1);
    expect(coverY(undefined)).toBe(0.5);
    expect(coverY("top")).toBe(0.5);
  });

  it("rounds for the frontmatter", () => {
    expect(roundY(0.33333)).toBe(0.33);
    expect(roundY(1.4)).toBe(1);
  });
});
