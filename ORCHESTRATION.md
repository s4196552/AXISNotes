# Dual-Agent Setup: Claude Code + OpenAI Codex

There are three ways to run the two agents together. **Option A is recommended**, and you can combine it with B and C.

## Prerequisites (all options)

```bash
git init
```
```bash
npm install -g @openai/codex
```
```bash
codex login
```

You also need: Claude Code (already installed), Node 20+, pnpm, the Rust toolchain, and the Tauri 2 prerequisites (on Windows: WebView2 and the MSVC Build Tools).

---

## Option A: Claude orchestrates, Codex runs as an MCP tool (recommended)

Claude Code is the lead. It calls Codex as a tool to build tasks and review code, with no copying and pasting between windows.

> **Status: set up (2026-09-26).** Codex CLI 0.157.1 no longer includes the `codex mcp-server` command, so Claude drives Codex through the CLI's first-party `codex exec` and `codex review` commands, using the two wrapper scripts below. The result is the same as the MCP bridge: Claude orchestrates and Codex builds and reviews.

| Script | What it does |
|---|---|
| `scripts/agents/codex-task.ps1 -TaskId T-###` | Reads `.agents/briefs/T-###.md`. Creates the worktree `..\axis-T-###` on branch `agent/codex/T-###` if it doesn't exist. Runs Codex there with a sandbox that can only write to the worktree and `.agents/`. Codex commits its work and writes its handoff note. The log goes to `.agents/logs/`. Optional `-Model gpt-6-sol`. |
| `scripts/agents/codex-review.ps1 -TaskId T-### -Worktree ..\axis-T-###` | Runs `codex review --base main` on that branch and writes the review to `.agents/reviews/T-###.md`. |

1. Start Claude Code in this folder and say:
   > Start Phase 0 per AXIS_BUILD_PROMPT.md, following AGENTS.md.
2. Claude writes the task board, writes a brief for each Codex task, runs `codex-task.ps1` (in the background, in parallel with its own work), reviews what Codex produces, sends its own branches to `codex-review.ps1`, and then merges.

*If a future Codex version brings back an MCP server, you can register it with `claude mcp add --scope project codex -- cmd /c codex <server-subcommand>` instead.*

**When to use it:** most of the time. There is one point of control, and every change is cross-reviewed automatically.

## Option B: Both agents side by side in VS Code

The agents share the file-based protocol in `AGENTS.md`, and you act as the dispatcher.

1. Install both extensions:
   - **Claude Code** (Anthropic)
   - **Codex** (OpenAI)
2. Open two VS Code windows, one per worktree (`axis/` for Claude and `../axis-T-###` for Codex), so the agents never edit the same checkout.
3. Tell each agent: *"Take your next `todo` task from `.agents/TASKS.md`."* Once a task is done, tell the other agent: *"Review T-### per AGENTS.md."*
4. Optional: you can also run the Codex CLI (`codex`) in a VS Code terminal instead of using its extension.

**When to use it:** when you want to watch both agents and step in often, or when one agent is stuck and you want the other to try.

## Option C: Computer use for visual QA of the desktop app

The Tauri app is a native window, so browser-only tools can't see all of it. Use computer use for **visual and exploratory testing at the end of each phase**, not for everyday building.

- **Claude:** in the Claude desktop app, enable computer use. Then ask it to launch `pnpm tauri dev`, work through the phase's acceptance criteria, and save screenshots to `.agents/qa/phase-N/`.
- **OpenAI:** Codex or ChatGPT agent mode with computer use can do the same pass. Useful as a second opinion on the UI.
- **Pen input and handwriting (Phase 3 and Phase 5):** computer use can draw with the mouse. For real stylus behavior, test by hand on a pen device.
- Deterministic regression tests still come from WebdriverIO + `tauri-driver`, which CI runs.

**Safety:** give computer-use sessions a test vault only, never your real notes, and never API keys that have large spending limits.

---

## Typical loop for a phase

```
Human: "Start Phase N"
  └─ Claude (lead): plan → write TASKS.md → create worktrees
       ├─ Claude builds its tasks (Rust core, architecture)
       └─ Codex (via MCP) builds its tasks (UI features, parsers, tests)
  └─ Cross-review each task → fix → approve → lead merges
  └─ Phase checkpoint: all tests pass + computer-use QA pass + screenshots
  └─ Lead reports to the human → you approve → next phase
```

## Alternatives worth knowing

- **Other MCP bridges:** community wrappers such as `ai-cli-mcp` can also drive the Gemini CLI, which makes a third agent possible.
- **Swapping roles:** Codex can be the lead instead. Add Claude Code to Codex's MCP config (`~/.codex/config.toml`) with the command `claude mcp serve`. Note that this mode exposes Claude Code's *tools* (reading files, editing, running commands) rather than a full autonomous agent, so Option A is still the stronger setup.
