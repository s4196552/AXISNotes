import nspell from "nspell";

// The spellchecker the editor talks to. The real one runs Hunspell (nspell + the SCOWL
// en_US dictionary) in a Web Worker so loading and suggesting never block typing.

export interface Speller {
  /** For each word, whether it is spelled correctly. */
  check(words: string[]): Promise<boolean[]>;
  suggest(word: string): Promise<string[]>;
}

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

/** Accepts everything (no worker available, e.g. in unit tests). */
export const noSpeller: Speller = {
  check: (words) => Promise.resolve(words.map(() => true)),
  suggest: () => Promise.resolve([]),
};

type Reply = { id: number; result?: unknown; error?: string };

function workerSpeller(): Speller {
  const worker = new Worker(new URL("./speller.worker.ts", import.meta.url), { type: "module" });
  const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  let next = 0;
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const p = waiting.get(e.data.id);
    waiting.delete(e.data.id);
    if (!p) return;
    if (e.data.error !== undefined) p.reject(new Error(e.data.error));
    else p.resolve(e.data.result);
  };
  const call = <T>(msg: object) =>
    new Promise<T>((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, ...msg });
    });
  return {
    check: (words) => call<boolean[]>({ type: "check", words }),
    suggest: (word) => call<string[]>({ type: "suggest", word }),
  };
}

let current: Speller | null = null;

/** The app's speller, started on first use. */
export function getSpeller(): Speller {
  current ??= typeof Worker === "undefined" ? noSpeller : workerSpeller();
  return current;
}

/** Replace the speller (tests). */
export function setSpeller(speller: Speller | null) {
  current = speller;
}
