import { create } from "zustand";
import { type AiEffort, type AiModel, type AiPlan, type AiRunResult, backend } from "../../ipc";

// State of each AI block in the editor, kept outside React so a block keeps its prompt
// and streaming answer when CodeMirror redraws or recreates the block's DOM (scrolling
// it out of view and back, for example).

export interface AiChoice {
  /** Unset = the provider and model chosen for "Chat and other" in Settings → AI. */
  provider?: string;
  model?: string;
  effort: AiEffort;
}

export type AiBlockPhase =
  | { kind: "idle" }
  | { kind: "confirm"; plan: AiPlan }
  | { kind: "running"; runId: string; thinking: boolean }
  | { kind: "done"; result: AiRunResult }
  | { kind: "error"; message: string; blocked: boolean };

export interface AiBlockState {
  prompt: string;
  /** Send the note the block is in. */
  useNote: boolean;
  /** Send the text that was selected when the block opened. */
  useSelection: boolean;
  /** Put the prompt above the answer (as an `[!ai]` callout) when inserting. */
  keepPrompt: boolean;
  choice: AiChoice;
  phase: AiBlockPhase;
  answer: string;
}

interface AiBlocksStore {
  blocks: Record<string, AiBlockState>;
  init(id: string, state: AiBlockState): void;
  patch(id: string, patch: Partial<AiBlockState>): void;
  appendAnswer(id: string, delta: string): void;
  remove(id: string): void;
}

export const useAiBlocks = create<AiBlocksStore>((set) => ({
  blocks: {},
  init: (id, state) => set((s) => (s.blocks[id] ? s : { blocks: { ...s.blocks, [id]: state } })),
  patch: (id, patch) =>
    set((s) => {
      const cur = s.blocks[id];
      return cur ? { blocks: { ...s.blocks, [id]: { ...cur, ...patch } } } : s;
    }),
  appendAnswer: (id, delta) =>
    set((s) => {
      const cur = s.blocks[id];
      if (!cur) return s;
      const phase =
        cur.phase.kind === "running" && cur.phase.thinking
          ? { ...cur.phase, thinking: false }
          : cur.phase;
      return { blocks: { ...s.blocks, [id]: { ...cur, answer: cur.answer + delta, phase } } };
    }),
  remove: (id) =>
    set((s) => {
      if (!s.blocks[id]) return s;
      const blocks = { ...s.blocks };
      delete blocks[id];
      return { blocks };
    }),
}));

// ---- The last model and effort picked, per vault (this device only) ----

const choiceKey = (vaultRoot: string) => `axis.aiBlock.choice:${vaultRoot}`;

export function loadChoice(vaultRoot: string | undefined): AiChoice | null {
  if (!vaultRoot) return null;
  try {
    const raw = localStorage.getItem(choiceKey(vaultRoot));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<AiChoice>;
    if (v.effort !== "quick" && v.effort !== "balanced" && v.effort !== "deep") return null;
    return {
      effort: v.effort,
      ...(typeof v.provider === "string" && typeof v.model === "string"
        ? { provider: v.provider, model: v.model }
        : {}),
    };
  } catch {
    return null;
  }
}

export function saveChoice(vaultRoot: string | undefined, choice: AiChoice) {
  if (!vaultRoot) return;
  try {
    localStorage.setItem(choiceKey(vaultRoot), JSON.stringify(choice));
  } catch {
    // Storage blocked: the choice just isn't remembered.
  }
}

/** The prompt as a collapsed callout above the answer, when "Keep prompt" is on. */
export const promptCallout = (prompt: string) =>
  `> [!ai]- ${prompt.trim().split(/\r?\n/).join(" ")}\n\n`;

// ---- Model lists and labels for the model picker ----

export const EFFORT_LABELS: Record<AiEffort, string> = {
  quick: "Quick",
  balanced: "Balanced",
  deep: "Deep",
};

const modelCache = new Map<string, Promise<AiModel[]>>();

/** A provider's models (fetched once per session; the built-in list if that fails). */
export function modelsOf(providerId: string): Promise<AiModel[]> {
  let p = modelCache.get(providerId);
  if (!p) {
    p = backend.aiListModels(providerId).then(
      (r) => r.models,
      () => [],
    );
    modelCache.set(providerId, p);
  }
  return p;
}

/** For tests: forget the fetched model lists. */
export function clearModelCache() {
  modelCache.clear();
}
