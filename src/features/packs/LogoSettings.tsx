import { useEffect, useRef, useState } from "react";
import { backend, isBackendError } from "../../ipc";
import { useConfig } from "../../app/config";
import { useAppStore } from "../../app/store";
import { Logo } from "../../app/Logo";
import { BUILTIN_LOGOS } from "./builtinLogos";

export function LogoSettings() {
  const selected = useConfig((s) => s.config.appearance.logo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const save = (logo: string) =>
    useConfig.getState().update((c) => ({
      ...c,
      appearance: { ...c.appearance, logo },
    }));
  const choose = async (logo: string) => {
    setError("");
    try {
      await save(logo);
    } catch (e) {
      setError(isBackendError(e) || e instanceof Error ? e.message : String(e));
    }
  };
  const upload = async () => {
    const mine = ++generation.current;
    const root = useAppStore.getState().vault?.root;
    setBusy(true);
    setError("");
    try {
      const source = await backend.pickImage();
      if (!source || mine !== generation.current || useAppStore.getState().vault?.root !== root)
        return;
      const image = await backend.importImage(source, "Attachments/Branding");
      if (mine !== generation.current || useAppStore.getState().vault?.root !== root) return;
      await save(image.path);
      await useAppStore.getState().refreshTree();
    } catch (e) {
      if (mine === generation.current)
        setError(isBackendError(e) || e instanceof Error ? e.message : String(e));
    } finally {
      if (mine === generation.current) setBusy(false);
    }
  };
  return (
    <section aria-label="App logo">
      <h3>App logo</h3>
      <p className="settings-hint">
        Choose the logo shown inside AXISNotes and on its window and Windows taskbar for this vault.
        Uploads are copied into Attachments/Branding.
      </p>
      <Logo size={64} />
      <div
        role="group"
        aria-label="Default logo pack"
        style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }}
      >
        {BUILTIN_LOGOS.map((logo) => (
          <button
            key={logo.path}
            disabled={busy}
            aria-pressed={selected === logo.path || (!selected && logo === BUILTIN_LOGOS[0])}
            onClick={() => void choose(logo.path)}
          >
            <img
              src={logo.url}
              alt=""
              width={40}
              height={40}
              style={{ objectFit: "contain", verticalAlign: "middle" }}
            />{" "}
            {logo.title}
          </button>
        ))}
      </div>
      <button disabled={busy} onClick={() => void upload()}>
        {busy ? "Adding…" : "Upload custom logo…"}
      </button>{" "}
      <button disabled={busy || !selected} onClick={() => void choose("")}>
        Restore original logo
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
