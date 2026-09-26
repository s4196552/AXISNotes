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
