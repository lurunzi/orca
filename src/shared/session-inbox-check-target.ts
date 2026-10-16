// The part of a check's suite one run covered. Adapted from petekp/inbox `hooks/checks.ts`
// (https://github.com/petekp/inbox @ a8ee58e, MIT, Copyright (c) 2026 Pete Petrash);
// license: resources/licenses/petekp-inbox/LICENSE.

import type { SessionInboxCheckTarget } from './session-inbox-check-types'
import { REDIRECT } from './session-inbox-shell-segments'
import { normalizeRuntimePathForComparison } from './cross-platform-path'

/** Flags that change how a run reports or how fast it goes, not what it runs. */
const OUTPUT_FLAGS = new Set([
  '--reporter',
  '--verbose',
  '-v',
  '--silent',
  '--quiet',
  '-q',
  '--color',
  '--no-color',
  '--ci',
  '--bail',
  '-x',
  '--coverage',
  '--pretty',
  '--noEmit',
  '--passWithNoTests',
  '--tb',
  '--maxWorkers',
  '-j',
  '--run',
  '--no-coverage',
  '--runInBand',
  '--watch',
  '--watchAll',
  '--no-watch',
  '--forceExit',
  '--detectOpenHandles',
  '--no-cache',
  '--format',
  '--timeout',
  '--testTimeout',
  '-s',
  '-vv'
])
/** The output flags that take their value as the next word. */
const VALUE_FLAGS = new Set([
  '--reporter',
  '--tb',
  '--maxWorkers',
  '-j',
  '--format',
  '--timeout',
  '--testTimeout'
])
/** Flags that pick tests by name or by path pattern. */
const FILTER_FLAGS = new Set([
  '-t',
  '--testNamePattern',
  '--grep',
  '-g',
  '-k',
  '--filter',
  '-run',
  '--testPathPattern'
])
/** A word a runner takes as its command, not as a target, as in `vitest run`. */
const COMMAND_WORDS: Record<string, string[]> = {
  vitest: ['run'],
  'golangci-lint': ['run'],
  ruff: ['check'],
  biome: ['check', 'lint', 'ci']
}
const isPath = (word: string) => word === '.' || /[\\/]/.test(word) || /\.[A-Za-z0-9]+$/.test(word)

/**
 * The part of a suite a run covered, read from the words after its runner and script. A file or
 * folder narrows it, as does a test-name filter. A flag that only changes output or speed does
 * not. Any other argument counts as a filter, so a run read wrongly never clears a failure.
 * `resolve` gives a path's absolute form, null when it cannot; `folder` is the run's folder.
 */
export function readTarget(
  words: string[],
  runner: string,
  folder: string | null,
  resolve: (word: string) => string | null
): SessionInboxCheckTarget {
  const paths: string[] = []
  const filters: string[] = []
  let project = 'tsconfig.json'
  const add = (list: string[], item: string) => {
    if (!list.includes(item)) {
      list.push(item)
    }
  }
  const rest = words[0] === '--' ? words.slice(1) : words
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i] ?? ''
    if (REDIRECT.test(word)) {
      break
    }
    const isFlag = word.startsWith('-')
    const [flag = '', inline] =
      isFlag && word.includes('=') ? word.split(/=(.*)/s) : [word, undefined]
    if (runner === 'tsc' && (flag === '-p' || flag === '--project')) {
      project = inline ?? rest[++i] ?? ''
    } else if (OUTPUT_FLAGS.has(flag)) {
      if (inline === undefined && VALUE_FLAGS.has(flag)) {
        i++
      }
    } else if (FILTER_FLAGS.has(flag)) {
      const value = inline ?? rest[++i]
      add(filters, value === undefined ? flag : `${flag}=${value}`)
    } else if (!COMMAND_WORDS[runner]?.includes(word)) {
      // Go's `./pkg/...` means the folder and everything below it.
      const path =
        !isFlag && isPath(word) && folder !== null
          ? resolve(word.replace(/\/\.\.\.$/, '') || '.')
          : null
      if (path === null) {
        add(filters, word)
      } else if (path !== folder) {
        add(paths, path)
      }
    }
  }
  if (runner === 'tsc') {
    const file = /\.json$/i.test(project) ? project : `${project}/tsconfig.json`
    add(filters, `project=${normalizeRuntimePathForComparison(resolve(file) ?? file)}`)
  }
  return { paths, filters }
}
