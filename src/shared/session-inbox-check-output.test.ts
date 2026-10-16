import { describe, expect, it } from 'vitest'
import {
  distinctSummary,
  failCount,
  failureLines,
  failureList,
  outputLines,
  readCheckOutcome
} from './session-inbox-check-output'

const MARKER = '\n[Orca: output truncated — 123456 bytes total, digest 0123456789ab]'

const VITEST_FAIL = [
  ' ❯ src/b.test.ts (3 tests | 1 failed) 15ms',
  '   × b > fails 3ms',
  '     → expected 1 to be 2',
  ' ✓ src/a.test.ts (5 tests) 12ms',
  '',
  '⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯',
  '',
  ' FAIL  src/b.test.ts > b > fails',
  'AssertionError: expected 1 to be 2',
  '',
  ' Test Files  1 failed | 1 passed (2)',
  '      Tests  1 failed | 7 passed (8)',
  '   Start at  10:00:00',
  '   Duration  1.20s'
].join('\n')

const VITEST_PASS = [
  ' ✓ src/a.test.ts (12 tests) 15ms',
  '',
  ' Test Files  1 passed (1)',
  '      Tests  12 passed (12)',
  '   Duration  1.20s'
].join('\n')

const JEST_FAIL = [
  'FAIL src/a.test.js',
  '  ● adds › fails',
  'Test Suites: 1 failed, 1 total',
  'Tests:       1 failed, 3 passed, 4 total',
  'Time:        0.5 s'
].join('\n')

const TSC_ERROR = "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'."

// oxlint's compact format, which it prints when its output is not a terminal.
const OXLINT_ERROR =
  'C:/repo/src/a.ts:1:1: error eslint(no-debugger): `debugger` statement is not allowed help: Remove the debugger statement'

describe('readCheckOutcome when the exit status is the check’s', () => {
  it('takes the result from the exit status, and the summary from the runner’s counts', () => {
    expect(readCheckOutcome(' 24 pass\n 1 fail\nRan 25 tests across 3 files.', true, true)).toEqual(
      { result: 'fail', summary: '24 pass, 1 fail', failures: [] }
    )
    // A test named after errors does not fail a clean run.
    expect(readCheckOutcome('(pass) reports 2 errors\n 25 pass\n 0 fail\n', false, true)).toEqual({
      result: 'pass',
      summary: '25 pass, 0 fail',
      failures: []
    })
  })

  it('says a failing check with no recognizable summary exited with an error', () => {
    expect(readCheckOutcome('Exit code 2\nboom', true, true)).toEqual({
      result: 'fail',
      summary: 'exited with an error',
      failures: []
    })
    expect(readCheckOutcome('Exit code 1', true, true)?.summary).toBe('exited with an error')
    expect(readCheckOutcome(`Exit code 1${MARKER}`, true, true)?.summary).toBe(
      'exited with an error'
    )
  })

  it('reads the run summary and the failure lines of a failing run', () => {
    expect(readCheckOutcome(`Exit code 1\n${VITEST_FAIL}`, true, true)).toEqual({
      result: 'fail',
      summary: 'Tests  1 failed | 7 passed (8)',
      failures: [
        '× b > fails 3ms',
        'FAIL  src/b.test.ts > b > fails',
        'AssertionError: expected 1 to be 2'
      ]
    })
    expect(readCheckOutcome(`Exit code 1\n${JEST_FAIL}`, true, true)?.summary).toBe(
      'Tests:       1 failed, 3 passed, 4 total'
    )
    expect(readCheckOutcome(`Exit code 2\n${TSC_ERROR}`, true, true)).toEqual({
      result: 'fail',
      summary: TSC_ERROR,
      failures: [TSC_ERROR]
    })
  })

  it('keeps no failure lines for a passing run, even when its logs print errors', () => {
    expect(
      readCheckOutcome('Error: a logged warning\n      Tests  3 passed (3)', false, true)
    ).toEqual({ result: 'pass', summary: 'Tests  3 passed (3)', failures: [] })
  })

  it('trusts the exit status over what a cut-off output says', () => {
    expect(readCheckOutcome(`${VITEST_PASS}${MARKER}`, false, true)?.result).toBe('pass')
    expect(readCheckOutcome(`Exit code 1\n${VITEST_PASS}${MARKER}`, true, true)?.result).toBe(
      'fail'
    )
  })
})

