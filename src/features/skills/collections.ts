import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { giveAiIcon } from "./aiIcon";
import { BUILTIN_SKILLS, SKILLS_DIR } from "./skills";
import { type SkillCollection, prepareSkill } from "./collectionSkills";

// Adding a skill collection (collectionSkills.ts) to a vault, as ordinary editable SKILL.md
// files under `Skills/<collection>/`.

export {
  COLLECTIONS,
  type SkillCollection,
  collectionAdded,
  prepareSkill,
} from "./collectionSkills";

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
