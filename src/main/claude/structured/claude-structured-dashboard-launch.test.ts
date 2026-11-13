import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  adapterAtPublishFor,
  adapterFor,
  fakeClaude,
  identityFor,
  PROVIDER_SESSION_ID,
  USER_MESSAGE
} from './claude-structured-session-test-support'
import { claudeOpened } from './claude-structured-startup-settled-test-support'
import { ClaudeStructuredSessionAdapter } from './claude-structured-session-adapter'
import { DashboardAllocationErrorCode } from '../../dashboard-accounts/dashboard-allocation-protocol'
import { AgentSessionAcquisitionRootExitObservedError } from '../../native-chat/agent-session-wire/acquisition/structured-agent-session-acquisition-errors'
import type { ClaudeStructuredSessionEvent } from './claude-structured-session-state'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }
  vi.restoreAllMocks()
})
function fixture(holdInit = false, pooled = true) {
  const claude = fakeClaude({
    holdInit,
    ...(pooled ? { initAccount: { tokenSource: 'CLAUDE_CODE_OAUTH_TOKEN' } } : {})
  })
  const binding = { account_id: 'pool-claude', binding_revision: 2, credential_version: 1 }
  const launch = pooled ? { dashboardBinding: binding } : {}
  const events: ClaudeStructuredSessionEvent[] = []
  const adapter = (holdInit ? adapterAtPublishFor : adapterFor)(claude, launch, events)
  cleanups.push(async () => {
    claude.dispose()
    await adapter.closeAll()
  })
  return { claude, binding, adapter, events }
}
const acquire = (adapter: ReturnType<typeof fixture>['adapter'], spawnToken = 'spawn-1') =>
  adapter.acquire({ identity: identityFor(), fence: 7, spawnToken })

function sourceFixture(account: unknown, pooled: boolean, naming: boolean) {
  const claude = fakeClaude({ initAccount: account })
  const adapter = new ClaudeStructuredSessionAdapter({
    resolveLaunch: async () => ({
      pathToClaudeCodeExecutable: 'claude',
      options: {},
      cwd: '/work/repo',
      claudeConfigDir: '/accounts/claude',
      providerSessionId: PROVIDER_SESSION_ID,
      resumeLeafUuid: null,
      resumesTranscript: false,
      continuesChain: false,
      cliFlag: async () => 'supported' as const,
      ...(pooled
        ? {
            dashboardBinding: {
              account_id: 'pool-claude',
              binding_revision: 2,
              credential_version: 1
            }
          }
        : {})
    }),
    openConnection: claude.openConnection,
    readProcessStartTime: async () => 1700000000000,
    ...(naming
      ? {
          namingInputs: async () => {
            throw new Error('Unexpected naming request')
          }
        }
      : {})
  })
  cleanups.push(async () => {
    claude.dispose()
    await adapter.closeAll()
  })
  return { claude, adapter }
}

