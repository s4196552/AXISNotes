import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { Settings } from "../settings/Settings";
import { COLLECTIONS, addCollection, collectionAdded, prepareSkill } from "./collections";
import { groupSkills } from "./skillGroups";
import { MAX_REFERENCE_CHARS, namedSkills, referencePaths } from "./skillReferences";
import { freshSkill, loadVaultSkills, parseSkill, useSkills } from "./skills";
import { MATT_POCOCK_FILES } from "./packs/mattPocock";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({ "Plan.md": "# Plan\n" });
  await h.b.openVault("/v");
  await useAppStore.getState().openVault("/v");
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
  await loadVaultSkills();
});

const matt = COLLECTIONS.find((c) => c.id === "matt-pocock")!;
const skillCount = Object.keys(MATT_POCOCK_FILES).filter((k) => k.endsWith("/SKILL.md")).length;

describe("skill collections (T-257)", () => {
  it("adapts a collection's SKILL.md to run as a chat, renaming one a built-in already has", () => {
    const text = MATT_POCOCK_FILES["grill-me/SKILL.md"]!;
    const out = prepareSkill(text, "grill-me", matt, new Set(["grill-me"]));
    const skill = parseSkill(out, "Skills/Matt Pocock/grill-me/SKILL.md")!;
    expect(skill).toMatchObject({
      id: "grill-me-pocock",
      title: "Grill Me (Matt Pocock)",
      output: "chat",
      reads: "note",
      collection: "Matt Pocock",
    });
    expect(skill.description).toBe("A relentless interview to sharpen a plan or design.");
    expect(skill.instructions).toContain('Call the Skill tool with "grilling".');
    expect(skill.instructions).toMatch(/^> In AXISNotes this skill runs as an AI chat/);
    // Without a clash the name is kept.
    const tdd = parseSkill(
      prepareSkill(MATT_POCOCK_FILES["tdd/SKILL.md"]!, "tdd", matt, new Set()),
      "Skills/Matt Pocock/tdd/SKILL.md",
    )!;
    expect(tdd.id).toBe("tdd");
    expect(tdd.title).toBe("TDD");
  });

  it("finds the skills a skill names and the files beside it", () => {
    expect(
      namedSkills('Call the Skill tool twice, for "grilling" and "domain-modeling".\nUse `tdd`.'),
    ).toEqual(["grilling", "domain-modeling"]);
    expect(
      referencePaths("Skills/x/tdd/SKILL.md", [
        "Skills/x/tdd/SKILL.md",
        "Skills/x/tdd/tests.md",
        "Skills/x/tdd/more/deep.md",
        "Skills/x/tdd/more/a/b.md",
        "Skills/x/other/SKILL.md",
        "Skills/x/tdd/run.sh",
      ]),
    ).toEqual(["Skills/x/tdd/more/deep.md", "Skills/x/tdd/tests.md"]);
  });

  it("adds Matt Pocock's skills to the vault once, with the licence, grouped together", async () => {
    expect(
      collectionAdded(
        matt,
        useAppStore.getState().notes.map((n) => n.path),
      ),
    ).toBe(false);
    expect(await addCollection(matt)).toBe(skillCount);
    await expect(h.b.readFile("Skills/Matt Pocock/LICENSE.md")).resolves.toMatchObject({
      content: expect.stringContaining("MIT License"),
    });
    await expect(h.b.readFile("Skills/Matt Pocock/tdd/tests.md")).resolves.toBeTruthy();
    // A second time adds nothing and keeps edits.
    await h.b.writeFile("Skills/Matt Pocock/tdd/SKILL.md", "---\nname: tdd\n---\nMine.");
    expect(await addCollection(matt)).toBe(0);
    expect((await h.b.readFile("Skills/Matt Pocock/tdd/SKILL.md")).content).toContain("Mine.");
    await loadVaultSkills();
    const skills = useSkills.getState().skills;
    // AXISNotes' own Grill me is kept; Matt Pocock's is added beside it.
    expect(skills.find((s) => s.id === "grill-me")?.source).toBe("built-in");
    expect(skills.find((s) => s.id === "grill-me-pocock")?.collection).toBe("Matt Pocock");
    const group = groupSkills(skills).find((g) => g.name === "Matt Pocock")!;
    expect(group.skills.map((s) => s.id)).toContain("grilling");
    expect(
      collectionAdded(
        matt,
        useAppStore.getState().notes.map((n) => n.path),
      ),
    ).toBe(true);
  });

  it("runs a skill with the skills it names and its reference files", async () => {
    await addCollection(matt);
    await loadVaultSkills();
    const grill = (await freshSkill("grill-me-pocock"))!;
    expect(grill.instructions).toContain("# Included with this skill");
    expect(grill.instructions).toContain("## Skill “grilling”");
    expect(grill.instructions).toContain("can't run commands");
    const tdd = (await freshSkill("tdd"))!;
    expect(tdd.instructions).toContain("## File tests.md");
    expect(tdd.instructions.length).toBeLessThan(
      MATT_POCOCK_FILES["tdd/SKILL.md"]!.length + MAX_REFERENCE_CHARS + 2000,
    );
    // A reference file kept from AI by its folder's rule stays out.
    useConfig.setState({
      config: {
        ...DEFAULT_CONFIG,
        ai: { ...DEFAULT_CONFIG.ai, folders: { "Skills/Matt Pocock/tdd/tests.md": "local" } },
      },
    });
    expect((await freshSkill("tdd"))!.instructions).not.toContain("## File tests.md");
    // Built-in skills are unchanged.
    expect((await freshSkill("mindmap"))!.instructions).not.toContain("Included with this skill");
  });
});

