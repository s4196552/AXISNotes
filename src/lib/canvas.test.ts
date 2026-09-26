import { describe, expect, it } from "vitest";
import { cardLink, cardPath, emptyCanvas, parseCanvas, serializeCanvas } from "./canvas";

describe("canvas format", () => {
  it("parses leniently, keeping only scene settings from the app state", () => {
    const file = parseCanvas(
      JSON.stringify({
        type: "excalidraw",
        source: "https://excalidraw.com",
        elements: [{ id: "a", type: "rectangle" }, null, 3],
        appState: { viewBackgroundColor: "#fff", zoom: { value: 2 }, gridModeEnabled: true },
        files: { f1: { id: "f1" } },
      }),
    );
    expect(file.elements).toEqual([{ id: "a", type: "rectangle" }]);
    expect(file.appState).toEqual({ viewBackgroundColor: "#fff", gridModeEnabled: true });
    expect(file.source).toBe("axis");
    expect(parseCanvas("")).toEqual(emptyCanvas());
    expect(() => parseCanvas("{nope")).toThrow();
  });

  it("drops deleted elements and unused files when saving", () => {
    const text = serializeCanvas({
      elements: [
        { id: "img", type: "image", fileId: "f1" },
        { id: "gone", type: "image", fileId: "f2", isDeleted: true },
      ],
      appState: { gridModeEnabled: false, viewBackgroundColor: "#000" },
      files: { f1: { id: "f1" }, f2: { id: "f2" } },
    });
    const saved = JSON.parse(text) as ReturnType<typeof parseCanvas>;
    expect(saved.elements.map((e) => e.id)).toEqual(["img"]);
    expect(Object.keys(saved.files)).toEqual(["f1"]);
    expect(parseCanvas(text)).toEqual(saved);
  });

  it("maps note cards to and from paths", () => {
    expect(cardLink("School/Bio.md")).toBe("axis:School/Bio.md");
    expect(cardPath("axis:School/Bio.md")).toBe("School/Bio.md");
    expect(cardPath("https://example.com")).toBeNull();
    expect(cardPath("axis:")).toBeNull();
    expect(cardPath(null)).toBeNull();
  });
});
