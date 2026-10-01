import { useState } from "react";
import { useConfig } from "../../app/config";
import { FEATURES, type FeatureId } from "./catalog";
export function FeaturesSettings() {
  const config = useConfig((s) => s.config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle(id: FeatureId, enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (id === "timeTracking" && !enabled) {
        const { useTimer } = await import("../time/timer");
        await useTimer.getState().prepareToDisable();
      }
      await useConfig
        .getState()
        .update((c) => ({ ...c, features: { ...c.features, [id]: enabled } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p>
        Choose optional tools for this vault. Disabling a feature keeps its files, settings and
        history.
      </p>
      {FEATURES.map((f) => (
        <div className="settings-field" key={f.id}>
          <div>
            <label className="settings-label" htmlFor={"feature-" + f.id}>
              {f.label}
            </label>
            <div className="settings-hint muted">{f.description}</div>
            {f.requires.some((id) => !config.features[id]) && (
              <div className="settings-hint">Enable AI assistance to use this feature.</div>
            )}
          </div>
          <input
            id={"feature-" + f.id}
            type="checkbox"
            checked={config.features[f.id]}
            disabled={busy}
            onChange={(e) => void toggle(f.id, e.target.checked)}
          />
        </div>
      ))}
      <div className="settings-field">
        <label htmlFor="feature-spelling">Offline spellcheck</label>
        <input
          id="feature-spelling"
          type="checkbox"
          checked={config.spellcheck.enabled}
          disabled={busy}
          onChange={(e) => {
            const enabled = e.target.checked;
            setBusy(true);
            void useConfig
              .getState()
              .update((c) => ({ ...c, spellcheck: { ...c.spellcheck, enabled } }))
              .catch((err: unknown) => setError(String(err)))
              .finally(() => setBusy(false));
          }}
        />
      </div>
      <p className="muted">
        Note editing, saving, tasks and daily notes stay available. Grids and canvases load when
        opened.
      </p>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