describe.each([false, true])('Claude pool authentication source (naming=%s)', (naming) => {
  it.each([
    { name: 'missing account', account: undefined },
    { name: 'invalid account', account: 'fixture-private-account-text' },
    { name: 'other OAuth', account: { tokenSource: 'oauth' } },
    { name: 'API key', account: { tokenSource: 'none', apiKeySource: 'environment' } },
    {
      name: 'mixed sources',
      account: { tokenSource: 'CLAUDE_CODE_OAUTH_TOKEN', apiKeySource: 'environment' }
    },
    {
      name: 'unknown API source',
      account: { tokenSource: 'CLAUDE_CODE_OAUTH_TOKEN', apiKeySource: null }
    }
  ])('rejects $name without exposing account data or confirming startup', async ({ account }) => {
    const { claude, adapter } = sourceFixture(account, true, naming)
    const opening = acquire(adapter).then(() => claudeOpened(adapter, 'session-1'))
    await expect(opening).rejects.toMatchObject({
      message: DashboardAllocationErrorCode.Unavailable
    })
    expect(
      adapter.readDashboardClaudeLaunches().processes.filter((process) => process.initialized)
    ).toEqual([])
    expect(claude.connections.flatMap((connection) => connection.sent)).toEqual([])
  })

  it.each([
    { tokenSource: 'CLAUDE_CODE_OAUTH_TOKEN' },
    { tokenSource: 'CLAUDE_CODE_OAUTH_TOKEN', apiKeySource: 'none' }
  ])(
    'opens the selected OAuth source without manufacturing an adoption proof: %j',
    async (account) => {
      const { adapter } = sourceFixture(account, true, naming)
      await acquire(adapter)
      await claudeOpened(adapter, 'session-1')
      expect(adapter.readDashboardClaudeLaunches().processes).toMatchObject([
        { initialized: true, credential_version: 1 }
      ])
    }
  )

  it.each([undefined, { tokenSource: 'none', apiKeySource: 'environment' }])(
    'preserves local-account initialization: %j',
    async (account) => {
      const { adapter } = sourceFixture(account, false, naming)
      await acquire(adapter)
      await claudeOpened(adapter, 'session-1')
      expect(adapter.readDashboardClaudeLaunches().processes).toEqual([])
    }
  )
})

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

  it('reports a retiring child until root exit and fences its late exit from the replacement', async () => {
    const { claude, binding, adapter, events } = fixture()
    const first = await acquire(adapter)
    const connection = claude.connections[0]
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const ended = Promise.withResolvers<void>()
    const publish = events.push.bind(events)
    vi.spyOn(events, 'push').mockImplementation((...published) => {
      const length = publish(...published)
      if (published.some((event) => event.type === 'ended' && event.fence === 7)) {
        ended.resolve()
      }
      return length
    })
    vi.spyOn(connection, 'close').mockImplementation(async () => {
      entered.resolve()
      await release.promise
      connection.closed = true
      return true
    })
    vi.spyOn(connection, 'send').mockImplementationOnce(async (_message, beforeDispatch) => {
      await beforeDispatch?.()
      connection.handlers.onMessage?.({
        type: 'system',
        subtype: 'ui_panes',
        session_id: PROVIDER_SESSION_ID,
        focus_requested_id: 'plugin-pane',
        panes: [{ id: 'plugin-pane', plugin: 'fixture-plugin' }]
      })
    })
    try {
      await adapter.dispatch({
        sessionId: 'session-1',
        clientMessageId: 'plugin-input',
        body: USER_MESSAGE,
        fence: 7
      })
      await entered.promise
      expect(events).toContainEqual(expect.objectContaining({ type: 'retiring', fence: 7 }))
      connection.exitVerdict = {
        root: 'unverifiable',
        tree: 'unverifiable',
        killDelivered: true
      }
      release.resolve()
      await adapter.drainObservedExits()
      const retiring = [
        {
          session_id: 'session-1',
          fence: 7,
          acquisition_generation: first.acquisitionGeneration,
          account_id: 'pool-claude',
          binding_revision: 2,
          credential_version: 1,
          process: {
            hostId: 'host-1',
            pid: 4321,
            processStartTimeMs: 1700000000000,
            spawnToken: 'spawn-1'
          },
          initialized: true,
          connection_open: false,
          closing: true
        }
      ]
      expect(adapter.readDashboardClaudeLaunches().processes).toEqual(retiring)
      await expect(adapter.releaseAcquisition({ sessionId: 'session-1' })).rejects.toMatchObject({
        name: 'AgentSessionAcquisitionRootExitObservedError',
        deathEvidenceKind: 'kill-delivered'
      })
      await expect(
        adapter.acquire({ identity: identityFor(), fence: 8, spawnToken: 'spawn-2' })
      ).rejects.toBeInstanceOf(AgentSessionAcquisitionRootExitObservedError)
      expect(adapter.readDashboardClaudeLaunches()).toEqual({
        pending_acquisitions: 0,
        processes: retiring
      })
      expect(events.filter((event) => event.type === 'ended')).toEqual([])
      connection.exitVerdict = { root: 'exited', tree: 'exited' }
      connection.handlers.onExit?.(new Error('retired root exited'), { expected: true })
      await ended.promise
      await adapter.drainObservedExits()
      expect(adapter.readDashboardClaudeLaunches().processes).toEqual([])
    } finally {
      release.resolve()
    }
    binding.credential_version = 2
    const replacement = await adapter.acquire({
      identity: identityFor(),
      fence: 8,
      spawnToken: 'spawn-2'
    })
    connection.handlers.onExit?.(new Error('late retired exit'))
    expect(adapter.readDashboardClaudeLaunches().processes).toEqual([
      expect.objectContaining({
        fence: 8,
        acquisition_generation: replacement.acquisitionGeneration,
        credential_version: 2,
        process: {
          hostId: 'host-1',
          pid: 4321,
          processStartTimeMs: 1700000000000,
          spawnToken: 'spawn-2'
        },
        closing: false
      })
    ])
    expect(events.filter((event) => event.type === 'ended')).toEqual([
      expect.objectContaining({
        fence: 7,
        acquisitionGeneration: first.acquisitionGeneration,
        cause: 'unexpected-exit'
      })
    ])
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
