// Which checks a shell command runs, where, and on what. Adapted from petekp/inbox `hooks/checks.ts`
// (https://github.com/petekp/inbox @ a8ee58e, MIT, Copyright (c) 2026 Pete Petrash);
// license: resources/licenses/petekp-inbox/LICENSE.

import {
  folderBefore,
  homeExpander,
  namedFolder,
  resolveFrom,
  resolvePath
} from './session-inbox-check-folder'
import { readTarget } from './session-inbox-check-target'
import type {
  SessionInboxCheckCall,
  SessionInboxCheckKind,
  SessionInboxCheckRun,
  SessionInboxCheckTarget
} from './session-inbox-check-types'
import {
  commandOf,
  shellSegments,
  wordsOf,
  type ShellSegment
} from './session-inbox-shell-segments'

export { isTemporary, resolvePath } from './session-inbox-check-folder'

/** A package manager's options before its script, such as `--prefix app` or `-w pkg`. */
const PM_OPTIONS = String.raw`(?:-{1,2}[\w-]+(?:=\S+|\s+(?!-|(?:run|test|build|lint)\b)\S+)?\s+)*`
/** A script such as `test`; group 2 is its `:unit` or `-e2e` part, so `lint` and `lint:css` are different checks. */
const pm = (managers: string, script: string) =>
  new RegExp(String.raw`\b(${managers})\s+${PM_OPTIONS}(?:run\s+)?(?:${script})([:-][\w.:-]*\w)?\b`)
/** A runner as a command word, as in `npx vitest` or `node node_modules/vitest/vitest.mjs`, not as part of `vitest.config.ts`. */
const runner = (names: string) =>
  new RegExp(
    String.raw`(?<![^\s/\\(])(${names})(?=$|[\s<>&)]|\.(?:mjs|cjs|js|cmd|exe|ps1)(?:$|[\s<>&)]))`
  )

