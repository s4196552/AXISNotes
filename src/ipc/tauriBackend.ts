import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { Backend, VaultChange } from "./types";

export const VAULT_CHANGED_EVENT = "vault://changed";

export function createTauriBackend(): Backend {
  return {
    async pickFolder() {
      const picked = await open({ directory: true, multiple: false });
      return typeof picked === "string" ? picked : null;
    },
    openVault: (path) => invoke("open_vault", { path }),
    createVault: (parentDir, name) => invoke("create_vault", { parentDir, name }),
    currentVault: () => invoke("current_vault"),
    listTree: () => invoke("list_tree"),
    readFile: (path) => invoke("read_file", { path }),
    writeFile: (path, content, expectedModifiedMs) =>
      invoke("write_file", { path, content, expectedModifiedMs }),
    createFile: (path, content) => invoke("create_file", { path, content }),
    createDir: (path) => invoke("create_dir", { path }),
    renameEntry: (from, to) => invoke("rename_entry", { from, to }),
    trashEntry: (path) => invoke("trash_entry", { path }),
    async onVaultChanged(cb) {
      return listen<{ changes: VaultChange[] }>(VAULT_CHANGED_EVENT, (e) => cb(e.payload.changes));
    },
  };
}
