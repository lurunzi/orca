import { describe, expect, it } from 'vitest'
import {
  recordSessionInboxCheck,
  sessionInboxCheckKey,
  sessionInboxChecksAfterEdit,
  sessionInboxPathContains
} from './session-inbox-check-tracking'
import type { SessionInboxCheck } from './session-inbox-types'

function check(overrides: Partial<SessionInboxCheck> = {}): SessionInboxCheck {
  const base = {
    itemId: 'run-1',
    turnUserItemId: null,
    at: 1,
    name: 'vitest',
    kind: 'tests' as const,
    target: { paths: [], filters: [] },
    folder: null,
    command: 'vitest run',
    result: 'fail' as const,
    summary: '',
    failures: [],
    isStale: false,
    isLeftFailing: false,
    ...overrides
  }
  return { ...base, key: sessionInboxCheckKey(base) }
}

describe('session inbox check tracking', () => {
  it('lets a whole-suite run replace a narrower one, never the other way round', () => {
    const narrow = check({ itemId: 'narrow', target: { paths: ['/repo/a.test.ts'], filters: [] } })
    const whole = check({ itemId: 'whole', result: 'pass' })

    expect(recordSessionInboxCheck([narrow], whole).map((entry) => entry.itemId)).toEqual(['whole'])
    expect(recordSessionInboxCheck([whole], narrow).map((entry) => entry.itemId)).toEqual([
      'whole',
      'narrow'
    ])
  })

  it('keeps checks of other folders and other filters apart', () => {
    const app = check({ itemId: 'app', folder: '/repo/app' })
    const filtered = check({ itemId: 'filtered', target: { paths: [], filters: ['-t=dates'] } })
    const results = recordSessionInboxCheck(recordSessionInboxCheck([], app), filtered)

    expect(results.map((entry) => entry.itemId)).toEqual(['app', 'filtered'])
  })

  it('clears every result in its folder when a check script passes', () => {
    const lint = check({ itemId: 'lint', name: 'oxlint', kind: 'lint' })
    const all = check({ itemId: 'all', name: 'check.sh', kind: 'all', result: 'pass' })

    expect(recordSessionInboxCheck([lint], all).map((entry) => entry.itemId)).toEqual(['all'])
  })

  it('goes stale on an edit in its folder, but a test run ignores Markdown', () => {
    const tests = check({ folder: '/repo/app' })
    const lint = check({ name: 'oxlint', kind: 'lint', folder: '/repo/app' })

    expect(sessionInboxChecksAfterEdit([tests], '/repo/app/src/a.ts', '/repo')[0]?.isStale).toBe(
      true
    )
    expect(sessionInboxChecksAfterEdit([tests], '/repo/other/a.ts', '/repo')[0]?.isStale).toBe(
      false
    )
    expect(sessionInboxChecksAfterEdit([tests], '/repo/app/README.md', '/repo')[0]?.isStale).toBe(
      false
    )
    expect(sessionInboxChecksAfterEdit([lint], '/repo/app/README.md', '/repo')[0]?.isStale).toBe(
      true
    )
  })

  it('compares Windows paths without case', () => {
    expect(sessionInboxPathContains('C:/Users/me/repo', 'c:/users/ME/repo/src/a.ts')).toBe(true)
    expect(sessionInboxPathContains('/repo', '/repository/a.ts')).toBe(false)
    expect(sessionInboxPathContains('C:/repo', String.raw`c:\REPO\src\a.ts`)).toBe(true)
    expect(
      sessionInboxPathContains('//wsl.localhost/Ubuntu/home/A', '//wsl$/ubuntu/home/a/x')
    ).toBe(false)
  })

  it('replaces Windows folder aliases while keeping case-sensitive host folders distinct', () => {
    const failed = check({ itemId: 'failed', folder: 'C:/repo/App' })
    const passed = check({ itemId: 'passed', folder: 'c:/REPO/app', result: 'pass' })
    expect(failed.key).toBe(passed.key)
    expect(recordSessionInboxCheck([failed], passed).map((entry) => entry.itemId)).toEqual([
      'passed'
    ])
    const linuxFailed = check({ folder: '/repo/App' })
    const linuxPassed = check({ folder: '/repo/app', result: 'pass' })
    expect(recordSessionInboxCheck([linuxFailed], linuxPassed)).toHaveLength(2)
  })
})