describe('readCheckOutcome from the output alone', () => {
  const read = (output: string) => readCheckOutcome(output, false, false)

  it.each([
    ['vitest', VITEST_FAIL, 'Tests  1 failed | 7 passed (8)'],
    [
      'vitest unhandled errors',
      '      Tests  3 passed (3)\n     Errors  1 error',
      'Errors  1 error'
    ],
    ['jest', JEST_FAIL, 'Tests:       1 failed, 3 passed, 4 total'],
    ['bun', ' 24 pass\n 1 fail\nRan 25 tests across 3 files.', '24 pass, 1 fail'],
    ['node', '✖ sums (1.2ms)\nℹ tests 3\nℹ pass 2\nℹ fail 1', '2 pass, 1 fail'],
    ['pytest', '==== 1 failed, 3 passed in 0.12s ====', '==== 1 failed, 3 passed in 0.12s ===='],
    ['tsc', `${TSC_ERROR}\n\nFound 3 errors in 2 files.`, 'Found 3 errors in 2 files.'],
    ['oxlint', 'Found 0 warnings and 2 errors.\nFinished in 5ms', 'Found 0 warnings and 2 errors.'],
    ['eslint', '✖ 3 problems (3 errors, 0 warnings)', '✖ 3 problems (3 errors, 0 warnings)']
  ])('fails when %s counts a failure', (_, output, summary) => {
    expect(read(output)).toMatchObject({ result: 'fail', summary })
  })

  it.each([
    ['vitest', VITEST_PASS, 'Tests  12 passed (12)'],
    ['jest', 'Tests:       4 passed, 4 total', 'Tests:       4 passed, 4 total'],
    ['bun', ' 25 pass\n 0 fail', '25 pass, 0 fail'],
    ['node', 'ℹ pass 3\nℹ fail 0', '3 pass, 0 fail'],
    ['pytest', '4 passed, 2 warnings in 0.30s', '4 passed, 2 warnings in 0.30s'],
    [
      'tsc',
      'Found 0 errors. Watching for file changes.',
      'Found 0 errors. Watching for file changes.'
    ],
    ['oxlint', 'Found 0 warnings and 0 errors.', 'Found 0 warnings and 0 errors.']
  ])('passes when %s reports no failures', (_, output, summary) => {
    expect(read(output)).toEqual({ result: 'pass', summary, failures: [] })
  })

  it('is unknown when the output reports neither', () => {
    expect(read('')).toBe(null)
    expect(read('Done in 2s')).toBe(null)
    expect(read(' ✓ src/a.test.ts (12 tests) 15ms')).toBe(null)
    // Warnings fail a lint run that denies them.
    expect(read('Found 3 warnings and 0 errors.')).toBe(null)
    expect(read('✖ 2 problems (0 errors, 2 warnings)')).toBe(null)
  })

  it('fails on the error diagnostics tsc and oxlint print without a summary when piped', () => {
    expect(read(`${TSC_ERROR}\n${TSC_ERROR.replace('(3,7)', '(9,1)')}`)).toEqual({
      result: 'fail',
      summary: TSC_ERROR,
      failures: [TSC_ERROR, TSC_ERROR.replace('(3,7)', '(9,1)')]
    })
    expect(read("src/a.ts:3:7 - error TS2322: Type 'string' is not assignable.")?.result).toBe(
      'fail'
    )
    expect(read(OXLINT_ERROR)).toMatchObject({ result: 'fail', failures: [OXLINT_ERROR] })
    expect(read('src/a.ts:1:7: warning eslint(no-unused-vars): x is never used')).toBe(null)
  })

  it('does not read a test’s name or a logged diagnostic as a failure', () => {
    expect(read(' ✓ reports 2 failed uploads 3ms\n      Tests  4 passed (4)')?.result).toBe('pass')
    expect(read('(pass) reports 2 errors\n 25 pass\n 0 fail')?.result).toBe('pass')
    expect(read(`stdout | a.test.ts\n  ${TSC_ERROR}\n      Tests  4 passed (4)`)?.result).toBe(
      'pass'
    )
  })

  it('never passes an output Orca cut short, which could hide a failure', () => {
    expect(read(`${VITEST_PASS}${MARKER}`)).toBe(null)
    expect(read(`${VITEST_FAIL}${MARKER}`)?.result).toBe('fail')
    expect(read(` ❯ src/b.test.ts (3 tests | 1 failed) 15ms\n   × b > fails${MARKER}`)).toEqual({
      result: 'fail',
      summary: '❯ src/b.test.ts (3 tests | 1 failed) 15ms',
      failures: ['× b > fails']
    })
  })

  it('ignores the leading Exit code line, line endings and colors', () => {
    expect(read(`Exit code 1\n${VITEST_PASS}`)?.result).toBe('pass')
    expect(read(VITEST_FAIL.replace(/\n/g, '\r\n'))?.summary).toBe('Tests  1 failed | 7 passed (8)')
    expect(read('\u001b[32m      Tests  \u001b[1m4 passed\u001b[22m (4)\u001b[39m')?.summary).toBe(
      'Tests  4 passed (4)'
    )
  })
})

