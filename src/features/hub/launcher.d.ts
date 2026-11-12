import type { OpenDialogOptions } from "@tauri-apps/plugin-dialog";

export interface HubBridge {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  pick(options: OpenDialogOptions): Promise<string | string[] | null>;
  subscribe(listener: () => void): () => void;
}

export function mountHub(
  root: ShadowRoot,
  bridge: HubBridge,
  mode: "launcher" | "settings",
): () => void;