const CHECKS: {
  kind: SessionInboxCheckKind
  pattern: RegExp
  name: (m: RegExpMatchArray) => string
}[] = [
  { kind: 'tests', pattern: /\bclaude\s+plugin\s+test\b/, name: () => 'plugin tests' },
  { kind: 'validate', pattern: /\bclaude\s+plugin\s+validate\b/, name: () => 'plugin validate' },
  {
    kind: 'tests',
    pattern: pm('bun|npm|pnpm|yarn|deno', 'test'),
    name: (m) => `${m[1]} test${m[2] ?? ''}`
  },
  {
    kind: 'tests',
    pattern: /\bnode\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*--test\b/,
    name: () => 'node --test'
  },
  {
    kind: 'tests',
    pattern: runner('vitest|jest|pytest|rspec|mocha|phpunit|ava|tap'),
    name: (m) => m[1] ?? 'tests'
  },
  { kind: 'tests', pattern: /\b(go|cargo|swift|mix|dotnet)\s+test\b/, name: (m) => `${m[1]} test` },
  { kind: 'tests', pattern: /\bplaywright\s+test\b/, name: () => 'playwright' },
  { kind: 'tests', pattern: /\bxcodebuild\b[^|;&]*\btest\b/, name: () => 'xcodebuild test' },
  { kind: 'tests', pattern: /\bmake\s+(?:check|test)\b/, name: (m) => m[0] },
  { kind: 'types', pattern: runner('tsc'), name: () => 'tsc' },
  { kind: 'types', pattern: runner('mypy|pyright'), name: (m) => m[1] ?? 'types' },
  {
    kind: 'types',
    pattern: pm('bun|npm|pnpm|yarn', 'typecheck|type-check|check-types|tc'),
    name: (m) => `typecheck${m[2] ?? ''}`
  },
  { kind: 'types', pattern: /\bcargo\s+check\b/, name: () => 'cargo check' },
  {
    kind: 'lint',
    pattern: runner('eslint|biome|ruff|shellcheck|swiftlint|clippy|golangci-lint|stylelint|oxlint'),
    name: (m) => m[1] ?? 'lint'
  },
  { kind: 'lint', pattern: pm('bun|npm|pnpm|yarn', 'lint'), name: (m) => `lint${m[2] ?? ''}` },
  { kind: 'lint', pattern: /\bprettier\b[^|;&]*--check\b/, name: () => 'prettier' },
  {
    kind: 'build',
    pattern: pm('bun|npm|pnpm|yarn', 'build'),
    name: (m) => `${m[1]} build${m[2] ?? ''}`
  },
  { kind: 'build', pattern: /\b(cargo|go|swift)\s+build\b/, name: (m) => `${m[1]} build` },
  { kind: 'build', pattern: /\bxcodebuild\b(?![^|;&]*\btest\b)/, name: () => 'xcodebuild' },
  { kind: 'build', pattern: /\b(?:next|vite)\s+build\b/, name: (m) => m[0] },
  {
    kind: 'validate',
    pattern: /(?:^|\s)(?:\S*\/)?[\w.-]*(?:validate|doctor)[\w.-]*\.sh\b/,
    name: (m) => m[0].trim().replace(/^.*\//, '')
  },
  {
    kind: 'all',
    pattern: /(?:^|\s)(?:\S*\/)?checks?\.sh\b/,
    name: (m) => m[0].trim().replace(/^.*\//, '')
  }
]

/**
 * Commands that only show text, move files around, look for a process or install packages; a
 * check named in one of them is not run, as in `pgrep -x xcodebuild` or `pnpm add -D vitest`.
 */
const NOT_A_CHECK =
  /^(?:echo|printf|cat|grep|rg|tail|head|less|ls|cd|pushd|popd|git|gh|brew|man|which|where|type|open|pgrep|pkill|killall|ps|lsof|sed|awk|wc|find|diff|stat|touch|mkdir|rm|cp|mv|code)\b|^(?:bun|npm|pnpm|yarn)\s+(?:add|install|i|remove|rm|uninstall|update|up|upgrade|view|info|why|outdated|list|ls)\b/

/** A check one segment runs, the word that starts it, such as `npm` or `tsc`, and how many words after it the match used, such as `run lint` after `npm`. */
type FoundCheck = { call: SessionInboxCheckCall; runner: string; consumed: number }

function checkIn(segment: string): FoundCheck | null {
  const command = commandOf(segment)
  if (NOT_A_CHECK.test(command)) {
    return null
  }
  for (const check of CHECKS) {
    const m = command.match(check.pattern)
    if (m) {
      const [word = '', ...used] = m[0].trim().split(/\s+/)
      return {
        call: { name: check.name(m), kind: check.kind },
        runner: word,
        consumed: used.length
      }
    }
  }
  return null
}

/** The checks a command runs, in order, at most one per segment. */
export function checksIn(command: string): SessionInboxCheckCall[] {
  const found: SessionInboxCheckCall[] = []
  for (const segment of shellSegments(command)) {
    const call = checkIn(segment.text)?.call
    if (call && !found.some((f) => f.name === call.name)) {
      found.push(call)
    }
  }
  return found
}

/** The target of a run of the whole suite. */
export const NO_CHECK_TARGET: SessionInboxCheckTarget = { paths: [], filters: [] }

/** A word's command name: `vitest` for `node_modules/.bin/vitest.cmd` or `node_modules/vitest/vitest.mjs`. */
const commandName = (word: string) =>
  word.replace(/^.*[\\/]/, '').replace(/\.(?:mjs|cjs|js|cmd|exe|ps1)$/, '')

/**
 * Whether the command's exit status is the check's: it is the only check, nothing negates it or
 * runs it only after something else failed, nothing runs in the background, and only `&&` follows.
 */
function isExitTheCheck(
  segments: ShellSegment[],
  found: (FoundCheck | null)[],
  at: number
): boolean {
  // `!` and a `||` before the check apply to its whole pipeline.
  let start = at
  while (start > 0 && segments[start - 1]?.next === '|') {
    start--
  }
  const first = segments[start]?.text ?? ''
  const prefix = first.slice(0, first.length - commandOf(first).length)
  return (
    found.filter((f) => f !== null).length === 1 &&
    segments[start - 1]?.next !== '||' &&
    !/(?:^|[\s({])!\s/.test(prefix) &&
    segments.slice(at).every((s) => s.next === '&&' || s.next === '') &&
    !segments.some((s) => /(?:^|[^<>&])&(?!>)/.test(s.text))
  )
}

/**
 * The first check a command runs, with its folder, absolute: where the shell started, moved by
 * any `cd` before the check, or the folder the check names, as in `claude plugin test <folder>`
 * or `npm --prefix <folder> test`. The folder is null when the command hides it, as with a
 * variable other than HOME or `$(...)`.
 */
export function checkRun(command: string, cwd: string, home: string): SessionInboxCheckRun | null {
  const segments = shellSegments(command)
  const found = segments.map((s) => checkIn(s.text))
  const at = found.findIndex((f) => f !== null)
  const check = found[at]
  const segment = segments[at]
  if (!check || !segment) {
    return null
  }
  const expand = homeExpander(home)
  const dir = folderBefore(segments, at, resolvePath('/', cwd), expand)
  const words = wordsOf(commandOf(segment.written))
  // A runner word not found keeps every word as a target word, which can only narrow the target.
  const after = words.slice(
    words.findIndex((w) => w === check.runner || commandName(w) === check.runner) + 1
  )
  const { named, folderWords } = namedFolder(after, check.runner)
  const folder = named === undefined ? dir : resolveFrom(dir, expand(named))
  const target = readTarget(
    after.filter((_, j) => j >= check.consumed && !folderWords.has(j)),
    check.runner,
    folder,
    (word) => resolveFrom(folder, expand(word))
  )
  return {
    call: check.call,
    target,
    command: segment.written,
    folder,
    hasMultipleChecks: found.filter((entry) => entry !== null).length > 1,
    exitIsCheck: isExitTheCheck(segments, found, at)
  }
}
