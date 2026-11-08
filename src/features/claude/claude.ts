// Setup text and activity parsing for Settings → Claude (see ClaudeSettings.tsx).

import type { AiRule } from "../../ipc";

/** Metadata the connector logs for each tool call (src-tauri/src/mcp/mod.rs). */
export const ACTIVITY_PATH = ".axisnotes/claude-activity.jsonl";

export interface ClaudeActivity {
  time: number;
  tool: string;
  target?: string;
  ok: boolean;
  error?: string;
}

/** Newest first; lines that aren't valid entries are skipped. */
export function parseActivity(text: string): ClaudeActivity[] {
  const out: ClaudeActivity[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as Partial<ClaudeActivity>;
      if (typeof v.time === "number" && typeof v.tool === "string" && typeof v.ok === "boolean")
        out.push(v as ClaudeActivity);
    } catch {
      // A line cut off while it was written.
    }
  }
  return out.reverse();
}

/** Folders and files whose AI rule keeps them from cloud AI, and so from Claude. */
export function keptFromClaude(folders: Record<string, AiRule>): string[] {
  return Object.entries(folders)
    .filter(([, rule]) => rule !== "any")
    .map(([path]) => path.replace(/^\/+|\/+$/g, ""))
    .sort((a, b) => a.localeCompare(b));
}

/** The connector as Claude starts it: this program with `--mcp --vault <folder>`. */
export function connectorArgs(vaultRoot: string): string[] {
  return ["--mcp", "--vault", vaultRoot];
}

const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** Adds AXISNotes to Claude Code for every project (`--scope user`). */
export function terminalCommand(exe: string, vaultRoot: string): string {
  return `claude mcp add --scope user axisnotes -- ${quote(exe)} ${connectorArgs(vaultRoot)
    .map((a) => (a.startsWith("--") ? a : quote(a)))
    .join(" ")}`;
}

/** The `mcpServers` entry for Claude Desktop's claude_desktop_config.json. */
export function desktopConfig(exe: string, vaultRoot: string): string {
  return JSON.stringify(
    { mcpServers: { axisnotes: { command: exe, args: connectorArgs(vaultRoot) } } },
    null,
    2,
  );
}
