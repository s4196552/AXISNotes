import { describe, expect, it } from "vitest";
import { markText, noteMark, stricter } from "./aiAccess";

describe("note AI marks", () => {
  it("reads a note's own mark like the Rust layer, failing closed", () => {
    expect(noteMark("a.md", "# No frontmatter")).toBeNull();
    expect(noteMark("a.md", "---\ntitle: x\n---\nbody")).toBeNull();
    expect(noteMark("a.md", "---\nai-access: local\n---\nbody")).toBe("local");
    expect(noteMark("a.md", "---\nai-access: NEVER\n---\n")).toBe("never");
    expect(noteMark("a.md", "---\nai-access: maybe\n---\n")).toBe("never");
    expect(noteMark("a.md", "---\nai-access: [local]\n---\n")).toBe("never");
    // Broken YAML hides the value, but the mark still counts.
    expect(noteMark("a.md", "---\nai-access: local\ntags: [unclosed\n---\n")).toBe("never");
    expect(noteMark("p.html", "<html><head></head></html>")).toBeNull();
    expect(noteMark("p.html", '<head><meta name="ai-access" content="local"></head>')).toBe(
      "local",
    );
    expect(noteMark("p.html", "<head><meta name='ai-access'></head>")).toBe("never");
  });

  it("raises a mark without lowering it or touching the rest of the frontmatter", () => {
    expect(markText("a.md", "# Body\n", "any")).toBe("# Body\n");
    expect(markText("a.md", "# Body\n", "local")).toBe("---\nai-access: local\n---\n# Body\n");
    const fm = "---\ntags: [a, b]   # mine\ntitle: X\n---\nBody\n";
    expect(markText("a.md", fm, "never")).toBe(
      "---\nai-access: never\ntags: [a, b]   # mine\ntitle: X\n---\nBody\n",
    );
    const marked = "---\nai-access: local\n---\nBody\n";
    expect(markText("a.md", marked, "never")).toBe("---\nai-access: never\n---\nBody\n");
    expect(markText("a.md", "---\nai-access: never\n---\nBody\n", "local")).toBe(
      "---\nai-access: never\n---\nBody\n",
    );
    // Broken YAML is left as it is, apart from the one line.
    const broken = "---\ntags: [unclosed\n---\nBody\n";
    expect(markText("a.md", broken, "local")).toBe(
      "---\nai-access: local\ntags: [unclosed\n---\nBody\n",
    );
    expect(noteMark("a.md", markText("a.md", broken, "local"))).toBe("never");
    expect(markText("p.html", "<html><head><title>T</title></head></html>", "local")).toBe(
      '<html><head><meta name="ai-access" content="local"><title>T</title></head></html>',
    );
    expect(markText("p.html", "<p>no head</p>", "never")).toBe(
      '<meta name="ai-access" content="never">\n<p>no head</p>',
    );
    expect(stricter("local", "any")).toBe("local");
    expect(stricter("local", "never")).toBe("never");
  });
});
