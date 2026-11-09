import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { setAiResponder } from "../../ipc/memoryAi";
import type { NoteRef } from "../../ipc";
import { useAppStore } from "../../app/store";
import { InvalidAnswer } from "../../lib/aiJson";
import { SuggestDialog } from "./SuggestDialog";
import { addLinks, addTags, frontmatterTags, linkCandidates, parseSuggestions } from "./suggest";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const ref = (path: string, aliases: string[] = []): NoteRef => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, ""),
  title: null,
  aliases,
});

const NOTE =
  "---\ntags: [bio]\n---\n# Cells\nMitochondria make ATP for the cell.\nSee [[Chemistry]] and `Krebs Cycle` in code.\nThe krebs cycle runs inside.\n";
const NOTES = [
  ref("School/Cells.md"),
  ref("School/Mitochondria.md"),
  ref("School/Chemistry.md"),
  ref("School/Krebs Cycle.md", ["TCA"]),
  ref("Ox.md"),
  ref("Grid.axgrid"),
];

describe("link candidates", () => {
  it("are notes mentioned but not linked, outside code, nearest first", () => {
    expect(linkCandidates("School/Cells.md", NOTE, NOTES).map((c) => c.path)).toEqual([
      "School/Mitochondria.md",
      "School/Krebs Cycle.md",
    ]);
  });
});

describe("parsing suggestions", () => {
  const ctx = {
    noteText: NOTE,
    currentTitle: "Cells",
    candidates: linkCandidates("School/Cells.md", NOTE, NOTES),
  };

  it("keeps new valid tags, a changed title and links found in the note", () => {
    const s = parseSuggestions(
      JSON.stringify({
        tags: ["#Biology/Cells", "bio", "energy", "energy"],
        title: "Cells and energy",
        links: [
          { text: "Mitochondria", target: "School/Mitochondria.md" },
          { text: "krebs cycle", target: "School/Krebs Cycle" },
        ],
      }),
      ctx,
    );
    expect(s).toEqual({
      tags: ["biology/cells", "energy"],
      title: "Cells and energy",
      links: [
        { text: "Mitochondria", target: "School/Mitochondria.md" },
        { text: "krebs cycle", target: "School/Krebs Cycle.md" },
      ],
    });
    expect(parseSuggestions('{"tags":[],"title":"Cells","links":[]}', ctx).title).toBeNull();
  });

  it("rejects made-up targets, text that isn't in the note, and bad tags", () => {
    for (const bad of [
      { tags: [], links: [{ text: "Mitochondria", target: "Nowhere.md" }] },
      { tags: [], links: [{ text: "Chemistry", target: "School/Mitochondria.md" }] },
      { tags: [], links: [{ text: "Golgi", target: "School/Mitochondria.md" }] },
      { tags: ["no spaces?"], links: [] },
    ])
      expect(() => parseSuggestions(JSON.stringify(bad), ctx)).toThrow(InvalidAnswer);
  });
});

describe("applying suggestions", () => {
  it("adds tags to the frontmatter and links the first plain mention", () => {
    const tagged = addTags(NOTE, ["energy"]);
    expect(frontmatterTags(tagged)).toEqual(["bio", "energy"]);
    expect(addTags("# Plain\n", ["x"])).toBe("---\ntags:\n  - x\n---\n\n# Plain\n");
    const linked = addLinks(tagged, [
      { text: "Mitochondria", target: "School/Mitochondria.md" },
      { text: "krebs cycle", target: "School/Krebs Cycle.md" },
    ]);
    expect(linked).toContain("[[School/Mitochondria]] make ATP");
    expect(linked).toContain("`Krebs Cycle` in code");
    expect(linked).toContain("The [[School/Krebs Cycle|krebs cycle]] runs");
  });
});

describe("Suggest dialog", () => {
  beforeEach(async () => {
    h.b = createMemoryBackend({
      "School/Cells.md": NOTE,
      "School/Mitochondria.md": "# Mitochondria",
      "School/Chemistry.md": "# Chemistry",
      "School/Krebs Cycle.md": "# Krebs",
      "Index.md": "Read [[Cells]].",
    });
    await h.b.openVault("/v");
    const { settings } = await h.b.aiSettings();
    await h.b.aiSaveSettings({
      ...settings,
      providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
    });
    useAppStore.setState({ vault: { root: "/v", name: "v" }, notice: null, error: null });
    setAiResponder(() =>
      JSON.stringify({
        tags: ["energy", "organelles"],
        title: "Cell energy",
        links: [{ text: "Mitochondria", target: "School/Mitochondria.md" }],
      }),
    );
  });
  afterEach(() => setAiResponder(null));

  it("applies only the ticked suggestions, renaming with links updated", async () => {
    const onClose = vi.fn();
    render(<SuggestDialog path="School/Cells.md" onClose={onClose} />);
    const suggest = await screen.findByRole("button", { name: "Suggest" });
    await waitFor(() => expect(suggest).not.toBeDisabled());
    fireEvent.click(suggest);
    fireEvent.click(await screen.findByLabelText("#organelles"));
    fireEvent.click(screen.getByRole("button", { name: "Apply selected" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const files = h.b.files();
    expect(files["School/Cells.md"]).toBeUndefined();
    const renamed = files["School/Cell energy.md"]!;
    expect(frontmatterTags(renamed)).toEqual(["bio", "energy"]);
    expect(renamed).toContain("[[School/Mitochondria]] make ATP");
    expect(files["Index.md"]).toContain("Cell energy");
    expect(useAppStore.getState().notice).toBe("Applied 3 suggestions.");
  });
});
