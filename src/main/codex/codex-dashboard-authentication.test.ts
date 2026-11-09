import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../shared/agent-session/lifecycle/agent-session-record.test-fixture'
import { AgentSessionPoolAccountOrigin } from '../../shared/agent-session/lifecycle/agent-session-pool-account'
import type { StructuredAgentSessionAcquireInput } from '../native-chat/agent-session-wire/providers/structured-agent-session-adapter'
import { readDashboardCodexAllocationContext } from '../dashboard-accounts/dashboard-allocation-reader'
import {
  DashboardAllocationState,
  DashboardToolProvider
} from '../dashboard-accounts/dashboard-allocation-protocol'
import {
  DashboardCodexAdoptionStateSchema,
  DashboardCodexProcessesResponseSchema
} from '../dashboard-accounts/dashboard-codex-adoption-protocol'
import {
  adapterFor,
  acquireReadyCodexForTest,
  fakeCodex,
  identityFor
} from './structured/session-lifecycle/codex-structured-session-adapter-fixture'
import {
  chat,
  turn,
  SESSION as HISTORY_SESSION,
  THREAD as HISTORY_THREAD
} from './structured/threads/codex-thread-catch-up-contract-test-fixture'

vi.mock('../dashboard-accounts/dashboard-allocation-reader', () => ({
  readDashboardCodexAllocationContext: vi.fn()
}))
beforeEach(() => {
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'instance-fixture')
  vi.stubEnv('ORCA_DASHBOARD_CODEX_AUTH_EXPERIMENT', '1')
  vi.mocked(readDashboardCodexAllocationContext).mockResolvedValue({
    instanceId: 'instance-fixture',
    allocation: {
      provider: DashboardToolProvider.Codex,
      state: DashboardAllocationState.Available,
      account_id: 'pool-fixture',
      binding_revision: 1,
      credential_version: 2,
      access_token: 'fixture-private-access',
      chatgpt_account_id: 'workspace-fixture',
      expires_at: null
    }
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})
function setup() {
  const codex = fakeCodex({
    initialize: () => ({ userAgent: 'codex_cli_rs/0.166.0' }),
    'account/read': () => ({
      account: { type: 'chatgpt', email: null, planType: 'unknown' },
      requiresOpenaiAuth: true,
      workspaceRouting: { chatgptAccountId: 'workspace-fixture' }
    })
  })
  codex.routes['account/login/start'] = () => {
    const connection = codex.connections.at(-1)!
    connection.handlers.onNotification?.('account/login/completed', {
      loginId: null,
      success: true,
      error: null
    })
    connection.handlers.onNotification?.('account/updated', { authMode: 'chatgptAuthTokens' })
    return { type: 'chatgptAuthTokens' }
  }
  return codex
}
const input = () => ({ identity: identityFor('session-1'), fence: 7, spawnToken: 'spawn-9' })
const poolLaunch = () =>
  ({
    location: {
      executionHostId: 'local',
      workspaceId: 'ws-1',
      workspaceKind: 'folder',
      wslDistro: null
    },
    accountHome: { variable: 'CODEX_HOME', path: '/home/dev/.codex' },
    poolAccount: {
      version: 1,
      origin: AgentSessionPoolAccountOrigin.InheritedCopy,
      sourceSessionId: 'source-session',
      instanceId: 'instance-fixture',
      provider: DashboardToolProvider.Codex,
      accountId: 'pool-fixture',
      bindingRevision: 1,
      credentialVersion: 1
    }
  }) satisfies NonNullable<StructuredAgentSessionAcquireInput['launch']>

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('Codex Dashboard startup wiring', () => {
  it('marks quota read on an authenticated live pool connection without relying on the record home', async () => {
    const codex = setup()
    codex.routes['account/rateLimits/read'] = () => ({
      rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300 } }
    })
    const adapter = adapterFor(codex)
    try {
      await acquireReadyCodexForTest(adapter, input())
      const result = await adapter.readAccountUsage(
        {
          ...agentSessionRecordFixture(),
          sessionId: 'session-1'
        },
        new AbortController().signal
      )
      expect(result).toMatchObject({
        pool: true,
        live: true,
        rateLimits: { provider: 'codex', session: { usedPercent: 25, windowMinutes: 300 } }
      })
    } finally {
      await adapter.closeAll()
    }
  })

  it('accepts an inherited pool identity when the current same-account version is newer', async () => {
    const adapter = adapterFor(setup())
    try {
      await acquireReadyCodexForTest(adapter, { ...input(), launch: poolLaunch() })
      expect(adapter.readDashboardCodexProcesses().processes[0]).toMatchObject({
        account_id: 'pool-fixture',
        binding_revision: 1,
        credential_version: 2
      })
    } finally {
      await adapter.closeAll()
    }
  })

  it('refuses a different original account before spawning or injecting credentials', async () => {
    const codex = setup()
    const adapter = adapterFor(codex)
    const launch = poolLaunch()
    launch.poolAccount.accountId = 'original-pool'
    try {
      await expect(adapter.acquire({ ...input(), launch })).rejects.toThrow(
        'dashboard_allocation_unavailable'
      )
      expect(codex.connections).toEqual([])
    } finally {
      await adapter.closeAll()
    }
  })

  it('does not downgrade a known pool identity to personal authentication when the pool environment disappears', async () => {
    vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', undefined)
    const codex = setup()
    const adapter = adapterFor(codex)
    try {
      await expect(adapter.acquire({ ...input(), launch: poolLaunch() })).rejects.toThrow(
        'dashboard_allocation_unavailable'
      )
      expect(codex.connections).toEqual([])
    } finally {
      await adapter.closeAll()
    }
  })

  it('reports pending acquisition until successful thread publication, using the captured process identity', async () => {
    const codex = setup()
    const readStart = vi.fn(async () => 1700000000000.25)
    const adapter = adapterFor(codex, {}, [], { readProcessStartTime: readStart })
    const acquired = await adapter.acquire(input())
    const originalProcess = { ...acquired.process }
    acquired.process.pid = 9999
    expect(adapter.readDashboardCodexProcesses()).toEqual({
      pending_acquisitions: 1,
      processes: []
    })
    const entered = deferred<void>()
    const thread = deferred<unknown>()
    codex.routes['thread/start'] = () => {
      entered.resolve()
      return thread.promise
    }
    const opened = adapter.open({
      sessionId: 'session-1',
      fence: 7,
      acquisitionGeneration: acquired.acquisitionGeneration,
      signal: new AbortController().signal
    })
    await entered.promise
    expect(adapter.readDashboardCodexProcesses()).toEqual({
      pending_acquisitions: 1,
      processes: []
    })
    vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'replacement-instance')
    thread.resolve({ thread: { id: 'thread-pool' }, model: 'gpt-live', reasoningEffort: 'medium' })
    const result = await opened
    expect(result.poolAuthentication).toEqual({
      identity: {
        instanceId: 'instance-fixture',
        provider: 'codex',
        accountId: 'pool-fixture',
        bindingRevision: 1,
        credentialVersion: 2
      },
      process: {
        hostId: 'host-1',
        pid: 4321,
        processStartTimeMs: 1700000000000.25,
        spawnToken: 'spawn-9'
      }
    })
    expect(JSON.stringify(result.poolAuthentication)).not.toMatch(
      /fixture-private-access|workspace-fixture/
    )
    expect(adapter.readDashboardCodexProcesses()).toEqual({
      pending_acquisitions: 0,
      processes: [
        {
          session_id: 'session-1',
          fence: 7,
          acquisition_generation: acquired.acquisitionGeneration,
          process: originalProcess,
          account_id: 'pool-fixture',
          binding_revision: 1,
          credential_version: 2,
          connection_open: true,
          closing: false
        }
      ]
    })
    expect(readStart).toHaveBeenCalledOnce()
    expect(
      DashboardCodexAdoptionStateSchema.safeParse(adapter.readDashboardCodexProcesses()).success
    ).toBe(true)
    await adapter.closeAll()
    expect(adapter.readDashboardCodexProcesses()).toEqual({
      pending_acquisitions: 0,
      processes: []
    })
  })

  it('retains captured binding metadata across allocation changes and returns detached query results', async () => {
    const codex = setup()
    const adapter = adapterFor(codex)
    await acquireReadyCodexForTest(adapter, input())
    const before = adapter.readDashboardCodexProcesses()
    vi.mocked(readDashboardCodexAllocationContext).mockResolvedValue({
      instanceId: 'replacement-instance',
      allocation: {
        provider: DashboardToolProvider.Codex,
        state: DashboardAllocationState.Available,
        account_id: 'new-pool',
        binding_revision: 2,
        credential_version: 5,
        access_token: 'new-private-access',
        chatgpt_account_id: 'new-private-workspace',
        expires_at: null
      }
    })
    const detached = adapter.readDashboardCodexProcesses()
    detached.processes[0]!.account_id = 'mutated'
    detached.processes[0]!.process.pid = 9999
    expect(adapter.readDashboardCodexProcesses()).toEqual(before)
    expect(readDashboardCodexAllocationContext).toHaveBeenCalledOnce()
    expect(JSON.stringify(before)).not.toMatch(
      /fixture-private-access|workspace-fixture|access_token|chatgpt_account_id/
    )
    await adapter.closeAll()
  })

  it('does not publish adoption for failed or cancelled thread opens after authentication', async () => {
    const codex = setup()
    const adapter = adapterFor(codex)
    codex.routes['thread/start'] = () => {
      throw new Error('fixture thread failure')
    }
    await expect(acquireReadyCodexForTest(adapter, input())).rejects.toThrow(
      'fixture thread failure'
    )
    expect(adapter.readDashboardCodexProcesses()).toEqual({
      pending_acquisitions: 1,
      processes: []
    })
    await adapter.releaseAcquisition({ sessionId: 'session-1' })
    const acquired = await adapter.acquire(input())
    const entered = deferred<void>()
    const thread = deferred<unknown>()
    const signal = new AbortController()
    codex.routes['thread/start'] = () => {
      entered.resolve()
      return thread.promise
    }
    const opened = adapter.open({
      sessionId: 'session-1',
      fence: 7,
      acquisitionGeneration: acquired.acquisitionGeneration,
      signal: signal.signal
    })
    const refused = expect(opened).rejects.toThrow('fixture cancelled')
    await entered.promise
    signal.abort(new Error('fixture cancelled'))
    await refused
    thread.resolve({ thread: { id: 'late-thread' }, model: 'gpt-live' })
    expect(adapter.readDashboardCodexProcesses()).toEqual({
      pending_acquisitions: 1,
      processes: []
    })
    await adapter.releaseAcquisition({ sessionId: 'session-1' })
    expect(adapter.readDashboardCodexProcesses()).toEqual({
      pending_acquisitions: 0,
      processes: []
    })
  })

  it('returns a pool receipt only after resumed history reaches the journal', async () => {
    const history = await chat({ now: 1700000000000 })
    const codex = setup()
    codex.routes['thread/turns/list'] = () => ({ data: [turn(0)], nextCursor: null })
    const adapter = adapterFor(codex, { resumeThreadId: HISTORY_THREAD })
    try {
      const acquired = await adapter.acquire({
        identity: identityFor(HISTORY_SESSION),
        fence: 1,
        spawnToken: 'spawn-9',
        events: history.deferred.sink
      })
      const result = await adapter.open({
        sessionId: HISTORY_SESSION,
        fence: 1,
        acquisitionGeneration: acquired.acquisitionGeneration,
        signal: new AbortController().signal
      })
      expect(history.texts()).toContain('assistant:answer 0')
      expect(result.poolAuthentication?.identity).toEqual({
        instanceId: 'instance-fixture',
        provider: 'codex',
        accountId: 'pool-fixture',
        bindingRevision: 1,
        credentialVersion: 2
      })
    } finally {
      await adapter.closeAll()
    }
  })

  it('refuses a pool receipt when required history is unwritten while keeping personal catch-up optional', async () => {
    const events = {
      appendItem: vi.fn(),
      appendTombstone: vi.fn(),
      publish: vi.fn(),
      written: async () => ({
        ok: false as const,
        error: new Error('fixture-private-history-failure')
      })
    }
    const pool = adapterFor(setup(), { resumeThreadId: 'restored-thread' })
    try {
      await expect(acquireReadyCodexForTest(pool, { ...input(), events })).rejects.toThrow(
        'dashboard_allocation_unavailable'
      )
      expect(pool.readDashboardCodexProcesses()).toEqual({ pending_acquisitions: 1, processes: [] })
    } finally {
      await pool.closeAll()
    }
    vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', undefined)
    const personal = adapterFor(setup(), { resumeThreadId: 'restored-thread' })
    try {
      await expect(
        acquireReadyCodexForTest(personal, { ...input(), events })
      ).resolves.toMatchObject({ process: { pid: 4321 } })
    } finally {
      await personal.closeAll()
    }
  })

  it('keeps unproven closes visible and only removes a record after its matching exit', async () => {
    const codex = setup()
    const adapter = adapterFor(codex)
    await acquireReadyCodexForTest(adapter, input())
    const connection = codex.connections[0]!
    connection.close = async () => {
      connection.closed = true
      return false
    }
    expect(await adapter.closeSession('session-1')).toBe(false)
    expect(adapter.readDashboardCodexProcesses()).toMatchObject({
      pending_acquisitions: 0,
      processes: [{ credential_version: 2, connection_open: false, closing: true }]
    })
    connection.handlers.onExit?.(new Error('fixture confirmed exit'))
    expect(adapter.readDashboardCodexProcesses()).toEqual({
      pending_acquisitions: 0,
      processes: []
    })
    await adapter.closeAll()
  })

  it('ignores an old connection exit after a replacement generation publishes', async () => {
    const codex = setup()
    const adapter = adapterFor(codex)
    const first = await acquireReadyCodexForTest(adapter, input())
    const previous = codex.connections[0]!
    const replacement = await acquireReadyCodexForTest(adapter, {
      ...input(),
      spawnToken: 'replacement-spawn'
    })
    expect(first.acquisitionGeneration).not.toBe(replacement.acquisitionGeneration)
    previous.handlers.onExit?.(new Error('fixture late old exit'))
    expect(adapter.readDashboardCodexProcesses()).toMatchObject({
      pending_acquisitions: 0,
      processes: [
        {
          acquisition_generation: replacement.acquisitionGeneration,
          process: { spawnToken: 'replacement-spawn' },
          connection_open: true,
          closing: false
        }
      ]
    })
    expect(adapter.readDashboardCodexProcesses().processes).toHaveLength(1)
    await adapter.closeAll()
  })

  it('preserves supported-state discrimination and nullable non-integer start times in the response schema', () => {
    const common = {
      schema_version: 1,
      instance_id: 'fixture-instance',
      runtime_id: 'fixture-runtime'
    }
    expect(
      DashboardCodexProcessesResponseSchema.safeParse({ ...common, supported: false }).success
    ).toBe(true)
    expect(
      DashboardCodexProcessesResponseSchema.safeParse({
        ...common,
        supported: false,
        pending_acquisitions: 0,
        processes: []
      }).success
    ).toBe(false)
    expect(
      DashboardCodexProcessesResponseSchema.safeParse({
        ...common,
        supported: true,
        pending_acquisitions: 0,
        processes: []
      }).success
    ).toBe(true)
    const process = {
      session_id: 'session-1',
      fence: 7,
      acquisition_generation: 'generation-1',
      process: { hostId: 'host-1', pid: 4321, processStartTimeMs: null, spawnToken: 'spawn-9' },
      account_id: 'pool-fixture',
      binding_revision: 1,
      credential_version: 2,
      connection_open: true,
      closing: false
    }
    expect(
      DashboardCodexAdoptionStateSchema.safeParse({ pending_acquisitions: 0, processes: [process] })
        .success
    ).toBe(true)
    expect(
      DashboardCodexAdoptionStateSchema.safeParse({
        pending_acquisitions: 0,
        processes: [{ ...process, access_token: 'unaccepted' }]
      }).success
    ).toBe(false)
  })

  it('rejects pool mode before launch resolution unless the experiment is explicitly enabled', async () => {
    vi.stubEnv('ORCA_DASHBOARD_CODEX_AUTH_EXPERIMENT', undefined)
    const codex = setup()
    const resolveLaunch = vi.fn(async () => {
      throw new Error('unexpected launch resolution')
    })
    const adapter = adapterFor(codex, {}, [], { resolveLaunch })
    await expect(adapter.acquire(input())).rejects.toThrow()
    expect(resolveLaunch).not.toHaveBeenCalled()
    expect(codex.connections).toHaveLength(0)
    expect(readDashboardCodexAllocationContext).not.toHaveBeenCalled()
    expect(adapter.readDashboardCodexProcesses()).toEqual({
      pending_acquisitions: 0,
      processes: []
    })
  })

  it('authenticates and proves the workspace before opening a thread', async () => {
    const codex = setup()
    const adapter = adapterFor(codex, {
      env: { OPENAI_API_KEY: 'local-key', HTTPS_PROXY: 'http://proxy.invalid' }
    })
    await acquireReadyCodexForTest(adapter, input())
    const connection = codex.connections[0]!
    const methods = connection.calls.map((call) => call.method)
    expect(methods.indexOf('initialize')).toBeLessThan(methods.indexOf('account/login/start'))
    expect(methods.indexOf('account/login/start')).toBeLessThan(methods.indexOf('account/read'))
    expect(methods.indexOf('account/read')).toBeLessThan(methods.indexOf('thread/start'))
    expect(connection.launch.env).not.toHaveProperty('OPENAI_API_KEY')
    expect(connection.launch.env).toMatchObject({ HTTPS_PROXY: 'http://proxy.invalid' })
    expect(connection.launch.envToDelete).toContain('OPENAI_API_KEY')
    expect(connection.launch).not.toHaveProperty('access_token')
    await adapter.closeAll()
  })

  it('closes a failed login without opening a thread or forwarding the private error', async () => {
    const codex = setup()
    codex.routes['account/login/start'] = () => {
      codex.connections[0]!.handlers.onNotification?.('account/login/completed', {
        loginId: null,
        success: false,
        error: 'fixture-private-access'
      })
      return { type: 'chatgptAuthTokens' }
    }
    const adapter = adapterFor(codex)
    await expect(acquireReadyCodexForTest(adapter, input())).rejects.toThrow(
      'dashboard_allocation_unavailable'
    )
    const connection = codex.connections[0]!
    expect(connection.calls.some((call) => call.method === 'thread/start')).toBe(false)
    expect(adapter.readDashboardCodexProcesses()).toEqual({
      pending_acquisitions: 1,
      processes: []
    })
    expect(await adapter.releaseAcquisition({ sessionId: 'session-1' })).toBe(true)
    expect(connection.closeCount).toBeGreaterThan(0)
  })

  it('immediately rejects a refresh callback for another workspace before publication', async () => {
    const codex = setup()
    codex.routes['account/login/start'] = () => {
      const connection = codex.connections[0]!
      connection.handlers.onServerRequest?.({
        id: 81,
        method: 'account/chatgptAuthTokens/refresh',
        params: { reason: 'unauthorized', previousAccountId: 'different-workspace' }
      })
      expect(connection.replies).toContainEqual({
        id: 81,
        code: -32001,
        message: 'Dashboard credential refresh is not available'
      })
      return { type: 'chatgptAuthTokens' }
    }
    const adapter = adapterFor(codex)
    await expect(acquireReadyCodexForTest(adapter, input())).rejects.toThrow(
      'dashboard_allocation_unavailable'
    )
    expect(codex.connections[0]!.calls.some((call) => call.method === 'thread/start')).toBe(false)
    expect(await adapter.releaseAcquisition({ sessionId: 'session-1' })).toBe(true)
    expect(codex.connections[0]!.closeCount).toBeGreaterThan(0)
  })

  it('preserves local-mode authentication and opens without pool RPCs', async () => {
    vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', undefined)
    const codex = setup()
    const adapter = adapterFor(codex, { env: { OPENAI_API_KEY: 'local-key' } })
    await acquireReadyCodexForTest(adapter, input())
    const connection = codex.connections[0]!
    expect(connection.calls.some((call) => call.method.startsWith('account/'))).toBe(false)
    expect(connection.launch.env).toMatchObject({ OPENAI_API_KEY: 'local-key' })
    expect(readDashboardCodexAllocationContext).not.toHaveBeenCalled()
    expect(adapter.readDashboardCodexProcesses()).toEqual({
      pending_acquisitions: 0,
      processes: []
    })
    await adapter.closeAll()
  })
})
