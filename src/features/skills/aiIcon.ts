import { useConfig } from "../../app/config";

/** The icon what AI skills make gets in the file tree: the 🇦🇮 flag, which shows as "AI". */
export const AI_ICON = "\u{1F1E6}\u{1F1EE}";

/** Give `paths` the AI icon (an icon the user chose is kept). */
export async function giveAiIcon(paths: string[]) {
  const config = useConfig.getState().config;
  if (!paths.some((p) => !config.folderIcons[p])) return;
  await useConfig.getState().update((c) => {
    const folderIcons = { ...c.folderIcons };
    for (const p of paths) folderIcons[p] ??= { icon: AI_ICON };
    return { ...c, folderIcons };
  });
}
