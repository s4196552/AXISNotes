import { demoAnswer } from "./demoAi";
import { setAiResponder } from "./memoryAi";
import { createMemoryBackend, DEMO_VAULT } from "./memoryBackend";
import { createTauriBackend } from "./tauriBackend";
import type { Backend } from "./types";
import { withAiActivity } from "./aiActivity";

export * from "./types";
export { type AiActivityEvent, onAiActivity } from "./aiActivity";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Process-wide backend: real Rust core inside Tauri, in-memory demo vault in a browser. */
export const backend: Backend = withAiActivity(inTauri ? createTauriBackend() : browserBackend());

function browserBackend(): Backend {
  const b = createMemoryBackend(DEMO_VAULT);
  // The browser preview's "Open in new window": a popup with its own copy of the demo vault.
  if (import.meta.env.MODE !== "test")
    b.appWindows = {
      async openNote(path) {
        window.open(`?note=${encodeURIComponent(path)}`, "_blank", "popup,width=1040,height=760");
      },
    };
  return b;
}

// The browser preview answers AI requests with canned demo text (never in tests).
if (!inTauri && import.meta.env.MODE !== "test") setAiResponder(demoAnswer);
