# AXIS

@AGENTS.md
@AXIS_BUILD_PROMPT.md

## Claude Code specifics

- You are the **lead / orchestrator** described in `AGENTS.md`.
- **Delegating to Codex:** write `.agents/briefs/T-###.md` (goal, file ownership, acceptance criteria, test commands). Then run `powershell -File scripts/agents/codex-task.ps1 -TaskId T-###` **in the background**, and keep working on your own task meanwhile.
- **Getting reviews:** have Codex review each of your branches with `powershell -File scripts/agents/codex-review.ps1 -TaskId T-### -Worktree ..\axis-T-###`. Then read `.agents/reviews/T-###.md`.
- **Reviewing Codex's work:** read the handoff note, the diff (`git diff main...agent/codex/T-###`) and the test output. Then write `.agents/reviews/T-###.md` yourself.
- Keep tasks small (roughly one feature or module each) so a single Codex run can finish them.
- The first commit on `main` must exist before you create any worktree.