describe("Settings → AI → Skills (T-257)", () => {
  it("lists skills and makes a new one as a SKILL.md", async () => {
    render(<Settings section="skills" onClose={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Skills" })).toHaveAttribute("aria-selected", "true");
    const all = screen.getByRole("region", { name: "All skills" });
    expect(within(all).getByText("/mindmap")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New skill" }));
    const form = screen.getByRole("form", { name: "New skill" });
    fireEvent.change(within(form).getByLabelText("Skill name"), {
      target: { value: "Explain to a child" },
    });
    expect(within(form).getByText("Runs as /explain-to-a-child")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Skill description"), {
      target: { value: "Simple words" },
    });
    fireEvent.change(within(form).getByLabelText("Answers as"), { target: { value: "chat" } });
    fireEvent.change(within(form).getByLabelText("Skill instructions"), {
      target: { value: "Explain the note simply." },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Create skill" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Added /explain-to-a-child");
    const skill = parseSkill(
      (await h.b.readFile("Skills/explain-to-a-child/SKILL.md")).content,
      "Skills/explain-to-a-child/SKILL.md",
    )!;
    expect(skill).toMatchObject({
      title: "Explain to a child",
      description: "Simple words",
      output: "chat",
      instructions: "Explain the note simply.",
    });
    await waitFor(() => expect(within(all).getByText("/explain-to-a-child")).toBeInTheDocument());
  });

  it("imports a skill folder, adds a collection and removes a skill", async () => {
    h.b.pickSkill = async () => "C:\\Users\\me\\.claude\\skills\\haiku\\SKILL.md";
    h.b.importSkill = async () => {
      await h.b.createFile("Skills/haiku/SKILL.md", "---\nname: haiku\n---\nWrite a haiku.");
      return "Skills/haiku/SKILL.md";
    };
    render(<Settings section="skills" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Import skill…" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Imported Skills/haiku/SKILL.md");
    await waitFor(() => expect(screen.getByText("/haiku")).toBeInTheDocument());

    const collections = screen.getByRole("region", { name: "Skill collections" });
    fireEvent.click(within(collections).getByRole("button", { name: "Add to this vault" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(`Added ${skillCount} skills`),
    );
    expect(
      within(collections).getByRole("button", { name: "Add missing skills" }),
    ).toBeInTheDocument();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove Haiku" }));
    await waitFor(() => expect(screen.queryByText("/haiku")).toBeNull());
    await expect(h.b.readFile("Skills/haiku/SKILL.md")).rejects.toBeTruthy();
  });
});
