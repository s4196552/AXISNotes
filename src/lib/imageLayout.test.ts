import { describe, expect, it } from "vitest";
import { readImageLayout, writeImageLayout, type ImageLayout } from "./imageLayout";

const layout: ImageLayout = { width: 320, height: 180, crop: [10, 5, 20, 15] };
describe("reversible image layout", () => {
  it("reads both Obsidian dimensions for wiki and Markdown embeds", () => {
    for (const source of ["![[photo.png|300x200]]", '![Cell|300x200](<My photo.png> "Caption")'])
      expect(readImageLayout(source).layout).toEqual({
        width: 300,
        height: 200,
        crop: [0, 0, 0, 0],
      });
  });
  it("keeps filenames, Markdown titles and crop metadata through save/reload", () => {
    for (const source of [
      "  ![[/photos/My photo.png|120]]",
      '![Cell|120](<My photo.png> "Caption")',
    ]) {
      const next = writeImageLayout(source, layout);
      expect(next).toContain("|320x180");
      expect(readImageLayout(next).layout).toEqual(layout);
      expect(writeImageLayout(next, layout)).toBe(next);
      expect(next).toContain(source.includes("Caption") ? '"Caption"' : "/photos/My photo.png");
    }
  });
  it("preserves wiki captions instead of replacing them with a size", () => {
    const next = writeImageLayout("![[photo.png|A caption]]", layout);
    expect(next).toContain("![[photo.png|A caption]]");
    expect(readImageLayout(next).layout).toEqual(layout);
  });
  it("resets all transforms without changing the source image link", () => {
    const next = writeImageLayout("![Cell](../pictures/a%20b.png)", layout);
    expect(writeImageLayout(next, { width: null, height: null, crop: [0, 0, 0, 0] })).toBe(
      "![Cell](../pictures/a%20b.png)",
    );
  });
  it("rejects invalid crops and dimensions and ignores malformed metadata", () => {
    for (const width of [0, -1, 10000, NaN, 1.5])
      expect(() => writeImageLayout("![[a.png]]", { ...layout, width })).toThrow();
    for (const crop of [
      [50, 0, 50, 0],
      [0, -1, 0, 0],
      [NaN, 0, 0, 0],
    ])
      expect(() =>
        writeImageLayout("![[a.png]]", { ...layout, crop: crop as ImageLayout["crop"] }),
      ).toThrow();
    expect(
      readImageLayout('![[a.png]] <!-- axis-image {"crop":[80,0,80,0],"width":-5} -->').layout,
    ).toEqual({ width: null, height: null, crop: [0, 0, 0, 0] });
    expect(() => readImageLayout("![[a.png]] <!-- axis-image {broken} -->")).not.toThrow();
  });
});
