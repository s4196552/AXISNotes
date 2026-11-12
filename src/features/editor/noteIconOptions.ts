import { closeCompletion, startCompletion, type Completion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { useAppStore } from "../../app/store";
import { backend, isBackendError } from "../../ipc";
import { currentVault, trackPending } from "../files/unsavedWork";
import { ICONS, iconWords, loadAllIcons, matchesIcon } from "../icons/iconSet";
import { matchesPackFile, packFileLabel, usePacks } from "../packs/packs";
import { getActiveEditor } from "./activeEditor";
import { iconGraphic, ICON_PACK_ROOT, inlineIconMarkdown, inlineIconTarget } from "./inlineIcons";

const ADD_SECTION = { name: "Add to your icons", rank: 1 };
const PACK_SECTION = { name: "Your icons", rank: 2 };
const ICON_SECTION = { name: "Built-in icons", rank: 3 };
const MY_ICONS = `${ICON_PACK_ROOT}My icons`;

interface IconCompletion extends Completion {
  iconTarget: string;
}

export function renderIconCompletion(completion: Completion) {
  if (!("iconTarget" in completion)) return null;
  const graphic = iconGraphic((completion as IconCompletion).iconTarget, "");
  if (!graphic) return null;
  const preview = document.createElement("span");
  preview.className = "cm-note-icon-preview";
  preview.setAttribute("aria-hidden", "true");
  preview.append(graphic);
  return preview;
}

let pending: { vault: string; load: Promise<void> } | undefined;

async function iconPacks(vault: string | null) {
  if (!vault) return [];
  const cached = usePacks.getState();
  if (!cached.loaded || cached.vaultRoot !== vault) {
    if (pending?.vault !== vault) {
      const load = cached.load();
      pending = { vault, load };
      void load.finally(() => {
        if (pending?.load === load) pending = undefined;
      });
    }
    await pending.load;
  }
  const current = usePacks.getState();
  return currentVault() === vault && current.vaultRoot === vault
    ? current.packs.filter((pack) => pack.kind === "icons")
    : [];
}

async function addIcon(view: EditorView, cursor: number) {
  const vault = currentVault();
  const doc = view.state.doc;
  if (!vault || view.state.readOnly) return;
  closeCompletion(view);
  const stillHere = () =>
    currentVault() === vault &&
    view.dom.isConnected &&
    getActiveEditor()?.view === view &&
    view.state.doc === doc &&
    view.state.selection.main.head === cursor;
  try {
    const source = await backend.pickImage();
    if (source && currentVault() === vault) {
      await trackPending(backend.importImage(source, MY_ICONS));
      if (currentVault() === vault) await usePacks.getState().load();
    }
    if (stillHere()) {
      view.focus();
      startCompletion(view);
    }
  } catch (error) {
    if (currentVault() === vault)
      useAppStore
        .getState()
        .setError(
          `Couldn't add the icon: ${isBackendError(error) ? error.message : String(error)}`,
        );
  }
}

export async function noteIconOptions(query: string): Promise<Completion[]> {
  const vault = currentVault();
  const [all, packs] = await Promise.all([
    query.length >= 2 ? loadAllIcons().catch(() => ICONS) : ICONS,
    iconPacks(vault),
  ]);
  const option = (
    label: string,
    iconTarget: string,
    section: Completion["section"],
    detail?: string,
  ): IconCompletion => ({
    label,
    iconTarget,
    section,
    detail,
    type: "note-icon",
    apply: inlineIconMarkdown(label, iconTarget),
  });
  const builtIn = Object.keys(query ? { ...ICONS, ...all } : ICONS)
    .filter((name) => matchesIcon(name, query))
    .slice(0, query ? 24 : 12)
    .map((name) => option(iconWords(name), `lucide:${name}`, ICON_SECTION));

  const imported: IconCompletion[] = [];
  const packQuery = query.replace(/[_-]+/g, " ");
  for (const pack of packs) {
    for (const file of pack.files) {
      if (imported.length >= 24) break;
      if (inlineIconTarget(file) && matchesPackFile(file, packQuery))
        imported.push(option(packFileLabel(file), file, PACK_SECTION, pack.name));
    }
    if (imported.length >= 24) break;
  }

  const add: IconCompletion = {
    label: "Add icon…",
    iconTarget: "lucide:Image",
    section: ADD_SECTION,
    type: "note-icon",
    apply: (view, _completion, _from, to) => void addIcon(view, to),
  };
  return [...(!query && vault ? [add] : []), ...imported, ...builtIn];
}
