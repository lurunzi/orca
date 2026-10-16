// How a check ended and what failed, read from its output. Adapted from petekp/inbox `hooks/checks.ts`
// (https://github.com/petekp/inbox @ a8ee58e, MIT, Copyright (c) 2026 Pete Petrash);
// license: resources/licenses/petekp-inbox/LICENSE.

import { stripAnsiEscapeSequences } from './ansi-escape-sequences'
import type { SessionInboxCheckOutcome } from './session-inbox-check-types'
import { stripBoundedTextMarker } from './structured-agent-session-projection'

/** The output as the check printed it: without the engine's `Exit code N` line, Orca's truncation marker and colors. */
function printed(output: string): { text: string; isTruncated: boolean } {
  const { text, truncated } = stripBoundedTextMarker(output.replace(/\r\n?/g, '\n'))
  return {
    text: stripAnsiEscapeSequences(text).replace(/^Exit code -?\d+[^\S\n]*(?:\n|$)/, ''),
    isTruncated: truncated
  }
}

const SUMMARY = [
  /^.*\b\d+\s+(?:pass(?:ed|ing)?|fail(?:ed|ing)?)\b.*$/im,
  /^.*\bRan \d+ tests?\b.*$/im,
  /^.*\bTests?:\s+.*$/im,
  /^.*\bFound \d+ (?:errors?|problems?)\b.*$/im,
  /^.*\b\d+ (?:errors?|warnings?|problems?)\b.*$/im
]

/**
 * Run summaries that count failures, each with what a line counting none must also say for the
 * run to have passed; null when such a line never shows a whole run passed.
 */
const TALLIES: { line: RegExp; clean: RegExp | null }[] = [
  // vitest's "Tests  2 failed | 10 passed (12)" and "Errors  1 error"; jest's "Tests: 1 failed, 3 passed".
  { line: /^\s*(?:Test Files|Tests|Test Suites|Errors):?\s+\d+ \w/, clean: /\b[1-9]\d* passed\b/ },
  // vitest's per-file "❯ a.test.ts (3 tests | 1 failed)".
  { line: /\(\d+ tests?(?: \| \d+ \w+)+\)/, clean: null },
  // pytest's "=== 1 failed, 3 passed in 0.12s ===".
  {
    line: /^=*\s*\d+ (?:failed|passed|errors?)\b.*\bin \d+(?:\.\d+)?s\b/,
    clean: /\b[1-9]\d* passed\b/
  },
  // tsc's "Found 3 errors in 2 files."
  { line: /^Found \d+ errors?\b/, clean: /^Found 0 errors\b/ },
  // oxlint's "Found 2 warnings and 1 error."; warnings fail a run that denies them.
  { line: /^Found \d+ warnings? and \d+ errors?\b/, clean: /^Found 0 warnings\b/ },
  // eslint's "✖ 3 problems (3 errors, 0 warnings)"; it prints nothing for a clean run.
  { line: /^\s*✖ \d+ problems? \(\d+ errors?, \d+ warnings?\)/, clean: null }
]
const FAILED_COUNT = /\b(\d+) (?:failed|errors?)\b/g

/**
 * A compiler or linter error that names its file, which tsc and oxlint print without a summary
 * when their output is piped: `a.ts(1,7): error TS2322:`, `a.ts:1:7 - error TS2322:`,
 * `a.ts:1:7: error eslint(no-debugger):`.
 */
const DIAGNOSTIC =
  /^\S.*(?:\(\d+,\d+\): error TS\d+:|:\d+:\d+ - error TS\d+:|:\d+:\d+: error [\w-]+\([\w/@-]+\):)/

type Tally = { failed: number; isClean: boolean; line: string | null }

/** The failures the output's run summaries and error diagnostics count, whether a summary says the run passed, and the last summary. */
function tally(text: string): Tally {
  const found: Tally = { failed: 0, isClean: false, line: null }
  for (const line of text.split('\n')) {
    const shape = TALLIES.find((t) => t.line.test(line))
    if (shape) {
      const failed = [...line.matchAll(FAILED_COUNT)].reduce((sum, m) => sum + Number(m[1]), 0)
      found.failed += failed
      found.isClean ||= failed === 0 && shape.clean !== null && shape.clean.test(line)
      found.line = line.trim().slice(0, 120)
    } else if (DIAGNOSTIC.test(line)) {
      found.failed++
    }
  }
  return found
}

/** Pass and fail counts on lines of their own: bun's " 24 pass", node's "ℹ pass 24", TAP's "# pass 24". */
function counts(text: string): { pass: number; fail: number } | null {
  const count = (word: string) => {
    const m = text.match(
      new RegExp(String.raw`^\s*(\d+)\s+${word}\s*$|^[ℹ#]\s*${word}\s+(\d+)\s*$`, 'm')
    )
    return m ? Number(m[1] ?? m[2]) : null
  }
  const pass = count('pass')
  const fail = count('fail')
  return pass === null || fail === null ? null : { pass, fail }
}

function summaryLine(text: string): string {
  for (const pattern of SUMMARY) {
    const m = text.match(pattern)
    if (m) {
      return m[0].trim().slice(0, 120)
    }
  }
  const firstError = text.split('\n').find((line) => /\berror\b/i.test(line))
  return (firstError ?? '').trim().slice(0, 120)
}

