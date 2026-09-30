import type { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { useConfig } from "../../app/config";
import { getSpeller, stopSpeller, retainSpeller } from "./engine";
import { spellcheck } from "./spellcheck";
import "./spellcheck.css";

export { recheck, openSpellFix } from "./spellcheck";

useConfig.subscribe((state) => {
  if (!state.config.spellcheck.enabled) stopSpeller();
});

let known: { words: string[]; set: Set<string> } | null = null;

function personal(): Set<string> {
  const words = useConfig.getState().config.spellcheck.words;
  if (known?.words !== words) known = { words, set: new Set(words) };
  return known.set;
}

/** Spellcheck as configured for this vault (nothing when it's turned off). */
export function configuredSpellcheck(): Extension {
  if (!useConfig.getState().config.spellcheck.enabled) return [];
  return [
    ViewPlugin.define(() => ({ destroy: retainSpeller() })),
    spellcheck({
      speller: {
        check: (words) => getSpeller().check(words),
        suggest: (word) => getSpeller().suggest(word),
      },
      isKnown: (word) => personal().has(word),
      addWord: (word) =>
        void useConfig.getState().update((c) => ({
          ...c,
          spellcheck: {
            ...c.spellcheck,
            words: [...new Set([...c.spellcheck.words, word])].sort(),
          },
        })),
    }),
  ];
}
