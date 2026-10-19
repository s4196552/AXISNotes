# AXIS

@AGENTS.md
@AXIS_BUILD_PROMPT.md

## Claude Code specifics

- You are the lead **and** the only builder/reviewer described in `AGENTS.md`: plan, build, verify and merge each task yourself.
- **Do not call Codex.** Don't run `scripts/agents/codex-task.ps1` or `codex-review.ps1` unless the human explicitly asks for Codex in that request.
- **Reviewing your own work:** before merging, read the full diff (`git diff <base>...agent/claude/T-###`), run `pnpm lint && pnpm typecheck && pnpm test` (plus `cargo test` for Rust changes), check user-visible changes in the preview or app, and write `.agents/reviews/T-###.md` with the verdict, findings and test results.
- Keep tasks small (roughly one feature or module each), one branch and worktree per task.
- The first commit on `main` must exist before you create any worktree.
- **Ship merged work to the installed app (human rule, 2026-10-19).** The human uses the installed AXISNotes, which updates from the updates folder. After merging a user-visible change into `main`, first sweep for finished work from other sessions: branches with commits not in `main`, untracked `.agents/reviews/T-###.md` in the primary checkout, and linked sessions. Verify and merge the relevant ones, skip anything superseded and say which. Then publish the next patch version with `scripts/publish-update.ps1 -Version X.Y.Z -Notes "…"` and commit the version bump as `Release X.Y.Z: version bump`.
