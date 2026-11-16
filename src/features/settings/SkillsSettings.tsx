import { useEffect, useState } from "react";
import { Check, FilePlus2, FolderInput, Plus, Trash2 } from "lucide-react";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { giveAiIcon } from "../skills/aiIcon";
import { groupSkills } from "../skills/skillGroups";
import { COLLECTIONS, addCollection, collectionAdded } from "../skills/collections";
import {
  SKILLS_DIR,
  type Skill,
  type SkillOutput,
  copyBuiltinsToVault,
  isAppSkill,
  newSkillFile,
  loadVaultSkills,
  skillId,
  skillList,
  useSkills,
} from "../skills/skills";
import { BUILTIN_SKILL_FILES } from "../skills/builtinSkills";
import { isBundledSource } from "../skills/collectionSkills";
import { useConfig } from "../../app/config";

// Settings → AI → Skills: every skill the command menu offers, making new ones, importing
// skills written for other AI tools (a folder with a SKILL.md, as Claude Code uses), and
// adding skill collections such as Matt Pocock's. Skills are plain SKILL.md notes in the
// vault's Skills folder, so they can also be edited like any note.

const OUTPUT_LABELS: Record<Exclude<SkillOutput, "files">, string> = {
  markdown: "Markdown in the note",
  html: "A web page",
  chat: "A chat",
};

/** One empty list, so the config selector returns the same value each render. */
const NONE_HIDDEN: string[] = [];

const message = (e: unknown) => (isBackendError(e) || e instanceof Error ? e.message : String(e));

