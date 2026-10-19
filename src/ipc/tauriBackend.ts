import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { Effect, getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import type { AiRunResult, Backend, Clipped, IndexProgress, VaultChange, VaultInfo } from "./types";
import { IMAGE_EXTENSIONS } from "../lib/attachments";

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
    writeFile: (path, content, expectedModifiedMs, vaultRoot) =>
      invoke("write_file", { path, content, expectedModifiedMs, vaultRoot }),
    createFile: (path, content, vaultRoot) => invoke("create_file", { path, content, vaultRoot }),
    createDir: (path) => invoke("create_dir", { path }),
    async pickImage() {
      const picked = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: [...IMAGE_EXTENSIONS] }],
      });
      return typeof picked === "string" ? picked : null;
    },
    importImage: (source, folder) => invoke("import_image", { source, folder }),
    listPacks: () => invoke("list_packs"),
    async pickPackSource(from) {
      const picked = await open(
        from === "folder"
          ? { directory: true, multiple: false }
          : { multiple: false, filters: [{ name: "Zip archives", extensions: ["zip"] }] },
      );
      return typeof picked === "string" ? picked : null;
    },
    importPack: (kind, source) => invoke("import_pack", { kind, source }),
    removePack: (kind, name) => invoke("remove_pack", { kind, name }),
    renameEntry: (from, to) => invoke("rename_entry", { from, to }),
    trashEntry: (path) => invoke("trash_entry", { path }),
    search: (query, limit) => invoke("search", { query, limit }),
    listTags: () => invoke("list_tags"),
    listPropertyKeys: () => invoke("list_property_keys"),
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
    updatesSettings: () => invoke("updates_settings"),
    updatesSaveSettings: (checkOnLaunch, folder) =>
      invoke("updates_save_settings", { checkOnLaunch, folder }),
    updatesCheck: () => invoke("updates_check"),
    updatesInstall: (version) => invoke("updates_install", { version }),
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
    setZoom: (factor) => getCurrentWebview().setZoom(factor),
    // The window is created transparent (tauri.conf.json); WebView2 shows what's behind.
    // macOS would need the private API, and Linux depends on the compositor.
    canBeTranslucent: () => /Windows/.test(navigator.userAgent),
    // Tauri applies a material on top of whatever was there (blur and acrylic are one
    // Windows mechanism, Mica another), so the old one is always cleared first.
    async setWindowEffect(effect) {
      const window = getCurrentWindow();
      await window.clearEffects();
      if (effect) await window.setEffects({ effects: [effect as Effect] });
    },
    async onCloseRequested(cb) {
      // Registering any listener keeps the window open (Tauri prevents the close while
      // JS listens); preventing here also stops the API from closing it after `cb`.
      return getCurrentWindow().onCloseRequested((e) => {
        e.preventDefault();
        cb();
      });
    },
    closeWindow: () => getCurrentWindow().destroy(),
    // The window is created without the system frame (tauri.conf.json); the title bar's
    // own buttons drive it.
    windowFrame: {
      minimize: () => getCurrentWindow().minimize(),
      toggleMaximize: () => getCurrentWindow().toggleMaximize(),
      requestClose: () => getCurrentWindow().close(),
      isMaximized: () => getCurrentWindow().isMaximized(),
      onResized: (cb) => getCurrentWindow().onResized(() => cb()),
    },
    listFonts: () => invoke("list_fonts"),
    async onIndexProgress(cb) {
      return listen<IndexProgress>(INDEX_PROGRESS_EVENT, (e) => cb(e.payload));
    },
  };
}
