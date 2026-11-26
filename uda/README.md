# uda/

UDA Orca build-time tooling. Upstream (`stablyai/orca`) never touches this directory, so nothing here conflicts when an upstream release is merged. The only hook in upstream files is the `uda` script in `package.json`.

## Commands

| Command                                                                                                                   | What it does                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm uda ci`                                                                                                             | Runs every CI step below in order and prints passed / failed / not covered. The exit code reflects only steps that ran.                                             |
| `pnpm uda ci --step <name>`                                                                                               | Runs one step.                                                                                                                                                      |
| `pnpm uda ci --list`                                                                                                      | Prints the step names.                                                                                                                                              |
| `pnpm uda ci --dry-run [--step <name>]`                                                                                   | Prints each step's command without running it.                                                                                                                      |
| `pnpm uda seam-check [--update]`                                                                                          | Reports upstream files changed since `UPSTREAM_BASE` outside the UDA overlay, compared with `seams.json`; `--update` rewrites the record. Report only.              |
| `pnpm uda version <N>`                                                                                                    | Prints the UDA app version `X.Y.(Z*100+N)` for UDA revision `N` (1-99) on top of the upstream version in `package.json`.                                            |
| `pnpm uda release-publish --version <ver> --dir <path> [--platform win\|mac] [--dry-run] [--mirror-only] [--skip-mirror]` | Verifies the feed in `--dir`, uploads it to uda-vm, publishes it, checks the public feed, mirrors it to GitHub and sends a notification. See [Releases](#releases). |
| `pnpm uda release-rollback --to <ver> [--dry-run]`                                                                        | Points `channels/stable` on uda-vm at an already published version, checks the public stable feed and sets the previously stable mirror release back to draft.      |
| `pnpm uda release-status`                                                                                                 | Prints the server's `meta/index.json` (read-only).                                                                                                                  |

Reserved, not available yet: `merge`, `sync`, `release-build`, `release-audit`, `disable-upstream-workflows`.

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

## Releases

The installer feed lives on uda-vm and is served at `https://orca-releases.ultramarinedigitalart.com`. The server only accepts `status`, `put <ver>`, `publish <ver>` and `rollback <ver>` through a forced-command SSH key; it verifies every file against `latest.yml` / `latest-mac.yml` before anything becomes public.

`release-publish` runs these steps:

1. **Local verification** (no network): picks `latest.yml` (`--platform win`) or `latest-mac.yml` (`--platform mac`); without `--platform` the one present is used, and both present is an error. The feed `version` must equal `--version`, and every referenced file must exist with the same size and sha512. Only the feed, its referenced files, their `.blockmap` and `SHA256SUMS` are uploaded; everything else is listed as left out. Names must match the server's rule and fit in 100 bytes.
2. **Upload**: a ustar archive of exactly those files, written by `scripts/release-tar.mjs`, is streamed to `ssh ... "put <ver>"`, then `ssh ... "publish <ver>"` runs. If the version is already published (the other platform's round), a `SHA256SUMS` already there is not sent again and any other existing file name is an error, because published files are never replaced.
3. **Public check**: `/releases/v<ver>/<feed>` and, when the version is now stable, `/channels/stable/<feed>` must match the local feed byte for byte.
4. **Mirror**: `Ultramarine-Digital-Art/uda-orca-releases`, tag `v<ver>`: creates a draft if missing, uploads files not already present, checks sizes, publishes the release. A mirror failure never touches the primary feed; rerun with `--mirror-only`.
5. **Notify**: one line to ntfy.

`--dry-run` stops after step 1 and prints the ssh commands. `--mirror-only` skips steps 2, 3 and 5; `--skip-mirror` skips step 4.

SSH uses the system `ssh` (`%SystemRoot%\System32\OpenSSH\ssh.exe` on Windows) with `-F none`, `BatchMode=yes`, `IdentitiesOnly=yes`, `StrictHostKeyChecking=yes` and a temporary known_hosts file that holds only uda-vm's pinned ED25519 host key (`SHA256:L/jIOpVyfhUGxdM+YmdsonUjBuQjCC3zvwVJ/kPbe/A`).

### Environment

| Variable               | Meaning                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `UDA_RELEASE_SSH_KEY`  | Path to the `orca-release-bot` private key. Required unless `--dry-run` or `--mirror-only`. |
| `UDA_RELEASE_SSH_HOST` | SSH target, default `orca-release-bot@192.168.178.21`.                                      |
| `UDA_NTFY_URL`         | ntfy topic URL for notifications.                                                           |
| `UDA_NTFY_TOKEN`       | ntfy access token, sent as `Authorization: Bearer`. Never printed.                          |

The mirror uses the `gh` login of whoever runs the command.

### Not covered

These print a "not covered" line and do not fail the run:

- `mirror: not covered — repository does not exist yet` when `Ultramarine-Digital-Art/uda-orca-releases` does not exist.
- `mirror: not covered — no mirror release v<ver>` when a rollback finds no mirror release to set back to draft.
- `notify: not covered — UDA_NTFY_URL / UDA_NTFY_TOKEN not set`.

## Files

- `UPSTREAM_BASE` - the upstream release tag that `main` currently contains.
- `seams.json` - the recorded seam list (`pnpm uda seam-check --update`).
- `secrets-denylist.txt` - one case-insensitive regular expression per line.
