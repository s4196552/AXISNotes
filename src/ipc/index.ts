import { createMemoryBackend, DEMO_VAULT } from "./memoryBackend";
import { createTauriBackend } from "./tauriBackend";
import type { Backend } from "./types";

export * from "./types";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Process-wide backend: real Rust core inside Tauri, in-memory demo vault in a browser. */
export const backend: Backend = inTauri ? createTauriBackend() : createMemoryBackend(DEMO_VAULT);
