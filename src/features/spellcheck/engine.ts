// The spellchecker the editor talks to. The real one runs Hunspell (nspell + the SCOWL
// en_US dictionary) in a Web Worker so loading and suggesting never block typing.

import { useConfig } from "../../app/config";

export interface Speller {
  /** For each word, whether it is spelled correctly. */
  check(words: string[]): Promise<boolean[]>;
  suggest(word: string): Promise<string[]>;
  dispose?(): void;
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
  let disposed = false;
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const p = waiting.get(e.data.id);
    waiting.delete(e.data.id);
    if (!p) return;
    if (e.data.error !== undefined) p.reject(new Error(e.data.error));
    else p.resolve(e.data.result);
  };
  const call = <T>(msg: object) =>
    new Promise<T>((resolve, reject) => {
      if (disposed) {
        reject(new Error("Spellcheck is disabled"));
        return;
      }
      const id = next++;
      waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ id, ...msg });
    });
  return {
    dispose() {
      disposed = true;
      worker.terminate();
      for (const pending of waiting.values()) pending.reject(new Error("Spellcheck is disabled"));
      waiting.clear();
    },
    check: (words) => call<boolean[]>({ type: "check", words }),
    suggest: (word) => call<string[]>({ type: "suggest", word }),
  };
}

let current: Speller | null = null;
let consumers = 0;
/** A view leases the shared worker without starting it. Last close releases it. */
export function retainSpeller(): () => void {
  ++consumers;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--consumers === 0) stopSpeller();
  };
}

/** The app's speller, started on first use. */
export function getSpeller(): Speller {
  if (!useConfig.getState().config.spellcheck.enabled) return noSpeller;
  current ??= typeof Worker === "undefined" ? noSpeller : workerSpeller();
  return current;
}

export function stopSpeller() {
  current?.dispose?.();
  current = null;
}

/** Replace the speller (tests). */
export function setSpeller(speller: Speller | null) {
  stopSpeller();
  current = speller;
}
