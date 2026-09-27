import { Logo } from "../../app/Logo";
import { useAppStore } from "../../app/store";
import { useUi } from "../commands/ui";

// Settings → About: version, where things are stored, and help.

export function About() {
  const vault = useAppStore((s) => s.vault);
  const open = useUi((s) => s.open);
  return (
    <div className="about">
      <p className="about-title">
        <Logo size={40} />
        <span>
          <strong>AXIS</strong> {__AXIS_VERSION__}
          <br />
          <span className="muted">A local-first knowledge base. Everything works offline.</span>
        </span>
      </p>
      <h3>Where your things are</h3>
      <ul>
        <li>
          <strong>Notes, grids and canvases:</strong> plain files in your vault
          {vault && (
            <>
              {" "}
              — <code>{vault.root}</code>
            </>
          )}
          .
        </li>
        <li>
          <strong>Vault settings</strong> (themes, templates, commands, shortcuts, AI folder rules):{" "}
          <code>.axis/config.json</code> in the vault. The search index in <code>.axis/</code> is a
          cache and rebuilds itself.
        </li>
        <li>
          <strong>AI keys:</strong> your system keychain, never in files. AI and web clipper
          settings are kept in the app’s own settings folder, not in the vault.
        </li>
      </ul>
      <div className="about-actions">
        <button onClick={() => open({ kind: "getting-started" })}>Getting started</button>
        <button onClick={() => open({ kind: "import" })}>Import from Obsidian…</button>
      </div>
      <h3>Open source</h3>
      <p className="muted">
        Built with Tauri, React, CodeMirror, SQLite, Excalidraw, Mermaid, Sigma.js, nspell and the
        SCOWL dictionary, Readability and Turndown, and other open-source libraries under MIT,
        Apache-2.0, BSD and ISC licenses.
      </p>
    </div>
  );
}
