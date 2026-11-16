import { splitFrontmatter } from "../../lib/markdown";
import { SKILLS_DIR, skillId } from "./skillId";
import { MATT_POCOCK_INDEX } from "./packs/mattPocockIndex";

// Skill collections: sets of skills someone else wrote, bundled with the app (so nothing is
// downloaded). Their skills are offered in the command menu straight away, from a small
// index; the full text loads only when one runs. Adding a collection to a vault writes them
// as ordinary editable SKILL.md files under `Skills/<collection>/` (collections.ts), and the
// vault copies are used from then on.

export interface SkillCollection {
  id: string;
  name: string;
  author: string;
  description: string;
  url: string;
  license: string;
  /** The folder under Skills/ it is added to. */
  folder: string;
  /** Each skill's folder, name and description, for the menu before the pack is loaded. */
  index: readonly { folder: string; name: string; description: string }[];
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
    index: MATT_POCOCK_INDEX,
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

/** The `source` of a collection skill used from the app rather than the vault. */
export const BUNDLED_PREFIX = "bundled:";
export const bundledSource = (collection: SkillCollection, folder: string) =>
  `${BUNDLED_PREFIX}${collection.id}/${folder}/SKILL.md`;
export const isBundledSource = (source: string) => source.startsWith(BUNDLED_PREFIX);
/** The collection and skill folder a bundled source names. */
export function parseBundledSource(
  source: string,
): { collection: SkillCollection; folder: string } | null {
  if (!isBundledSource(source)) return null;
  const [id, folder] = source.slice(BUNDLED_PREFIX.length).split("/");
  const collection = COLLECTIONS.find((c) => c.id === id);
  return collection && folder ? { collection, folder } : null;
}

const RUNS_HERE =
  "> In AXISNotes this skill runs as an AI chat about the note it's started from. It can't run commands, open other files or use an issue tracker: it asks you, or tells you what to do.";

const quote = (s: string) => JSON.stringify(s);
/** Words in skill names that are written in capitals ("tdd" → "TDD"). */
const ACRONYMS = new Set(["tdd", "pr", "adr", "ai", "html", "ui"]);

/**
 * The id and title a collection's skill gets: its own name, or, when a built-in skill has
 * that name, a renamed one (so it adds to AXISNotes' own instead of replacing it).
 */
export function collectionSkillName(
  rawName: string,
  collection: SkillCollection,
  taken: ReadonlySet<string>,
): { id: string; title: string } {
  const name = skillId(rawName);
  const clash = taken.has(name);
  const id = clash ? skillId(`${name}-${collection.id.split("-").pop()}`) : name;
  const title = name
    .split("-")
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
  return { id, title: clash ? `${title} (${collection.author})` : title };
}

/**
 * A collection's SKILL.md as it runs in AXISNotes: as a chat on the note, listed under the
 * collection, renamed when a built-in skill has its name.
 */
export function prepareSkill(
  text: string,
  folder: string,
  collection: SkillCollection,
  taken: ReadonlySet<string>,
): string {
  const fm = splitFrontmatter(text);
  const props = fm.props as Record<string, unknown>;
  const { id, title } = collectionSkillName(
    typeof props.name === "string" && props.name ? props.name : folder,
    collection,
    taken,
  );
  const keep = fm.yaml
    .split("\n")
    .filter((l) => !/^(name|title|output|reads|collection|source)\s*:/.test(l))
    .join("\n")
    .trim();
  const head = [
    "---",
    `name: ${id}`,
    `title: ${quote(title)}`,
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