/**
 * How a check ended, with the summary line and failure lines its output gives. When its exit
 * status is the command's, that status decides. Otherwise the output decides: a failure a summary
 * counts, or a summary that says the run passed; null when it says neither, or when Orca cut it
 * short, so a failure past the cut could hide.
 */
export function readCheckOutcome(
  output: string,
  isError: boolean,
  exitIsCheck: boolean,
  outputTruncated = false
): SessionInboxCheckOutcome | null {
  const { text, isTruncated } = printed(output)
  const counted = counts(text)
  const tallied = tally(text)
  const failed = tallied.failed + (counted?.fail ?? 0) > 0
  const isClean = !outputTruncated && !isTruncated && (tallied.isClean || counted?.fail === 0)
  const fromOutput = failed ? 'fail' : isClean ? 'pass' : null
  const result = exitIsCheck ? (isError ? 'fail' : 'pass') : fromOutput
  if (result === null) {
    return null
  }
  // failCount reads this back for the pane's "2 of 176 failed".
  const summary = counted
    ? `${counted.pass} pass, ${counted.fail} fail`
    : (tallied.line ?? summaryLine(text))
  return {
    result,
    summary: summary || (result === 'fail' ? 'exited with an error' : ''),
    failures: result === 'fail' ? failureLinesIn(text) : []
  }
}

/** The marks a test runner puts before a failing test. node's "✖ failing tests:" heading names none. */
const FAIL_MARK = String.raw`\(fail\)|FAIL(?:ED)?\b|✗|✖(?! failing tests:)|×|✘`

/** A line that names what failed: a failing test, a compiler or linter error, or an error message. */
const FAILURE_LINE = new RegExp(
  String.raw`^\s*(?:${FAIL_MARK})|\berror\s+TS\d+\b|:\d+:\d+: error [\w-]+\(|^\s*(?:[A-Z]\w*Error|error)(?:\[\w+\])?:`
)

function failureLinesIn(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => FAILURE_LINE.test(line))
    .map((line) => line.trim().slice(0, 160))
    .filter((line, i, all) => all.indexOf(line) === i)
    .slice(0, 3)
}

/** Up to three lines of a check's output that name what failed, each cut to 160 characters. */
export function failureLines(output: string): string[] {
  return failureLinesIn(printed(output).text)
}

/** The output's summary line, unless it repeats a failure line, as tsc's first error does. */
export function distinctSummary(summary: string, failures: string[]): string | null {
  const isRepeated = failures.some((f) => f.includes(summary) || summary.includes(f))
  return summary && !isRepeated ? summary : null
}

/** What a failed check's output says: the lines that name the failure, then the summary unless it repeats one. */
export function outputLines(summary: string, failures: string[]): string[] {
  const distinct = distinctSummary(summary, failures)
  return [...failures, ...(distinct ? [distinct] : [])]
}

/** A path with an extension, then the line it names, if any: `src/a.ts(12,5)`, `C:\src\a.swift:30:27`, `src/a.test.ts`. */
const LOCATION =
  /((?:[A-Za-z]:[\\/])?(?:[\w@.~-]*[\\/])*[\w@~-][\w@.~-]*\.[A-Za-z]\w{0,5})(?:\((\d+),\d+\)|:(\d+)(?::\d+)?)?(?![\w/\\])/g

/** A failure mark, or vitest's ❯, at the start of a failure line. */
const LEADING_MARK = new RegExp(String.raw`^\s*(?:${FAIL_MARK}|❯)\s*`)

/**
 * What failure lines say, one entry per failure: the file a line names, as its base name and
 * line, and its text without marker, location and timing. A line whose text ends with an earlier
 * one's, as vitest's FAIL line repeats its × line, only adds its file to that entry.
 */
export function failureList(failures: string[]): { file: string | null; text: string }[] {
  const list: { file: string | null; text: string }[] = []
  for (const failure of failures) {
    // A token counts as a file when it names a line or a folder, so a word like "foo.bar" does not.
    const found = [...failure.matchAll(LOCATION)].find(
      (m) => m[2] ?? m[3] ?? /[\\/]/.test(m[1] ?? '')
    )
    const line = found?.[2] ?? found?.[3]
    const file = found?.[1] ? `${found[1].replace(/^.*[\\/]/, '')}${line ? `:${line}` : ''}` : null
    const text = failure
      .replace(found?.[0] ?? '', '')
      .replace(LEADING_MARK, '')
      .replace(/^\|[\w-]+\|\s*/, '')
      .replace(/^[\s:>-]*(?:error(?:\s+TS\d+|\[\w+\]|\s+[\w-]+\([\w/@-]+\))?:\s*)?/i, '')
      .replace(/\s*[[(]?\d+(?:\.\d+)?\s?m?s[\])]?$/, '')
      .trim()
    const earlier = list.find((f) => text.endsWith(f.text))
    if (earlier) {
      earlier.file ??= file
    } else if (text) {
      list.push({ file, text })
    }
  }
  return list
}

/** How many tests failed, read from an "N pass, M fail" summary; null when the output gave no counts. */
export function failCount(summary: string): { fail: number; total: number } | null {
  const m = summary.match(/^(\d+) pass, (\d+) fail$/)
  return m ? { fail: Number(m[2]), total: Number(m[1]) + Number(m[2]) } : null
}
