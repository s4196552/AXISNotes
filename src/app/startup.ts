import { useAppStore } from "./store";
import { useConfig } from "./config";
import { activeTab, isEmpty } from "./tabs";
import { openDailyNote } from "../features/commands/actions";

/**
 * What a vault shows once its settings have loaded (Settings → Home & daily notes): today's
 * daily note and/or Home. The tabs restored from last time always stay. With both on, both
 * open and Home is the one showing. `cancelled` is checked after each wait.
 */
export async function openStartupPages(cancelled: () => boolean = () => false) {
  const { dailyNotes, home } = useConfig.getState().config;
  if (dailyNotes.openOnStartup) {
    await useAppStore.getState().refreshTree();
    const s = useAppStore.getState();
    if (cancelled() || s.activePath) return openHome();
    // With Home on too, a dashboard (or other view) showing keeps its tab.
    const newTab = home.openOnStartup && !isEmpty(activeTab(s.tabs));
    await openDailyNote(undefined, undefined, { newTab });
  }
  openHome();

  function openHome() {
    if (!cancelled() && home.openOnStartup) useAppStore.getState().openHomeOnStartup();
  }
}
