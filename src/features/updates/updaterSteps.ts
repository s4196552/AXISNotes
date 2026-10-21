import { invoke } from "@tauri-apps/api/core";

/** The update being installed (`updater::Job` in src-tauri/src/updater.rs). */
export interface UpdateJob {
  fromVersion: string;
  toVersion: string;
  notes: string;
}

/** The update window's native steps, in one place so tests can stand in for them. */
export const updaterSteps = {
  job: () => invoke<UpdateJob>("updater_job"),
  install: () => invoke<void>("updater_install"),
  finish: (open: boolean) => invoke<void>("updater_finish", { open }),
};
