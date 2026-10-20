import { isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { addDashboard, editWidgets, removeDashboard, type Widget } from "./dashboardModel";

// Saving dashboard layouts to the vault config. Kept apart from Dashboard.tsx so the file
// tree can add and remove dashboards without loading the dashboard view.

const report = (e: unknown) =>
  useAppStore.getState().setError(isBackendError(e) ? e.message : String(e));

/** Add (`on`) or remove a folder's dashboard. A removed layout is kept for adding back. */
export function setDashboard(folder: string, on: boolean) {
  void useConfig
    .getState()
    .update((c) => ({
      ...c,
      dashboards: on ? addDashboard(c.dashboards, folder) : removeDashboard(c.dashboards, folder),
    }))
    .catch(report);
}

/** Change a dashboard's widgets and save. */
export function saveWidgets(folder: string, fn: (widgets: Widget[]) => Widget[]) {
  void useConfig
    .getState()
    .update((c) => ({ ...c, dashboards: editWidgets(c.dashboards, folder, fn) }))
    .catch(report);
}
