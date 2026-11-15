import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { splitFrontmatter } from "../../lib/markdown";
import { giveAiIcon } from "./aiIcon";
import { BUILTIN_SKILLS, SKILLS_DIR, skillId } from "./skills";

// Skill collections: sets of skills someone else wrote, added to a vault as ordinary
// editable SKILL.md files under `Skills/<collection>/`. They're bundled with the app (so
// nothing is downloaded) and loaded only when someone adds them.

export interface SkillCollection {
  id: string;
  name: string;
  author: string;
  description: string;
  url: string;
  license: string;
  /** The folder under Skills/ it is added to. */
  folder: string;
  load(): Promise<{ files: Record<string, string>; license: string; commit: string }>;
}

export const COLLECTIONS: SkillCollection[] = [
  {
    id: "matt-pocock",
    name: "Matt Pocock's skills",
    author: "Matt Pocock",
    description:
      "Grill a plan until it's solid, write specs and tickets, test-driven development, debugging, code review, domain modelling, teaching, handoffs and more. Written for coding agents; here they run as AI chats on the open note.",
    url: "https://github.com/mattpocock/skills",
    license: "MIT",
    folder: "Matt Pocock",
    load: async () => {
      const m = await import("./packs/mattPocock");
      return {
        files: m.MATT_POCOCK_FILES,
        license: m.MATT_POCOCK_LICENSE,
        commit: m.MATT_POCOCK_COMMIT,
      };
    },
  },
];

const RUNS_HERE =
  "> In AXISNotes this skill runs as an AI chat about the note it's started from. It can't run commands, open other files or use an issue tracker: it asks you, or tells you what to do.";

const quote = (s: string) => JSON.stringify(s);
/** Words in skill names that are written in capitals ("tdd" → "TDD"). */
const ACRONYMS = new Set(["tdd", "pr", "adr", "ai", "html", "ui"]);

/**
 * A collection's SKILL.md as added to a vault: it runs as a chat on the note, is listed
 * under the collection, and is renamed when its name is taken by a built-in skill (so it
 * adds to AXISNotes' own instead of replacing it).
 */
export function prepareSkill(
  text: string,
  folder: string,
  collection: SkillCollection,
  taken: ReadonlySet<string>,
): string {
  const fm = splitFrontmatter(text);
  const props = fm.props as Record<string, unknown>;
  const name = skillId(typeof props.name === "string" && props.name ? props.name : folder);
  const clash = taken.has(name);
  const id = clash ? skillId(`${name}-${collection.id.split("-").pop()}`) : name;
  const keep = fm.yaml
    .split("\n")
    .filter((l) => !/^(name|title|output|reads|collection|source)\s*:/.test(l))
    .join("\n")
    .trim();
  const title = name
    .split("-")
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
  const head = [
    "---",
    `name: ${id}`,
    `title: ${quote(clash ? `${title} (${collection.author})` : title)}`,
    ...(keep ? [keep] : []),
    "output: chat",
    "reads: note",
    `collection: ${quote(collection.author)}`,
    `source: ${quote(`${collection.url} (${collection.license})`)}`,
    "---",
  ].join("\n");
  return `${head}\n\n${RUNS_HERE}\n\n${text.slice(fm.length).trim()}\n`;
}

/** Whether any of a collection's skills are in the vault. */
export function collectionAdded(collection: SkillCollection, paths: readonly string[]): boolean {
  const dir = `${SKILLS_DIR}/${collection.folder}/`.toLowerCase();
  return paths.some((p) => p.toLowerCase().startsWith(dir));
}

/**
 * Add a collection's skills to the vault, leaving any file already there alone (so edits
 * are kept). Returns how many skills were added.
 */
export async function addCollection(collection: SkillCollection): Promise<number> {
  const { files, license, commit } = await collection.load();
  const root = `${SKILLS_DIR}/${collection.folder}`;
  const taken = new Set(BUILTIN_SKILLS.map((s) => s.id));
  const made = new Set<string>();
  let added = 0;
  const create = async (path: string, text: string) => {
    try {
      await backend.createFile(path, text);
      return true;
    } catch (e) {
      if (isBackendError(e) && e.code === "AlreadyExists") return false;
      throw e;
    }
  };
  for (const [rel, text] of Object.entries(files)) {
    const [folder, file] = rel.split("/") as [string, string];
    const isSkill = /^SKILL\.md$/i.test(file);
    const body = isSkill ? prepareSkill(text, folder, collection, taken) : text;
    if ((await create(`${root}/${folder}/${file}`, body)) && isSkill) added++;
    made.add(`${root}/${folder}`);
  }
  await create(
    `${root}/LICENSE.md`,
    `# ${collection.name}\n\nFrom ${collection.url} (commit ${commit}), under this licence. The SKILL.md files were adapted to run in AXISNotes.\n\n\`\`\`text\n${license.trim()}\n\`\`\`\n`,
  );
  await giveAiIcon([root, ...made]);
  await useAppStore.getState().refreshTree();
  return added;
}
