import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readDashboardCodexAllocation } from '../dashboard-accounts/dashboard-allocation-reader'
import {
  DashboardAllocationState,
  DashboardToolProvider
} from '../dashboard-accounts/dashboard-allocation-protocol'
import type { CodexAppServerConnection } from './app-server/codex-app-server-connection-types'
import {
  adapterFor,
  acquireReadyCodexForTest,
  fakeCodex,
  identityFor
} from './codex-structured-session-adapter-fixture'

vi.mock('../dashboard-accounts/dashboard-allocation-reader', () => ({
  readDashboardCodexAllocation: vi.fn()
}))
const allocation = (version = 1) =>
  ({
    provider: DashboardToolProvider.Codex,
    state: DashboardAllocationState.Available,
    account_id: 'pool-fixture',
    binding_revision: 1,
    credential_version: version,
    access_token: `fixture-private-access-${version}`,
    chatgpt_account_id: 'workspace-fixture',
    expires_at: null
  }) as const
const input = () => ({ identity: identityFor('session-1'), fence: 7, spawnToken: 'spawn-9' })
const account = () => ({
  account: { type: 'chatgpt' },
  requiresOpenaiAuth: true,
  workspaceRouting: { chatgptAccountId: 'workspace-fixture' }
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function waitForReply(connection: CodexAppServerConnection) {
  const settled = deferred<{
    id: number | string
    result?: unknown
    code?: number
    message?: string
  }>()
  const respond = connection.respond
  const respondWithError = connection.respondWithError
  connection.respond = (id, result) => {
    respond(id, result)
    settled.resolve({ id, result })
  }
  connection.respondWithError = (id, code, message) => {
    respondWithError(id, code, message)
    settled.resolve({ id, code, message })
  }
  return settled.promise
}
function setup() {
  const codex = fakeCodex({
    initialize: () => ({ userAgent: 'codex_cli_rs/0.166.0' }),
    'account/read': account
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
function requestRefresh(
  connection: ReturnType<typeof fakeCodex>['connections'][number],
  id: number
) {
  connection.handlers.onServerRequest?.({
    id,
    method: 'account/chatgptAuthTokens/refresh',
    params: { reason: 'unauthorized', previousAccountId: 'workspace-fixture' }
  })
}
const refreshed = {
  accessToken: 'fixture-private-access-2',
  chatgptAccountId: 'workspace-fixture',
  chatgptPlanType: null
}
beforeEach(() => {
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'instance-fixture')
  vi.stubEnv('ORCA_DASHBOARD_CODEX_AUTH_EXPERIMENT', '1')
  vi.mocked(readDashboardCodexAllocation).mockResolvedValue(allocation())
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})

describe('Codex Dashboard refresh callback wiring', () => {
  it('answers a published child with a newer same-binding token without changing its adoption receipt or retrying a model', async () => {
    const codex = setup()
    const adapter = adapterFor(codex)
    try {
      await acquireReadyCodexForTest(adapter, input())
      const before = adapter.readDashboardCodexProcesses()
      const connection = codex.connections.at(-1)!
      const replied = waitForReply(connection)
      vi.mocked(readDashboardCodexAllocation).mockResolvedValue(allocation(2))
      requestRefresh(connection, 81)
      const pending = adapter.readDashboardCodexRefreshes().requests
      expect(pending).toMatchObject([
        {
          session_id: 'session-1',
          fence: 7,
          acquisition_generation: before.processes[0]!.acquisition_generation,
          process: before.processes[0]!.process,
          provider: DashboardToolProvider.Codex,
          account_id: 'pool-fixture',
          binding_revision: 1,
          credential_version: 1
        }
      ])
      expect(pending[0]!.request_id).not.toBe('81')
      expect(JSON.stringify(pending)).not.toMatch(
        /fixture-private|workspace-fixture|access_token|authToken/
      )
      await expect(replied).resolves.toEqual({ id: 81, result: refreshed })
      expect(adapter.readDashboardCodexRefreshes()).toEqual({ requests: [] })
      expect(adapter.readDashboardCodexProcesses()).toEqual(before)
      expect(before.processes[0]!.credential_version).toBe(1)
      expect(connection.calls.filter((call) => call.method === 'account/login/start')).toHaveLength(
        1
      )
      expect(connection.calls.some((call) => call.method.startsWith('turn/'))).toBe(false)
    } finally {
      await adapter.closeAll()
    }
  })

  it('services a callback during account/read before the authenticated thread publishes', async () => {
    const codex = setup()
    const adapter = adapterFor(codex)
    codex.routes['account/read'] = async () => {
      const connection = codex.connections.at(-1)!
      const replied = waitForReply(connection)
      expect(adapter.readDashboardCodexProcesses()).toEqual({
        pending_acquisitions: 1,
        processes: []
      })
      vi.mocked(readDashboardCodexAllocation).mockResolvedValue(allocation(2))
      requestRefresh(connection, 82)
      expect(adapter.readDashboardCodexRefreshes().requests).toMatchObject([
        {
          session_id: 'session-1',
          fence: 7,
          acquisition_generation: 'generation-1',
          process: { pid: connection.pid, spawnToken: 'spawn-9' },
          credential_version: 1
        }
      ])
      await expect(replied).resolves.toEqual({ id: 82, result: refreshed })
      expect(adapter.readDashboardCodexRefreshes()).toEqual({ requests: [] })
      return account()
    }
    try {
      await acquireReadyCodexForTest(adapter, input())
      expect(adapter.readDashboardCodexProcesses()).toMatchObject({
        pending_acquisitions: 0,
        processes: [{ credential_version: 1, connection_open: true, closing: false }]
      })
      expect(codex.connections.at(-1)!.calls.some((call) => call.method.startsWith('turn/'))).toBe(
        false
      )
    } finally {
      await adapter.closeAll()
    }
  })

  it('refuses late credentials when the original child is released while its allocation read is pending', async () => {
    const codex = setup()
    const adapter = adapterFor(codex)
    const reading = deferred<ReturnType<typeof allocation>>()
    const entered = deferred<void>()
    try {
      await acquireReadyCodexForTest(adapter, input())
      const connection = codex.connections.at(-1)!
      const replied = waitForReply(connection)
      vi.mocked(readDashboardCodexAllocation).mockImplementationOnce(() => {
        entered.resolve()
        return reading.promise
      })
      requestRefresh(connection, 83)
      await entered.promise
      expect(adapter.readDashboardCodexRefreshes().requests).toHaveLength(1)
      expect(await adapter.releaseAcquisition({ sessionId: 'session-1' })).toBe(true)
      expect(adapter.readDashboardCodexRefreshes()).toEqual({ requests: [] })
      reading.resolve(allocation(2))
      await expect(replied).resolves.toEqual({
        id: 83,
        code: -32001,
        message: 'Dashboard credential refresh is not available'
      })
      expect(
        connection.replies.filter((reply) => reply.id === 83 && reply.result !== undefined)
      ).toEqual([])
      expect(adapter.readDashboardCodexProcesses()).toEqual({
        pending_acquisitions: 0,
        processes: []
      })
    } finally {
      reading.resolve(allocation(2))
      await adapter.closeAll()
    }
  })
})