function NewSkill({ onDone }: { onDone(text: string): void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [output, setOutput] = useState<Exclude<SkillOutput, "files">>("markdown");
  const [folder, setFolder] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const id = skillId(name);
  const create = async () => {
    setError("");
    if (useSkills.getState().skills.some((s) => s.id === id && !isAppSkill(s))) {
      setError(`There's already a skill called /${id}.`);
      return;
    }
    const path = `${SKILLS_DIR}/${id}/SKILL.md`;
    try {
      await backend.createFile(
        path,
        newSkillFile({ name, description, output, folder, instructions }),
      );
      await giveAiIcon([`${SKILLS_DIR}/${id}`]);
      await useAppStore.getState().refreshTree();
      await loadVaultSkills();
      onDone(
        `Added /${id}. Run it from a note's command menu (Ctrl+/); edit it any time in ${path}.`,
      );
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <form
      className="skill-new"
      aria-label="New skill"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <label>
        Name
        <input
          aria-label="Skill name"
          value={name}
          placeholder="e.g. Summarise for my teacher"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {id && <span className="muted skill-new-id">Runs as /{id}</span>}
      <label>
        What it does
        <input
          aria-label="Skill description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="skill-new-row">
        <label>
          Answers as
          <select
            aria-label="Answers as"
            value={output}
            onChange={(e) => setOutput(e.target.value as typeof output)}
          >
            {Object.entries(OUTPUT_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reads
          <select
            aria-label="Reads"
            value={folder ? "folder" : "note"}
            onChange={(e) => setFolder(e.target.value === "folder")}
          >
            <option value="note">The note it's run in</option>
            <option value="folder">Every note in that note's folder</option>
          </select>
        </label>
      </div>
      <label>
        Instructions for the AI
        <textarea
          aria-label="Skill instructions"
          rows={8}
          value={instructions}
          placeholder="Tell the AI what to do with the note, step by step, and how the answer should look."
          onChange={(e) => setInstructions(e.target.value)}
        />
      </label>
      {error && (
        <p className="settings-hint error" role="alert">
          {error}
        </p>
      )}
      <div className="skill-new-row">
        <button type="submit" className="primary" disabled={!id || !instructions.trim()}>
          <Check size={14} aria-hidden="true" /> Create skill
        </button>
      </div>
    </form>
  );
}

function SkillRow({ skill, onStatus }: { skill: Skill; onStatus(text: string): void }) {
  const builtIn = skill.source === "built-in";
  const bundled = isBundledSource(skill.source);
  const folder = skill.source.slice(0, skill.source.lastIndexOf("/"));
  const customise = async () => {
    try {
      const path = `${SKILLS_DIR}/${skill.id}/SKILL.md`;
      await backend.createFile(path, BUILTIN_SKILL_FILES[skill.id] ?? "");
      await giveAiIcon([`${SKILLS_DIR}/${skill.id}`]);
      await useAppStore.getState().refreshTree();
      await loadVaultSkills();
      onStatus(`Copied /${skill.id} to ${path}. Your copy is used from now on; edit it there.`);
    } catch (e) {
      onStatus(message(e));
    }
  };
  const remove = async () => {
    if (!window.confirm(`Move the skill “${skill.title}” (${folder}) to the trash?`)) return;
    try {
      await backend.trashEntry(folder);
      const store = useAppStore.getState();
      await store.refreshTree();
      store.onEntryRemoved(folder);
      await loadVaultSkills();
      onStatus(`Moved ${folder} to the trash.`);
    } catch (e) {
      onStatus(message(e));
    }
  };
  return (
    <li className="skill-row">
      <div className="skill-row-text">
        <span className="skill-row-title">{skill.title}</span>{" "}
        <code className="skill-row-id">/{skill.id}</code>
        {skill.description && <div className="muted skill-row-desc">{skill.description}</div>}
        <div className="muted skill-row-source">
          {builtIn
            ? "Built in"
            : bundled
              ? `Bundled with the app · add ${skill.collection ?? "the collection"}'s skills to this vault to edit it`
              : skill.source}
        </div>
      </div>
      {bundled ? null : builtIn ? (
        BUILTIN_SKILL_FILES[skill.id] && (
          <button
            aria-label={`Customise ${skill.title}`}
            title="Copy it into the vault to edit"
            onClick={() => void customise()}
          >
            Customise
          </button>
        )
      ) : (
        <button
          className="ai-icon"
          aria-label={`Remove ${skill.title}`}
          title="Move to the trash"
          onClick={() => void remove()}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

export function SkillsSettings() {
  const skills = useSkills((s) => s.skills);
  const hidden = useConfig((s) => s.config.ai.hiddenCollections ?? NONE_HIDDEN);
  const updateConfig = useConfig((s) => s.update);
  const paths = useAppStore((s) => s.notes.map((n) => n.path).join("\n"));
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  // Start watching the vault's Skills folder (it isn't, until skills are first used).
  useEffect(() => {
    skillList();
  }, []);

  const importSkill = async () => {
    setStatus("");
    try {
      const source = await backend.pickSkill();
      if (!source) return;
      setBusy("import");
      const path = await backend.importSkill(source);
      await giveAiIcon([path.slice(0, path.lastIndexOf("/"))]);
      await useAppStore.getState().refreshTree();
      await loadVaultSkills();
      setStatus(`Imported ${path}. Run it from a note's command menu (Ctrl+/).`);
    } catch (e) {
      setStatus(message(e));
    } finally {
      setBusy("");
    }
  };
  const copyBuiltins = async () => {
    setStatus("");
    try {
      const n = await copyBuiltinsToVault();
      await loadVaultSkills();
      setStatus(
        n
          ? `Added ${n} built-in skill${n === 1 ? "" : "s"} to the ${SKILLS_DIR} folder to edit.`
          : `The ${SKILLS_DIR} folder already has every built-in skill.`,
      );
    } catch (e) {
      setStatus(message(e));
    }
  };

  return (
    <div className="skills-settings">
      <p className="settings-hint muted">
        A skill is a set of instructions for the AI that you run from a note: open the command menu
        (<kbd>Ctrl</kbd>+<kbd>/</kbd>) and pick it, or type its name to find it. Each one is a{" "}
        <code>SKILL.md</code> note in the vault's <code>{SKILLS_DIR}</code> folder, the same layout
        Claude Code and other AI tools use, so you can edit it like any note.
      </p>
      <div className="skills-actions">
        <button onClick={() => setCreating((c) => !c)} aria-expanded={creating}>
          <Plus size={14} aria-hidden="true" /> New skill
        </button>
        <button disabled={busy === "import"} onClick={() => void importSkill()}>
          <FolderInput size={14} aria-hidden="true" />{" "}
          {busy === "import" ? "Importing…" : "Import skill…"}
        </button>
        <button onClick={() => void copyBuiltins()}>
          <FilePlus2 size={14} aria-hidden="true" /> Copy the built-in skills to edit
        </button>
      </div>
      {status && (
        <p className="settings-hint" role="status">
          {status}
        </p>
      )}
      {creating && (
        <NewSkill
          onDone={(text) => {
            setCreating(false);
            setStatus(text);
          }}
        />
      )}

      <section className="ai-section" aria-label="Skill collections">
        <h3>Skill collections</h3>
        {COLLECTIONS.map((c) => {
          const added = collectionAdded(c, paths ? paths.split("\n") : []);
          return (
            <div key={c.id} className="skill-collection">
              <div>
                <div className="skill-row-title">{c.name}</div>
                <div className="muted">{c.description}</div>
                <div className="muted skill-row-source">
                  {c.license} licence ·{" "}
                  <a href={c.url} target="_blank" rel="noreferrer">
                    {c.url.replace("https://", "")}
                  </a>{" "}
                  ·{" "}
                  {added
                    ? `in this vault: ${SKILLS_DIR}/${c.folder}`
                    : `bundled; adding them to this vault (${SKILLS_DIR}/${c.folder}) lets you edit them`}
                </div>
                {!added && (
                  <label className="skill-collection-menu">
                    <input
                      type="checkbox"
                      checked={!hidden.includes(c.id)}
                      onChange={(e) => {
                        const show = e.target.checked;
                        void updateConfig((cfg) => {
                          const rest = (cfg.ai.hiddenCollections ?? []).filter((id) => id !== c.id);
                          return {
                            ...cfg,
                            ai: { ...cfg.ai, hiddenCollections: show ? rest : [...rest, c.id] },
                          };
                        });
                      }}
                    />{" "}
                    Show in the command menu (Ctrl+/)
                  </label>
                )}
              </div>
              <button
                disabled={busy === c.id}
                onClick={async () => {
                  setStatus("");
                  setBusy(c.id);
                  try {
                    const n = await addCollection(c);
                    await loadVaultSkills();
                    setStatus(
                      n
                        ? `Added ${n} skills from ${c.name} to ${SKILLS_DIR}/${c.folder}.`
                        : `${c.name} are already in this vault.`,
                    );
                  } catch (e) {
                    setStatus(message(e));
                  } finally {
                    setBusy("");
                  }
                }}
              >
                {busy === c.id ? "Adding…" : added ? "Add missing skills" : "Add to this vault"}
              </button>
            </div>
          );
        })}
      </section>

      <section className="ai-section" aria-label="All skills">
        <h3>Skills</h3>
        {groupSkills(skills).map((g) => (
          <div key={g.name} className="skill-group">
            <h4>{g.name}</h4>
            <ul className="skill-list">
              {g.skills.map((s) => (
                <SkillRow key={s.id} skill={s} onStatus={setStatus} />
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
