import { describe, expect, it } from "vitest";
import { createMemoryBackend } from "./memoryBackend";

describe("memory backend (contract mirror of the Rust core)", () => {
  it("creates, reads and writes with conflict detection", async () => {
    const b = createMemoryBackend();
    await b.createFile("School/Bio.md", "# Bio");
    const f = await b.readFile("School/Bio.md");
    expect(f.content).toBe("# Bio");
    await b.writeFile("School/Bio.md", "v2", f.modifiedMs);
    await expect(b.writeFile("School/Bio.md", "v3", f.modifiedMs)).rejects.toMatchObject({
      code: "Conflict",
    });
  });

  it("lists dirs first, case-insensitively, hiding dot files", async () => {
    const b = createMemoryBackend({ "b.md": "", "A.md": "", "zeta/x.md": "", ".hidden": "" });
    const tree = await b.listTree();
    expect(tree.children?.map((c) => c.name)).toEqual(["zeta", "A.md", "b.md"]);
  });

  it("moves folders with their contents and rejects bad moves", async () => {
    const b = createMemoryBackend({ "a/one.md": "1", "b.md": "" });
    await b.renameEntry("a", "c/a");
    expect(b.files()).toEqual({ "c/a/one.md": "1", "b.md": "" });
    await expect(b.renameEntry("b.md", "c/a/one.md")).rejects.toMatchObject({
      code: "AlreadyExists",
    });
    await expect(b.renameEntry("c", "c/inner")).rejects.toMatchObject({ code: "InvalidName" });
    await expect(b.readFile("../x")).rejects.toMatchObject({ code: "OutsideVault" });
  });

  it("notifies listeners of external writes", async () => {
    const b = createMemoryBackend();
    const seen: string[] = [];
    await b.onVaultChanged((c) => seen.push(...c.flatMap((x) => x.paths)));
    b.externalWrite("ext.md", "hi");
    expect(seen).toEqual(["ext.md"]);
  });
});

describe("memory backend index (mirror of the Rust index)", () => {
  const vault = {
    "Plan.md": "# Plan",
    "Work/Plan.md": "---\naliases: [WP]\n---\n",
    "Work/Note.md": "see [[Plan]] and [[WP]] #work/alpha",
    "Home.md": "---\nstatus: done\n---\nThe plan is here. [[Work/Plan]] #home",
  };

  it("resolves by folder, path and alias", async () => {
    const b = createMemoryBackend(vault);
    expect(await b.resolveLink("Plan", "Work/Note.md")).toBe("Work/Plan.md");
    expect(await b.resolveLink("Plan", "Home.md")).toBe("Plan.md");
    expect(await b.resolveLink("wp", "Home.md")).toBe("Work/Plan.md");
    expect(await b.resolveLink("Nope", "Home.md")).toBeNull();
  });

  it("lists backlinks, tags and notes", async () => {
    const b = createMemoryBackend(vault);
    const bl = await b.backlinks("Work/Plan.md");
    expect(bl.map((x) => [x.source, x.links.length])).toEqual([
      ["Home.md", 1],
      ["Work/Note.md", 2],
    ]);
    expect(await b.listTags()).toEqual([
      { tag: "home", count: 1 },
      { tag: "work/alpha", count: 1 },
    ]);
    expect((await b.listNotes()).find((n) => n.path === "Plan.md")?.title).toBe("Plan");
  });

  it("searches text, tags and properties", async () => {
    const b = createMemoryBackend(vault);
    const paths = async (q: string) => (await b.search(q)).map((h) => h.path);
    expect(await paths("tag:work")).toEqual(["Work/Note.md"]);
    expect(await paths("prop:status=done")).toEqual(["Home.md"]);
    expect(await paths("plan -tag:home")).toContain("Plan.md");
    expect((await b.search("here"))[0]?.snippet).toContain("\u0001here\u0002");
  });

  it("finds unlinked mentions with JS offsets", async () => {
    const b = createMemoryBackend(vault);
    const m = await b.unlinkedMentions("Plan.md");
    const home = m.find((x) => x.source === "Home.md")!;
    expect(vault["Home.md"].slice(home.start, home.end)).toBe("plan");
  });

  it("rewrites links on rename and announces the rewritten notes", async () => {
    const b = createMemoryBackend(vault);
    const seen: string[] = [];
    await b.onVaultChanged((c) => seen.push(...c.flatMap((x) => x.paths)));
    await b.renameEntry("Work/Plan.md", "Work/Roadmap.md");
    // [[Plan]] pointed at the same-folder note, so it must follow it; the alias link still resolves.
    expect(b.files()["Work/Note.md"]).toBe("see [[Roadmap]] and [[WP]] #work/alpha");
    expect(b.files()["Home.md"]).toContain("[[Work/Roadmap]]");
    expect(seen).toEqual(["Work/Note.md", "Home.md"]);
  });
});
