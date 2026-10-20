import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { describeUnsaved, saveAll } from "../files/unsavedWork";
import { useUi } from "../commands/ui";
import { registerCommands } from "../commands/registry";

// Switching to another vault from inside one (the vault menu and "Open another vault…").
// Open notes are saved first; if one can't be, the switch doesn't happen.

async function savedEverything(): Promise<boolean> {
  const unsaved = await saveAll();
  if (unsaved.length === 0) return true;
  useAppStore
    .getState()
    .setError(`Didn't switch vaults: ${describeUnsaved(unsaved)} isn't saved yet.`);
  return false;
}

export async function switchVault(root: string) {
  if (root === useAppStore.getState().vault?.root) return;
  if (await savedEverything()) await useAppStore.getState().openVault(root);
}

export async function openVaultFolder() {
  const folder = await backend.pickFolder();
  if (folder) await switchVault(folder);
}

/** Ask for a name, then for the folder to create it in. */
export async function createVaultFromMenu() {
  const answers = await useUi.getState().ask("Create a new vault", ["Vault name"], {
    "Vault name": "My Vault",
  });
  const name = answers?.["Vault name"]?.trim();
  if (!name) return;
  const parent = await backend.pickFolder();
  if (!parent || !(await savedEverything())) return;
  await useAppStore.getState().createVault(parent, name);
}

export function revealVault() {
  void backend
    .revealEntry("")
    .catch((e: unknown) =>
      useAppStore.getState().setError(isBackendError(e) ? e.message : String(e)),
    );
}

registerCommands([
  {
    id: "open-vault",
    label: "Open another vault…",
    run: () => useUi.getState().open({ kind: "vaults" }),
  },
  { id: "reveal-vault", label: "Show vault in File Explorer", run: revealVault },
]);
