import { describe, expect, it } from "vitest";
import { iconWords, loadAllIcons, lucideFor, matchesIcon } from "./iconSet";

describe("icon names", () => {
  it("splits names into words", () => {
    expect(iconWords("FlaskConical")).toBe("flask conical");
    expect(iconWords("Grid2x2Check")).toBe("grid 2x2 check");
  });

  it("matches typed words against the start of name words", () => {
    expect(matchesIcon("FlaskConical", "flask")).toBe(true);
    expect(matchesIcon("FlaskConical", "fla con")).toBe(true);
    expect(matchesIcon("FlaskConical", "conical-flask")).toBe(true);
    expect(matchesIcon("FlaskConical", "ask")).toBe(false);
    expect(matchesIcon("FlaskConical", "  ")).toBe(true);
  });
});

describe("the full Lucide set", () => {
  it("resolves curated icons at once and the rest after loading", async () => {
    expect(lucideFor("lucide:Folder")).not.toBeNull();
    expect(lucideFor("lucide:Home")).not.toBeNull(); // a curated alias still works
    expect(lucideFor("🚀")).toBeNull();

    const all = await loadAllIcons();
    expect(Object.keys(all).length).toBeGreaterThan(1500);
    expect(lucideFor("lucide:Rabbit")).toBe(all.Rabbit);
    expect(lucideFor("lucide:NoSuchIcon")).toBeNull();
    expect(await loadAllIcons()).toBe(all); // loaded once
  });
});
