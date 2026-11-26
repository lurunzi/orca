# UDA Orca Fork

This repository is `lurunzi/orca`, a fork of `stablyai/orca` that lurunzi maintains as UDA Orca. This section applies to every AI agent working here. Where it differs from the sections below, or from a general instruction to ask before changing or merging into this fork, this section governs.

## Change Flow

Every change follows these steps, documentation included. Do all of them without asking for confirmation.

1. **Start**: branch from the current `origin/main` in your own worktree and record the task in `notes/<task>-<yyyymmdd>/status.md` of the primary checkout. Never commit on `main`, and leave other sessions' uncommitted changes alone.
2. **Local gate**: before each push run `pnpm check:changed`, plus `pnpm ci:local --focused <test paths>` for the tests your change touches. The full unit suite runs in CI, not locally.
3. **Pull request**: push the branch and open the PR with `gh pr create -R lurunzi/orca --base main`; without `-R`, `gh` targets upstream. Write the PR in English: what changed and why, the checks you ran, and what is not covered.
4. **CI gate**: wait with `gh pr checks <number> -R lurunzi/orca --watch`. The gate is the one in [Merging Pull Requests](#merging-pull-requests). Fix failures on the branch. A failure that `main` also has is fixed in its own PR first.
5. **Merge**: when the gate is green for the current head, merge it yourself with `gh pr merge <number> -R lurunzi/orca --squash --delete-branch --match-head-commit <sha>`.
6. **Finish**: confirm that `git ls-remote origin refs/heads/main` shows the merge, remove your worktree and local branch, close the task record, and report what merged, what you checked and what you did not.

Merging does not build, install or publish. The owner asks for a build (`更新sop`), and one build then carries everything merged since the last one.

## When to Stop

Choose technical options yourself and state the choice in one line. Stop and ask the owner only in these cases:

- **Upstream sync**: a PR that merges a `stablyai/orca` release into `main`. Prepare it with the list of overlaps and changes, get the gate green, and leave the merge to the owner. It lands as a merge commit, never squashed or rebased.
- **Leaving the fork**: a PR, issue, comment or push to `stablyai/orca`; a release, tag, signed build or deployment.
- **Loss**: the change would remove a fork feature or delete user data, and the request did not say so.
- **Blocked gate**: you cannot get the gate green, or only by weakening a check. Keep the branch and the PR, and report the evidence.

Never force-push, rewrite history, use `--no-verify` or `--admin`, or delete a test to pass a check.

# Checks

- **Gate**: `pnpm check:changed` runs format, lint, typecheck, the tests that import your changes, and the ratchets your paths select, and prints only failures. Run it once when you are done editing (and again after a rebase or fix), then push. A pass is cached, so don't rerun it "to be sure", and don't also run `pnpm tc`, `pnpm lint`, or the full suite. Never `--no-verify`.
- **While iterating**: run only what you touched: `pnpm test <file.test.ts> --maxWorkers=2`, `pnpm tc:node|tc:web|tc:cli`, `pnpm exec oxlint <files>`, `pnpm exec oxfmt --write <files>`. Transitive tests and the full suite are CI's job ([details](.github/CONTRIBUTING.md#targeting-local-tests)).
- Run checks in the foreground with `timeout 900`. Don't background them and poll with `sleep`.
- Stacked PRs: `ORCA_CODE_QUALITY_BASE=<ref>` or `--base=<ref>`; `--base=HEAD` covers only uncommitted edits.
- CI: `gh pr checks --watch` or `gh run watch <id> --compact --exit-status` (no polling). Read failures with `gh run view <id> --log-failed`; for long logs, filter with `grep -nE "error|FAIL|✗"` instead of tailing.
- **Local source checks**: `pnpm ci:local` runs lint, typecheck and unit tests using CI commands. `pnpm ci:local --focused [test paths]` scopes lint and tests; packaging, rendered Electron, mobile and other operating systems remain separate.
- **Real Claude CLI**: when changing Claude structured-session code, run `ORCA_REAL_CLAUDE_CLI_TEST=1 pnpm test src/main/claude/claude-structured-real-cli.test.ts src/main/claude/claude-structured-real-cli-fold.test.ts`.

# Repo Rules

- Ensure main is always releasable
- Never break the CI. If it's broken, merge fixes.
- **Tests are the exception.** Prove a change by running it (app via CDP screenshot, CLI, script), not by committing a test. Commit one only for logic where a silent regression is costly: parsers/codecs/round-trips, security boundaries (escaping, path traversal, auth, crypto), persistence/migrations/data loss, concurrency or state-machine invariants, cross-platform paths. It must call real code with minimal mocks, hardcode its expectations, and fail if the fix is reverted; prefer one invariant over many examples. Never test UI behavior ("button does X"), wiring/IPC glue, mock calls, copy, constants, or timing. Critical user flows belong in the golden E2E journeys (`tests/e2e/golden-journeys`), not unit tests. Delete low-value tests you touch instead of updating them. Perf contracts: `*.performance.test.*` only ([rules](./docs/agents-md-refs/test-antipatterns.md#perf-contracts)); more in [anti-patterns](./docs/agents-md-refs/test-antipatterns.md).

# Design System

All UI work — layout, color, typography, spacing, component selection, UX behavior — must follow [`docs/STYLEGUIDE.md`](./docs/STYLEGUIDE.md). Use the tokens defined in `src/renderer/src/assets/main.css` (the canonical source) and the shadcn primitives in `src/renderer/src/components/ui/`. Don't invent new color values, font sizes, or shadow tiers when a documented one already covers the role.

# Electron UI Validation

- Always run tests and agent-launched apps in the background with `ORCA_BACKGROUND_LAUNCH=1`.
- Never steal monitor focus or reveal test windows: no `show()`, `showInactive()`, `bringToFront()`, `app.focus()`, or OS activation. Use CDP screenshots of hidden renderers.
- Keep native-focus and visible-window tests paused on the user's desktop; run them on an isolated display or CI.
- Rebuild modified launch-policy code before running an app (stale build wrappers are not safe).
- Use the `$electron` skill and Playwright CDP for rendered Orca UI checks. Do not use computer-use for Orca UI validation.
- Rendered UI E2E checks need an explicit, reproducible viewport and state.
- Screenshot presentational components without Electron: `pnpm fixtures:shot <id>` ([fixtures](docs/agents-md-refs/component-fixtures.md)).

# Code Style

## Reuse Before Reimplementing

Before writing new logic at any scale extend or generalize it instead of building a parallel version.

## Avoid Comments

- Only use when code does not describe
- BE CONCISE. 1 LINE if possible (why not how)

## File and Module Naming

Never use vague names like `helpers`, `utils`, `common`, `misc`, or `shared-stuff` for files, folders, or modules. They carry zero info and tend to become dumping grounds. Name files after what they _actually_ contain — prefer the concrete domain concept (e.g. `tab-group-state.ts`, `terminal-orphan-cleanup.ts`) over the generic role (`tabs-helpers.ts`, `terminal-utils.ts`). If you find yourself reaching for `helpers`, the file probably has more than one responsibility and should be split, or there's a better name hiding in the code that describes what the functions operate on.

# First Class Citizens

Every change must consider these areas:

1. Cross-Platform Support (mac/linux/windows)
   - Guard platform-specific behavior at runtime; use platform-aware shortcuts, paths, and existing process wrappers. Before changing platform-specific code, processes, shells, shortcuts, paths, or native modules, read [`docs/agents-md-refs/cross-platform-support.md`](./docs/agents-md-refs/cross-platform-support.md).
2. Remote hosts
   - Features should work locally and on remote hosts
3. Mobile
4. Folder Workspaces
   - Don't assume every workspace is a git worktree.

# Footguns

## Git / GitHub

### Merging Pull Requests

Before merging, verify that the required checks and aggregate gate in the full PR workflow have passed for the exact current PR commit. For GitHub, identify the `.github/workflows/pr.yml` run and its aggregate `PR checks passed` (job ID `verify`); Mobile Checks is separate and never substitutes for it. Check workflow identity as well as the displayed job name. If the head changes, repeat the check for the new head.

Pending, failed, cancelled, or missing required checks block agent merges even when repository settings allow them. `gh pr merge --auto` is not proof that CI passed: GitHub may merge immediately when checks are optional. Never use `--admin` or disable protection to bypass a failed check. An explicit user instruction to make an emergency exception overrides this default; otherwise fix the failure or wait. Use `--match-head-commit` to prevent merging a different commit after validation.

CI changes must exercise the affected checks in the PR. Required check names must be unique across workflows, and workflow changes must preserve the full aggregate's failure handling and conditional job requirements.

If changing code around `git`, `gh`, source-control, or review behavior read [`docs/agents-md-refs/git-workflow.md`](./docs/agents-md-refs/git-workflow.md).

## Worktree Safety

Always use the current worktree for reads and edits. Never follow subagent paths into another checkout when reviewing integrated changes.

## Max Lines

Never disable max-lines or add a per-file max-lines increase in mobile/.oxlintrc.json.
