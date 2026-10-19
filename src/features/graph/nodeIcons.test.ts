import { afterEach, describe, expect, it, vi } from "vitest";
import { File, FileText, Folder, Shapes, Sheet } from "lucide-react";
import { createIconPainter, nodeIcon } from "./nodeIcons";

describe("node icons", () => {
  const icons = { "Ideas.md": { icon: "💡" }, School: { icon: "lucide:Book", color: "#30a46c" } };

  it("uses the custom icon, else one for the kind of item", () => {
    expect(nodeIcon("Ideas.md", icons)).toEqual({ custom: { icon: "💡" }, kind: FileText });
    expect(nodeIcon("Plain.md", icons)).toEqual({ custom: null, kind: FileText });
    expect(nodeIcon("Budget.axgrid", icons).kind).toBe(Sheet);
    expect(nodeIcon("Board.axcanvas", icons).kind).toBe(Shapes);
    expect(nodeIcon("School/", icons, { folder: true })).toEqual({
      custom: icons.School,
      kind: Folder,
    });
    expect(nodeIcon("?Ideas.md", icons, { unresolved: true })).toEqual({
      custom: null,
      kind: File,
    });
  });

  describe("painter", () => {
    afterEach(() => vi.unstubAllGlobals());

    const ctx = () =>
      ({
        fillText: vi.fn(),
        drawImage: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
      }) as unknown as CanvasRenderingContext2D & {
        fillText: ReturnType<typeof vi.fn>;
        drawImage: ReturnType<typeof vi.fn>;
      };

    it("writes emoji straight away", () => {
      const c = ctx();
      createIconPainter("#888888", () => {}).draw(c, nodeIcon("Ideas.md", icons), 0, 0, 16);
      expect(c.fillText).toHaveBeenCalledWith("💡", 8, 9);
      expect(c.drawImage).not.toHaveBeenCalled();
    });

    it("draws Lucide icons once their image loads, then asks for a redraw", () => {
      const made: { src: string; onload?: () => void }[] = [];
      vi.stubGlobal(
        "Image",
        class {
          src = "";
          onload?: () => void;
          onerror?: () => void;
          constructor() {
            made.push(this);
          }
        },
      );
      vi.stubGlobal("requestAnimationFrame", (fn: () => void) => (fn(), 1));
      const onReady = vi.fn();
      const painter = createIconPainter("#123456", onReady);
      const c = ctx();
      const icon = nodeIcon("School/", icons, { folder: true });
      painter.draw(c, icon, 0, 0, 16);
      // Not loaded yet: nothing drawn (not even the fallback, which is loading too).
      expect(c.drawImage).not.toHaveBeenCalled();
      const book = made.find((m) => decodeURIComponent(m.src).includes("#30a46c"));
      expect(book).toBeDefined();
      for (const m of made) m.onload?.();
      expect(onReady).toHaveBeenCalled();
      painter.draw(c, icon, 2, 3, 16);
      expect(c.drawImage).toHaveBeenCalledTimes(1);
      expect(c.drawImage.mock.calls[0]!.slice(1)).toEqual([2, 3, 16, 16]);

      // A disposed painter's graph is gone: no more redraws.
      painter.dispose();
      onReady.mockClear();
      painter.draw(c, nodeIcon("New.axcanvas", icons), 0, 0, 16);
      made.at(-1)!.onload?.();
      expect(onReady).not.toHaveBeenCalled();
    });
  });
});
