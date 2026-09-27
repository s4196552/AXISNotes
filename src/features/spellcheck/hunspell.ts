import nspell from "nspell";
import type { Speller } from "./engine";

// The Hunspell engine itself (nspell). Only the worker and tests import it, so the
// dictionary code stays out of the app's main bundle.

const MAX_SUGGESTIONS = 6;

/** A synchronous Hunspell engine (used inside the worker, and directly in tests). */
export function createEngine(aff: string, dic: string) {
  const spell = nspell(aff, dic);
  return {
    correct: (word: string) => spell.correct(word),
    suggest: (word: string) => {
      // Swapped neighbouring letters ("teh", "recieve") are the most common typo, and
      // nspell often misses them, so real words one swap away come first.
      const swaps: string[] = [];
      for (let i = 0; i < word.length - 1; i++) {
        const w = word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
        if (w !== word && spell.correct(w) && !swaps.includes(w)) swaps.push(w);
      }
      return [...new Set([...swaps, ...spell.suggest(word)])].slice(0, MAX_SUGGESTIONS);
    },
  };
}

/** Wrap a synchronous engine as a `Speller`. */
export function engineSpeller(engine: ReturnType<typeof createEngine>): Speller {
  return {
    check: (words) => Promise.resolve(words.map((w) => engine.correct(w))),
    suggest: (word) => Promise.resolve(engine.suggest(word)),
  };
}
