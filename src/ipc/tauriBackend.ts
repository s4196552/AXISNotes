import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { AiRunResult, Backend, Clipped, IndexProgress, VaultChange, VaultInfo } from "./types";

export const VAULT_CHANGED_EVENT = "vault://changed";
export const INDEX_PROGRESS_EVENT = "index://progress";
export const AI_DELTA_EVENT = "ai://delta";
export const CLIPPED_EVENT = "clipper://clipped";

export function createTauriBackend(): Backend {
  // The open vault's root, for file URLs (kept in sync by open/create/current).
  let root: string | null = null;
  const track = async (p: Promise<VaultInfo | null>) => {
    const v = await p;
    root = v?.root ?? null;
    return v;
  };
  return {
    async pickFolder() {
      const picked = await open({ directory: true, multiple: false });
      return typeof picked === "string" ? picked : null;
    },
    openVault: (path) => track(invoke<VaultInfo>("open_vault", { path })) as Promise<VaultInfo>,
    createVault: (parentDir, name) =>
      track(invoke<VaultInfo>("create_vault", { parentDir, name })) as Promise<VaultInfo>,
    currentVault: () => track(invoke<VaultInfo | null>("current_vault")),
    listTree: () => invoke("list_tree"),
    readFile: (path) => invoke("read_file", { path }),
    writeFile: (path, content, expectedModifiedMs) =>
      invoke("write_file", { path, content, expectedModifiedMs }),
    createFile: (path, content) => invoke("create_file", { path, content }),
    createDir: (path) => invoke("create_dir", { path }),
    renameEntry: (from, to) => invoke("rename_entry", { from, to }),
    trashEntry: (path) => invoke("trash_entry", { path }),
    search: (query, limit) => invoke("search", { query, limit }),
    listTags: () => invoke("list_tags"),
    listNotes: () => invoke("list_notes"),
    resolveLink: (target, from) => invoke("resolve_link", { target, from }),
    backlinks: (path) => invoke("backlinks", { path }),
    unlinkedMentions: (path) => invoke("unlinked_mentions", { path }),
    listAxisFiles: (subdir) => invoke("list_axis_files", { subdir }),
    graph: () => invoke("graph"),
    listTasks: () => invoke("list_tasks"),
    timeEntries: () => invoke("time_entries"),
    aiSettings: () => invoke("ai_settings"),
    aiSaveSettings: (settings) => invoke("ai_save_settings", { settings }),
    aiSetKey: (providerId, key) => invoke("ai_set_key", { providerId, key }),
    aiDeleteKey: (providerId) => invoke("ai_delete_key", { providerId }),
    aiTestProvider: (providerId) => invoke("ai_test_provider", { providerId }),
    aiListModels: (providerId) => invoke("ai_list_models", { providerId }),
    aiPlan: (request) => invoke("ai_plan", { request }),
    async aiRun(runId, request, onDelta) {
      const unlisten = await listen<{ runId: string; delta: string }>(AI_DELTA_EVENT, (e) => {
        if (e.payload.runId === runId) onDelta(e.payload.delta);
      });
      try {
        return await invoke<AiRunResult>("ai_run", { runId, request });
      } finally {
        unlisten();
      }
    },
    aiCancel: (runId) => invoke("ai_cancel", { runId }),
    aiLog: (limit) => invoke("ai_log", { limit }),
    clipperStatus: () => invoke("clipper_status"),
    clipperSetEnabled: (enabled) => invoke("clipper_set_enabled", { enabled }),
    clipperSetFolder: (folder) => invoke("clipper_set_folder", { folder }),
    clipperStartPairing: () => invoke("clipper_start_pairing"),
    clipperCancelPairing: () => invoke("clipper_cancel_pairing"),
    clipperRevoke: (id) => invoke("clipper_revoke", { id }),
    clipperOpenExtensionFolder: () => invoke("clipper_open_extension_folder"),
    async onClipped(cb) {
      return listen<Clipped>(CLIPPED_EVENT, (e) => cb(e.payload));
    },
    fileUrl(path) {
      if (!root) return null;
      const sep = root.includes("\\") ? "\\" : "/";
      return convertFileSrc(root.replace(/[\\/]+$/, "") + sep + path.split("/").join(sep));
    },
    inspectImport: (source) => invoke("inspect_import", { source }),
    importObsidian: (source, target) => invoke("import_obsidian", { source, target }),
    async onVaultChanged(cb) {
      return listen<{ changes: VaultChange[] }>(VAULT_CHANGED_EVENT, (e) => cb(e.payload.changes));
    },
    async onIndexProgress(cb) {
      return listen<IndexProgress>(INDEX_PROGRESS_EVENT, (e) => cb(e.payload));
    },
  };
}
