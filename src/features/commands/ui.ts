import { create } from "zustand";
import type { Section } from "../settings/Settings";
import type { FixMode } from "../ai/fixPrompt";

// Which modal is open. Prompts resolve a promise with the user's answers.

export type Modal =
  | { kind: "palette" }
  | { kind: "switcher" }
  | { kind: "templates"; mode: "insert" | "new" }
  | { kind: "settings"; section?: Section }
  | { kind: "getting-started" }
  | { kind: "icon"; path: string }
  | { kind: "colors"; path: string }
  | { kind: "allowed-models"; path: string }
  | { kind: "suggest"; path: string }
  | { kind: "ask"; path?: string; selection?: string; folder?: string; vault?: boolean }
  | { kind: "handwriting"; path: string }
  | { kind: "import" }
  | { kind: "move"; path: string }
  | { kind: "heatmap-add"; topic: string }
  | { kind: "heatmap-topic"; paths: string[] }
  | { kind: "heatmap-insert" }
  | { kind: "themes" }
  | { kind: "vaults" }
  | { kind: "diagram"; path: string; selection?: string }
  | {
      kind: "fix";
      path: string;
      from: number;
      to: number;
      original: string;
      scope: "selection" | "note";
      mode?: FixMode;
      /** An AI block's answer to review as changes to `original`. */
      proposed?: string;
    }
  | {
      kind: "prompt";
      title: string;
      questions: string[];
      initial?: Record<string, string>;
      resolve(answers: Record<string, string> | null): void;
    };

interface UiState {
  modal: Modal | null;
  open(modal: Exclude<Modal, { kind: "prompt" }>): void;
  close(): void;
  /** Ask one or more questions; resolves null if cancelled. */
  ask(
    title: string,
    questions: string[],
    initial?: Record<string, string>,
  ): Promise<Record<string, string> | null>;
}

export const useUi = create<UiState>((set, get) => ({
  modal: null,
  open(modal) {
    get().close();
    set({ modal });
  },
  close() {
    const m = get().modal;
    if (m?.kind === "prompt") m.resolve(null);
    set({ modal: null });
  },
  ask(title, questions, initial) {
    return new Promise((resolve) => {
      get().close();
      set({
        modal: {
          kind: "prompt",
          title,
          questions,
          initial,
          resolve: (a) => {
            set({ modal: null });
            resolve(a);
          },
        },
      });
    });
  },
}));
