import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readDashboardCodexAllocation } from '../dashboard-accounts/dashboard-allocation-reader'
import {
  DashboardAllocationState,
  DashboardToolProvider
} from '../dashboard-accounts/dashboard-allocation-protocol'
import {
  adapterFor,
  acquireReadyCodexForTest,
  fakeCodex,
  identityFor
} from './codex-structured-session-adapter-fixture'

vi.mock('../dashboard-accounts/dashboard-allocation-reader', () => ({
  readDashboardCodexAllocation: vi.fn()
}))
beforeEach(() => {
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'instance-fixture')
  vi.stubEnv('ORCA_DASHBOARD_CODEX_AUTH_EXPERIMENT', '1')
  vi.mocked(readDashboardCodexAllocation).mockResolvedValue({
    provider: DashboardToolProvider.Codex,
    state: DashboardAllocationState.Available,
    account_id: 'pool-fixture',
    binding_revision: 1,
    credential_version: 2,
    access_token: 'fixture-private-access',
    chatgpt_account_id: 'workspace-fixture',
    expires_at: null
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
    const connection = codex.connections[0]!
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

describe('Codex Dashboard startup wiring', () => {
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
    expect(readDashboardCodexAllocation).not.toHaveBeenCalled()
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
    expect(await adapter.releaseAcquisition({ sessionId: 'session-1' })).toBe(true)
    expect(connection.closeCount).toBeGreaterThan(0)
  })

  it('answers a refresh request before publication instead of buffering it behind login', async () => {
    const codex = setup()
    codex.routes['account/login/start'] = () => {
      const connection = codex.connections[0]!
      connection.handlers.onServerRequest?.({
        id: 81,
        method: 'account/chatgptAuthTokens/refresh',
        params: { reason: 'unauthorized', previousAccountId: 'workspace-fixture' }
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
    expect(readDashboardCodexAllocation).not.toHaveBeenCalled()
    await adapter.closeAll()
  })
})
