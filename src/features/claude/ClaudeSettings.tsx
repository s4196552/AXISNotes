import { useEffect, useState } from "react";
import { Check, Copy, EyeOff } from "lucide-react";
import { backend, type ClaudeConnectorInfo } from "../../ipc";
import { type AxisConfig, useConfig } from "../../app/config";
import { useAppStore } from "../../app/store";
import {
  ACTIVITY_PATH,
  desktopConfig,
  keptFromClaude,
  parseActivity,
  terminalCommand,
} from "./claude";
import "./claude.css";

// Settings → Claude: let Claude Desktop or Claude Code (on the user's own Claude plan)
// read and edit this vault through AXISNotes' MCP connector (src-tauri/src/mcp).

export function ClaudeSettings() {
  const config = useConfig((s) => s.config);
  const update = useConfig((s) => s.update);
  const vault = useAppStore((s) => s.vault);
  const [info, setInfo] = useState<ClaudeConnectorInfo | null | undefined>(undefined);
  const [activity, setActivity] = useState<ReturnType<typeof parseActivity>>([]);

  useEffect(() => {
    backend.claudeConnectorInfo().then(setInfo, () => setInfo(null));
  }, []);
  useEffect(() => {
    backend.readFile(ACTIVITY_PATH).then(
      (f) => setActivity(parseActivity(f.content).slice(0, 12)),
      () => setActivity([]),
    );
  }, [config.claude.enabled]);

  const setClaude = (patch: Partial<AxisConfig["claude"]>) =>
    void update((c) => ({ ...c, claude: { ...c.claude, ...patch } }));
  const kept = keptFromClaude(config.ai.folders);

  return (
    <div className="claude-settings">
      <p className="muted">
        Let Claude Desktop or Claude Code read and edit this vault, on your own Claude plan. Claude
        starts AXISNotes’ connector on this computer and talks to it directly; nothing listens on
        the network and AXISNotes doesn’t contact Anthropic. What Claude reads is sent to Claude
        like anything else you share with it.
      </p>
      <label className="claude-row">
        <input
          type="checkbox"
          aria-label="Let Claude open this vault"
          checked={config.claude.enabled}
          onChange={(e) => setClaude({ enabled: e.target.checked })}
        />
        Let Claude open this vault
      </label>
      <label className="claude-row">
        <input
          type="checkbox"
          aria-label="Allow changes"
          checked={config.claude.enabled && config.claude.allowChanges}
          disabled={!config.claude.enabled}
          onChange={(e) => setClaude({ allowChanges: e.target.checked })}
        />
        Allow changes: create notes, edit them and add to daily notes (never delete)
      </label>
      <p className="muted claude-kept">
        <EyeOff size={13} />{" "}
        {kept.length === 0
          ? "Folders set to “AI: local models only” or “AI: never” are kept from Claude. None are set in this vault."
          : `Kept from Claude by their AI rule: ${kept.join(", ")}.`}
      </p>

      <h3>Connect Claude</h3>
      {info === undefined ? null : info === null || !vault ? (
        <p className="muted">Available in the AXISNotes desktop app with a vault open.</p>
      ) : (
        <>
          <p className="muted">
            <strong>Claude Code:</strong> run this once in a terminal.
          </p>
          <Snippet label="Claude Code command" text={terminalCommand(info.exe, vault.root)} />
          <p className="muted">
            <strong>Claude Desktop:</strong> open Settings → Developer → Edit Config, add this to
            the file (merge it into an existing <code>mcpServers</code>), save, and restart Claude.
          </p>
          <Snippet label="Claude Desktop config" text={desktopConfig(info.exe, vault.root)} />
          <p className="muted">
            Then ask Claude things like “search my AXISNotes for mitochondria” or “add ‘call the
            dentist’ to today’s daily note”. Claude asks before it uses a tool. After AXISNotes
            updates, restart Claude if it shows AXISNotes as disconnected.
          </p>
        </>
      )}

      <h3>Recent activity</h3>
      {activity.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul className="claude-activity" aria-label="Recent Claude activity">
          {activity.map((a, i) => (
            <li key={`${a.time}-${i}`} className={a.ok ? undefined : "claude-failed"}>
              <span className="muted">{new Date(a.time).toLocaleString()}</span>{" "}
              <code>{a.tool}</code>
              {a.target ? ` ${a.target}` : ""}
              {a.ok ? "" : ` (refused: ${a.error ?? "error"})`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Snippet({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="claude-snippet">
      <pre aria-label={label}>{text}</pre>
      <button
        type="button"
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
