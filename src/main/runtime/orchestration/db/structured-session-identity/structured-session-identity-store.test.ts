import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../orchestration-db'

const ROW = {
  terminal_handle: 'structworker_a',
  session_id: 'session-1',
  pane_key: 'pane-a',
  worktree_id: 'wt_1',
  host_scope: '{"kind":"local","hostId":"local"}'
}

describe('structured session identity store', () => {
  let db: OrchestrationDb

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('reads an active grant by handle and by session', () => {
    db.insertStructuredSessionIdentity(ROW)

    expect(db.getActiveStructuredSessionIdentityByHandle('structworker_a')?.session_id).toBe(
      'session-1'
    )
    expect(db.getActiveStructuredSessionIdentityBySessionId('session-1')?.pane_key).toBe('pane-a')
    expect(db.listActiveStructuredSessionIdentities()).toHaveLength(1)
  })

  it('hides a revoked grant but keeps the row, and allows a fresh grant for the session', () => {
    db.insertStructuredSessionIdentity(ROW)
    expect(db.revokeStructuredSessionIdentity('structworker_a')).toBe(true)
    expect(db.revokeStructuredSessionIdentity('structworker_a')).toBe(false)

    expect(db.getActiveStructuredSessionIdentityByHandle('structworker_a')).toBeUndefined()
    expect(db.getActiveStructuredSessionIdentityBySessionId('session-1')).toBeUndefined()

    db.insertStructuredSessionIdentity({ ...ROW, terminal_handle: 'structworker_b' })
    expect(db.getActiveStructuredSessionIdentityBySessionId('session-1')?.terminal_handle).toBe(
      'structworker_b'
    )
  })

  it('allows only one active grant per session', () => {
    db.insertStructuredSessionIdentity(ROW)
    expect(() =>
      db.insertStructuredSessionIdentity({ ...ROW, terminal_handle: 'structworker_b' })
    ).toThrow()
  })
})
