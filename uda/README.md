# uda/

UDA Orca build-time tooling. Upstream (`stablyai/orca`) never touches this directory, so nothing here conflicts when an upstream release is merged. The only hook in upstream files is the `uda` script in `package.json`.

## Commands

| Command                                 | What it does                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm uda ci`                           | Runs every CI step below in order and prints passed / failed / not covered. The exit code reflects only steps that ran.                                |
| `pnpm uda ci --step <name>`             | Runs one step.                                                                                                                                         |
| `pnpm uda ci --list`                    | Prints the step names.                                                                                                                                 |
| `pnpm uda ci --dry-run [--step <name>]` | Prints each step's command without running it.                                                                                                         |
| `pnpm uda seam-check [--update]`        | Reports upstream files changed since `UPSTREAM_BASE` outside the UDA overlay, compared with `seams.json`; `--update` rewrites the record. Report only. |
| `pnpm uda version <N>`                  | Prints the UDA app version `X.Y.(Z*100+N)` for UDA revision `N` (1-99) on top of the upstream version in `package.json`.                               |

Reserved, not available yet: `merge`, `sync`, `release-build`, `release-audit`, `release-publish`, `release-rollback`, `disable-upstream-workflows`.

## CI steps

Defined once in `scripts/ci-steps.mjs`; the names are the contract a workflow calls.

1. `seam-check` - the seam report; never fails the run.
2. `changed` - `pnpm check:changed` against `origin/main` (or `ORCA_CODE_QUALITY_BASE`).
3. `source` - `pnpm ci:local`.
4. `identity` - `src/shared/product-identity.test.ts`.
5. `secrets` - pinned, checksum-verified gitleaks over `origin/main..HEAD`, downloaded to `.local/tools/`. With `UDA_SECRETS_DENYLIST=1` the diff and commit messages are also checked against `secrets-denylist.txt` (for branches headed upstream).
6. `package-smoke` - Windows only, not implemented yet; always "not covered".
7. `update-e2e` - Windows only, not implemented yet; always "not covered".

Requires Node 24; pnpm comes from `packageManager` via corepack.

## Files

- `UPSTREAM_BASE` - the upstream release tag that `main` currently contains.
- `seams.json` - the recorded seam list (`pnpm uda seam-check --update`).
- `secrets-denylist.txt` - one case-insensitive regular expression per line.
