import { describe, expect, it } from "vitest";
import { renderMermaid } from "./mermaid";

describe("renderMermaid", () => {
  it("throws on invalid code without leaving Mermaid's error graphic on the page", async () => {
    await expect(renderMermaid("flowchart TD\n  A --> ((", false)).rejects.toThrow();
    await expect(renderMermaid("not a diagram at all", true)).rejects.toThrow();
    expect(document.body.querySelector("[id^='daxis-mermaid'], [id^='axis-mermaid']")).toBeNull();
    expect(document.body.textContent).not.toContain("Syntax error");
  });
});
