/// <reference lib="webworker" />
import affUrl from "dictionary-en-files/index.aff?url";
import dicUrl from "dictionary-en-files/index.dic?url";
import { createEngine } from "./engine";

// Loads the Hunspell dictionary once (bundled with the app, so it works offline) and
// answers check/suggest requests from the editor.

type Msg = { id: number } & (
  { type: "check"; words: string[] } | { type: "suggest"; word: string }
);

const load = async () => {
  const [aff, dic] = await Promise.all([affUrl, dicUrl].map((u) => fetch(u).then((r) => r.text())));
  return createEngine(aff!, dic!);
};
let engine: ReturnType<typeof load> | null = null;

self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data;
  try {
    engine ??= load();
    const spell = await engine;
    const result =
      msg.type === "check" ? msg.words.map((w) => spell.correct(w)) : spell.suggest(msg.word);
    self.postMessage({ id: msg.id, result });
  } catch (err) {
    self.postMessage({ id: msg.id, error: String(err) });
  }
};
