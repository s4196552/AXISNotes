import { Suspense, useState } from "react";
import { useConfig } from "../../app/config";
import { useAppStore } from "../../app/store";
import { HubView } from "../hub";

export function PluginsSettings() {
  const enabled = useConfig((state) => state.config.hubEnabled);
  const update = useConfig((state) => state.update);
  const [managing, setManaging] = useState(false);

  function setEnabled(enabled: boolean) {
    if (!enabled && useAppStore.getState().leftPanel === "hub") {
      // Only move the selection off Hub: setLeftPanel would bring back a Files panel the
      // user removed (T-276).
      useAppStore.setState({ leftPanel: "files" });
    }
    if (!enabled) setManaging(false);
    void update((config) => ({ ...config, hubEnabled: enabled }));
  }

  return (
    <section aria-label="AXIS Hub plugin">
      <label>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{" "}
        Enable AXIS Hub
      </label>
      <p className="muted">Open AXIS Hub in either sidebar or add it from dashboard Customize.</p>
      {enabled && (
        <button type="button" aria-expanded={managing} onClick={() => setManaging(!managing)}>
          {managing ? "Close shortcut packs" : "Manage shortcut packs"}
        </button>
      )}
      {enabled && managing && (
        <Suspense fallback={<p className="muted">Opening AXIS Hub…</p>}>
          <HubView mode="settings" />
        </Suspense>
      )}
    </section>
  );
}
