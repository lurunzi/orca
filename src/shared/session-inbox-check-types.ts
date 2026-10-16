// Check vocabulary for the session inbox. Adapted from petekp/inbox `types/index.d.ts`
// (https://github.com/petekp/inbox @ a8ee58e, MIT, Copyright (c) 2026 Pete Petrash);
// license: resources/licenses/petekp-inbox/LICENSE.

/** `all`: a script that runs the project's checks together, such as `check.sh`. */
export type SessionInboxCheckKind = 'tests' | 'types' | 'lint' | 'build' | 'validate' | 'all'

/** The part of a check's suite one run covered. Both lists empty means the whole suite. */
export type SessionInboxCheckTarget = {
  /** Files and folders the run named, absolute, `/`-separated. */
  paths: string[]
  /** Test-name filters and any argument that could not be read, such as `-t=parses dates`. */
  filters: string[]
}

/** One recognized check inside a command, such as `pnpm test` or `tsc`. */
export type SessionInboxCheckCall = { name: string; kind: SessionInboxCheckKind }

/** The first check a shell command runs. */
export type SessionInboxCheckRun = {
  call: SessionInboxCheckCall
  target: SessionInboxCheckTarget
  /** The piece of the command that ran it, as written, such as `pnpm test > t.log`. */
  command: string
  /** The folder it ran in, absolute and `/`-separated; null when the command hides it. */
  folder: string | null
  /** Combined output cannot identify which of multiple check commands produced a summary. */
  hasMultipleChecks: boolean
  /** The command's exit status is this check's: it is the only check, and only `&&` follows it. */
  exitIsCheck: boolean
}

/** How one run of a check ended, read from its exit status or, failing that, its output. */
export type SessionInboxCheckOutcome = {
  result: 'pass' | 'fail'
  /** The output's summary line, such as "24 pass, 1 fail"; '' when it gave none. */
  summary: string
  /** Up to three output lines that name what failed. */
  failures: string[]
}
