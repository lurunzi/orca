import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adapterAtPublishFor,
  adapterFor,
  fakeClaude,
  identityFor
} from './claude-structured-session-test-support'
import { claudeOpened } from './claude-structured-startup-settled-test-support'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }
  vi.restoreAllMocks()
})
function fixture(holdInit = false, pooled = true) {
  const claude = fakeClaude({ holdInit })
  const binding = { account_id: 'pool-claude', binding_revision: 2, credential_version: 1 }
  const launch = pooled ? { dashboardBinding: binding } : {}
  const adapter = (holdInit ? adapterAtPublishFor : adapterFor)(claude, launch)
  cleanups.push(async () => {
    claude.dispose()
    await adapter.closeAll()
  })
  return { claude, binding, adapter }
}
const acquire = (adapter: ReturnType<typeof fixture>['adapter'], spawnToken = 'spawn-1') =>
  adapter.acquire({ identity: identityFor(), fence: 7, spawnToken })

describe('Claude pool process startup evidence', () => {
  it('distinguishes publication from initialize and returns immutable launch metadata copies', async () => {
    const { claude, binding, adapter } = fixture(true)
    await acquire(adapter)
    expect(adapter.readDashboardClaudeLaunches()).toEqual({
      pending_acquisitions: 0,
      processes: [
        {
          session_id: 'session-1',
          fence: 7,
          acquisition_generation: expect.any(String),
          account_id: 'pool-claude',
          binding_revision: 2,
          credential_version: 1,
          process: {
            hostId: 'host-1',
            pid: 4321,
            processStartTimeMs: 1700000000000,
            spawnToken: 'spawn-1'
          },
          initialized: false,
          connection_open: true,
          closing: false
        }
      ]
    })
    const opened = claudeOpened(adapter, 'session-1')
    const calls = [...claude.connections[0].calls]
    const snapshot = adapter.readDashboardClaudeLaunches()
    snapshot.processes[0].process.pid = 1
    snapshot.processes[0].credential_version = 999
    binding.credential_version = 2
    expect(adapter.readDashboardClaudeLaunches().processes[0]).toMatchObject({
      credential_version: 1,
      initialized: false,
      process: { pid: 4321 }
    })
    expect(claude.connections[0].calls).toEqual(calls)
    claude.connections[0].initialization.resolve()
    await opened
    expect(adapter.readDashboardClaudeLaunches().processes[0]).toMatchObject({
      credential_version: 1,
      initialized: true
    })
  })

  it.each([false, true])(
    'does not confirm failed or cancelled initialization (cancelled=%s)',
    async (cancelled) => {
      const { claude, adapter } = fixture(true)
      const acquisition = await acquire(adapter)
      const controller = new AbortController()
      const opened = adapter.open({
        sessionId: 'session-1',
        fence: 7,
        acquisitionGeneration: acquisition.acquisitionGeneration!,
        signal: controller.signal
      })
      const rejected = expect(opened).rejects.toThrow(
        cancelled ? 'cancelled startup' : 'initialize refused'
      )
      if (cancelled) {
        controller.abort(new Error('cancelled startup'))
      } else {
        claude.connections[0].initialization.reject(new Error('initialize refused'))
      }
      await rejected
      expect(
        adapter.readDashboardClaudeLaunches().processes.filter((process) => process.initialized)
      ).toEqual([])
    }
  )

  it('retains the original process during close and removes it after exit is proven', async () => {
    const { claude, adapter } = fixture()
    await acquire(adapter)
    const connection = claude.connections[0]
    const close = connection.close.bind(connection)
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>()
    vi.spyOn(connection, 'close').mockImplementationOnce(async () => {
      entered.resolve()
      await release.promise
      return close()
    })
    const closing = adapter.releaseAcquisition({ sessionId: 'session-1' })
    try {
      await entered.promise
      expect(adapter.readDashboardClaudeLaunches().processes[0]).toMatchObject({
        initialized: true,
        closing: true,
        process: { spawnToken: 'spawn-1' }
      })
    } finally {
      release.resolve()
    }
    await closing
    expect(adapter.readDashboardClaudeLaunches().processes).toEqual([])
  })

  it('does not let a stale exit clear the replacement process or change its version', async () => {
    const { claude, binding, adapter } = fixture()
    await acquire(adapter)
    binding.credential_version = 2
    await acquire(adapter, 'spawn-2')
    claude.connections[0].handlers.onExit?.(new Error('old child exited'))
    expect(adapter.readDashboardClaudeLaunches().processes).toEqual([
      expect.objectContaining({
        credential_version: 2,
        initialized: true,
        process: expect.objectContaining({ spawnToken: 'spawn-2' })
      })
    ])
  })

  it('does not manufacture pool evidence for a local-account process', async () => {
    const { adapter } = fixture(false, false)
    await acquire(adapter)
    expect(adapter.readDashboardClaudeLaunches()).toEqual({
      pending_acquisitions: 0,
      processes: []
    })
  })
})
