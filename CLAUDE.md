# AXIS

@AGENTS.md
@AXIS_BUILD_PROMPT.md

## Claude Code specifics

- You are the lead **and** the only builder/reviewer described in `AGENTS.md`: plan, build, verify and merge each task yourself.
- **Do not call Codex.** Don't run `scripts/agents/codex-task.ps1` or `codex-review.ps1` unless the human explicitly asks for Codex in that request.
- **Reviewing your own work:** before merging, read the full diff (`git diff <base>...agent/claude/T-###`), run `pnpm lint && pnpm typecheck && pnpm test` (plus `cargo test` for Rust changes), check user-visible changes in the preview or app, and write `.agents/reviews/T-###.md` with the verdict, findings and test results.
- Keep tasks small (roughly one feature or module each), one branch and worktree per task.
- The first commit on `main` must exist before you create any worktree.