describe('failureLines', () => {
  it('keeps the lines that name a failing test or an error, at most three', () => {
    const bun = [
      '(pass) parses dates',
      '(fail) parses times [2ms]',
      '  AssertionError: expected 3 to be 4',
      ' 1 fail'
    ].join('\n')
    expect(failureLines(bun)).toEqual([
      '(fail) parses times [2ms]',
      'AssertionError: expected 3 to be 4'
    ])
    const tsc = [1, 2, 3, 4]
      .map((n) => `src/a.ts(${n},1): error TS2322: Type 'x' is not assignable.`)
      .join('\n')
    expect(failureLines(tsc)).toHaveLength(3)
    // node --test lists each failure again under a "✖ failing tests:" heading.
    const node = [
      '✖ parses times (1.2ms)',
      'ℹ fail 1',
      '✖ failing tests:',
      'test at a.test.js:5:1',
      '✖ parses times (1.2ms)'
    ].join('\n')
    expect(failureLines(node)).toEqual(['✖ parses times (1.2ms)'])
    expect(failureLines('Done in 2s')).toEqual([])
  })

  it('never counts the Exit code line or Orca’s truncation marker', () => {
    expect(failureLines(`Exit code 1\n× parses times\nerror: boom${MARKER}`)).toEqual([
      '× parses times',
      'error: boom'
    ])
    expect(failureLines(`Exit code 1${MARKER}`)).toEqual([])
  })

  it('reads Windows line endings and colored output', () => {
    expect(failureLines('FAIL  src/a.test.ts > a\r\nAssertionError: x\r\n')).toEqual([
      'FAIL  src/a.test.ts > a',
      'AssertionError: x'
    ])
    expect(failureLines('\u001b[31m×\u001b[39m parses times')).toEqual(['× parses times'])
  })
})

describe('failureList', () => {
  it('names each failure’s file, even from a later line that repeats it, and what failed', () => {
    expect(
      failureList([
        "hooks/register.tsx(2310,7): error TS2322: Type 'string' is not assignable to 'number'."
      ])
    ).toEqual([{ file: 'register.tsx:2310', text: "Type 'string' is not assignable to 'number'." }])
    const vitest = [
      '× parses a dated heading 3ms',
      'FAIL  |node| tests/markdown/parse.test.ts > headings > parses a dated heading'
    ]
    expect(failureList(vitest)).toEqual([{ file: 'parse.test.ts', text: 'parses a dated heading' }])
    expect(failureList(['✖ sums every value (0.9ms)', '✖ averages the values (0.1ms)'])).toEqual([
      { file: null, text: 'sums every value' },
      { file: null, text: 'averages the values' }
    ])
    // Go names a package, not a file, and its first line is a bare FAIL.
    expect(failureList(['FAIL', 'FAIL\texample.com/app/message\t0.698s'])).toEqual([
      { file: null, text: 'example.com/app/message' }
    ])
  })

  it('reads oxlint’s compact lines', () => {
    expect(failureList([OXLINT_ERROR])).toEqual([
      {
        file: 'a.ts:1',
        text: '`debugger` statement is not allowed help: Remove the debugger statement'
      }
    ])
  })

  it('reads Windows paths', () => {
    expect(
      failureList(["C:\\repo\\src\\a.ts(12,5): error TS2322: Type 'x' is not assignable."])
    ).toEqual([{ file: 'a.ts:12', text: "Type 'x' is not assignable." }])
    expect(failureList(['FAIL  src\\b.test.ts > b > fails'])).toEqual([
      { file: 'b.test.ts', text: 'b > fails' }
    ])
  })
})

describe('failCount', () => {
  it('reads the counts summary back', () => {
    expect(failCount('24 pass, 1 fail')).toEqual({ fail: 1, total: 25 })
    expect(failCount('Tests  1 failed | 7 passed (8)')).toBe(null)
    expect(failCount('')).toBe(null)
  })
})

describe('distinctSummary and outputLines', () => {
  it('drop a summary that repeats a failure line, as tsc’s first error does', () => {
    expect(distinctSummary(TSC_ERROR, [TSC_ERROR])).toBe(null)
    expect(distinctSummary('Found 1 error', [TSC_ERROR])).toBe('Found 1 error')
    expect(distinctSummary('', [])).toBe(null)
    expect(outputLines(TSC_ERROR, [TSC_ERROR])).toEqual([TSC_ERROR])
    expect(outputLines('24 pass, 1 fail', ['(fail) parses times'])).toEqual([
      '(fail) parses times',
      '24 pass, 1 fail'
    ])
  })
})
