import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, mergeConfig, useConfig } from "../../app/config";
import { useAppStore } from "../../app/store";
import { ClaudeSettings } from "./ClaudeSettings";
import { desktopConfig, keptFromClaude, parseActivity, terminalCommand } from "./claude";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const EXE = "C:\\Users\\me\\AppData\\Local\\Programs\\AXISNotes\\AXISNotes.exe";
const VAULT = "A:\\M. PROJECTS\\My Vault";

beforeEach(async () => {
  h.b = createMemoryBackend({});
  const info = await h.b.openVault("/v");
  useAppStore.setState({ vault: { ...info, root: VAULT } });
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
});

describe("setup text", () => {
  it("quotes paths with spaces for the Claude Code command", () => {
    expect(terminalCommand(EXE, VAULT)).toBe(
      `claude mcp add --scope user axisnotes -- "${EXE}" --mcp --vault "${VAULT}"`,
    );
  });

  it("writes a Claude Desktop entry that round-trips the Windows paths", () => {
    const parsed = JSON.parse(desktopConfig(EXE, VAULT));
    expect(parsed).toEqual({
      mcpServers: { axisnotes: { command: EXE, args: ["--mcp", "--vault", VAULT] } },
    });
  });

  it("lists what the AI rules keep from Claude", () => {
    expect(keptFromClaude({ "/Medical/": "never", School: "any", Journal: "local" })).toEqual([
      "Journal",
      "Medical",
    ]);
  });

  it("reads the activity log newest first and skips broken lines", () => {
    const log = [
      '{"time":1,"tool":"read_note","target":"A.md","ok":true}',
      "{broken",
      '{"time":2,"tool":"append_to_note","ok":false,"error":"read-only"}',
      "",
    ].join("\n");
    expect(parseActivity(log).map((a) => a.tool)).toEqual(["append_to_note", "read_note"]);
  });
});

describe("Settings → Claude", () => {
  it("saves both switches in the vault config, changes only once access is on", async () => {
    render(<ClaudeSettings />);
    const changes = screen.getByLabelText("Allow changes");
    expect(changes).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Let Claude open this vault"));
    await waitFor(() => expect(useConfig.getState().config.claude.enabled).toBe(true));
    expect(screen.getByLabelText("Allow changes")).not.toBeDisabled();
    fireEvent.click(screen.getByLabelText("Allow changes"));
    await waitFor(async () => {
      const saved = JSON.parse((await h.b.readFile(".axisnotes/config.json")).content);
      expect(saved.claude).toEqual({ enabled: true, allowChanges: true });
    });
  });

  it("explains that setup needs the desktop app in a browser preview", async () => {
    render(<ClaudeSettings />);
    expect(await screen.findByText(/Available in the AXISNotes desktop app/)).toBeInTheDocument();
  });

  it("shows the setup snippets with this program and vault", async () => {
    h.b.claudeConnectorInfo = async () => ({ exe: EXE });
    render(<ClaudeSettings />);
    const cmd = await screen.findByLabelText("Claude Code command");
    expect(cmd.textContent).toBe(terminalCommand(EXE, VAULT));
    expect(screen.getByLabelText("Claude Desktop config").textContent).toBe(
      desktopConfig(EXE, VAULT),
    );
  });

  it("lists recent activity from the connector's log", async () => {
    await h.b.writeFile(
      ".axisnotes/claude-activity.jsonl",
      '{"time":1700000000000,"tool":"search_notes","ok":true}\n',
    );
    render(<ClaudeSettings />);
    expect(await screen.findByText("search_notes")).toBeInTheDocument();
  });

  it("keeps access off for vaults saved before this setting existed", () => {
    expect(mergeConfig({ theme: "dark" }).claude).toEqual({ enabled: false, allowChanges: false });
  });
});
