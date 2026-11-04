import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodexAppServerConnection } from '../codex/app-server/codex-app-server-connection-types'
import {
  DashboardAllocationState,
  DashboardToolProvider,
  type DashboardCodexAllocation
} from './dashboard-allocation-protocol'
import { readDashboardCodexAllocation } from './dashboard-allocation-reader'
import { DashboardCodexRefreshMailbox } from './dashboard-codex-refresh-mailbox'
import {
  DashboardCodexAuthentication,
  dashboardCodexChildLaunch,
  prepareDashboardCodexAuthentication
} from './dashboard-codex-authentication'

const scope = {
  session_id: 'session-fixture',
  fence: 7,
  acquisition_generation: 'generation-1',
  process: {
    hostId: 'host-fixture',
    pid: 42,
    processStartTimeMs: 1234.5,
    spawnToken: 'spawn-fixture'
  }
}
vi.mock('./dashboard-allocation-reader', () => ({ readDashboardCodexAllocation: vi.fn() }))
const allocation: DashboardCodexAllocation = {
  provider: DashboardToolProvider.Codex,
  state: DashboardAllocationState.Available,
  account_id: 'pool-fixture',
  binding_revision: 3,
  credential_version: 4,
  access_token: 'fixture-private-access',
  chatgpt_account_id: 'workspace-fixture',
  expires_at: null
}
const readyAccount = () => ({
  account: { type: 'chatgpt', email: null, planType: 'unknown' },
  requiresOpenaiAuth: true,
  workspaceRouting: { chatgptAccountId: 'workspace-fixture', backendOrigin: 'https://chatgpt.com' }
})
function connected(auth: DashboardCodexAuthentication) {
  const connection: CodexAppServerConnection = {
    pid: 42,
    closed: false,
    notify: vi.fn(),
    respond: vi.fn(),
    respondWithError: vi.fn(),
    close: vi.fn(async () => true),
    request: vi.fn(async (method) => {
      if (method === 'account/login/start') {
        auth.handleNotification('account/login/completed', {
          loginId: null,
          success: true,
          error: null
        })
        auth.handleNotification('account/updated', {
          authMode: 'chatgptAuthTokens',
          planType: 'unknown'
        })
        return { type: 'chatgptAuthTokens' }
      }
      return readyAccount()
    })
  }
  return connection
}
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('Dashboard Codex external authentication', () => {
  it('keeps local mode unchanged and requires an explicit pool experiment before reading credentials', async () => {
    vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', undefined)
    expect(
      await prepareDashboardCodexAuthentication(() => true, new DashboardCodexRefreshMailbox())
    ).toBeNull()
    expect(readDashboardCodexAllocation).not.toHaveBeenCalled()
    vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'instance-fixture')
    vi.stubEnv('ORCA_DASHBOARD_CODEX_AUTH_EXPERIMENT', 'true')
    await expect(
      prepareDashboardCodexAuthentication(() => true, new DashboardCodexRefreshMailbox())
    ).rejects.toMatchObject({
      message: 'dashboard_allocation_unavailable'
    })
    expect(readDashboardCodexAllocation).not.toHaveBeenCalled()
    vi.stubEnv('ORCA_DASHBOARD_CODEX_AUTH_EXPERIMENT', '1')
    vi.mocked(readDashboardCodexAllocation).mockResolvedValueOnce(allocation)
    expect(
      await prepareDashboardCodexAuthentication(() => true, new DashboardCodexRefreshMailbox())
    ).toBeInstanceOf(DashboardCodexAuthentication)
    vi.mocked(readDashboardCodexAllocation).mockResolvedValueOnce(null)
    await expect(
      prepareDashboardCodexAuthentication(() => true, new DashboardCodexRefreshMailbox())
    ).rejects.toMatchObject({
      message: 'dashboard_allocation_unavailable'
    })
  })

  it('removes conflicting explicit and inherited auth without dropping proxy, directory or arguments', () => {
    const launch = {
      command: 'codex',
      args: ['app-server'],
      cwd: '/work',
      env: {
        OPENAI_API_KEY: 'private-key',
        CODEX_API_KEY: 'other-key',
        OPENAI_BASE_URL: 'https://custom.invalid',
        CODEX_HOME: '/home/fixture',
        HTTPS_PROXY: 'http://proxy.invalid',
        KEEP: 'value'
      },
      envToDelete: ['OLD']
    }
    const result = dashboardCodexChildLaunch(launch)
    expect(result).toMatchObject({
      command: 'codex',
      args: ['app-server'],
      cwd: '/work',
      env: { CODEX_HOME: '/home/fixture', HTTPS_PROXY: 'http://proxy.invalid', KEEP: 'value' }
    })
    expect(result.envToDelete).toEqual([
      'OLD',
      'OPENAI_API_KEY',
      'CODEX_API_KEY',
      'OPENAI_BASE_URL'
    ])
    expect(result.env).not.toHaveProperty('OPENAI_API_KEY')
    expect(result.env).not.toHaveProperty('CODEX_API_KEY')
    expect(result.env).not.toHaveProperty('OPENAI_BASE_URL')
    expect(launch.env.OPENAI_API_KEY).toBe('private-key')
  })

  it('waits for external login proof and checks the allocated workspace before succeeding', async () => {
    const auth = new DashboardCodexAuthentication(
      allocation,
      () => true,
      new DashboardCodexRefreshMailbox()
    )
    const connection = connected(auth)
    const adopted = await auth.authenticate(connection, '0.166.0', scope)
    expect(adopted).toEqual({
      account_id: 'pool-fixture',
      binding_revision: 3,
      credential_version: 4
    })
    expect(JSON.stringify(adopted)).not.toMatch(
      /fixture-private-access|workspace-fixture|access_token|chatgpt_account_id/
    )
    await expect(auth.authenticate(connection, '0.166.0', scope)).rejects.toThrow(
      'dashboard_allocation_unavailable'
    )
    expect(connection.request).toHaveBeenCalledTimes(2)
    expect(connection.request).toHaveBeenNthCalledWith(
      1,
      'account/login/start',
      {
        type: 'chatgptAuthTokens',
        accessToken: 'fixture-private-access',
        chatgptAccountId: 'workspace-fixture',
        chatgptPlanType: null
      },
      { timeoutMs: 20000 }
    )
    expect(connection.request).toHaveBeenNthCalledWith(
      2,
      'account/read',
      { refreshToken: false },
      { timeoutMs: 20000 }
    )
    expect(auth.handleNotification('account/updated', { authMode: 'chatgptAuthTokens' })).toBe(
      false
    )
  })

  it('refuses an unpinned or unknown server version before injecting credentials', async () => {
    for (const version of ['0.166.1', null]) {
      const auth = new DashboardCodexAuthentication(
        allocation,
        () => true,
        new DashboardCodexRefreshMailbox()
      )
      const connection = connected(auth)
      await expect(auth.authenticate(connection, version, scope)).rejects.toMatchObject({
        message: 'dashboard_allocation_unavailable'
      })
      expect(connection.request).not.toHaveBeenCalled()
    }
  })

  it('rejects a login completion failure even when the login RPC succeeds', async () => {
    const auth = new DashboardCodexAuthentication(
      allocation,
      () => true,
      new DashboardCodexRefreshMailbox()
    )
    const connection = connected(auth)
    vi.mocked(connection.request).mockImplementationOnce(async () => {
      auth.handleNotification('account/login/completed', {
        loginId: null,
        success: false,
        error: 'fixture-private-access'
      })
      return { type: 'chatgptAuthTokens' }
    })
    await expect(auth.authenticate(connection, '0.166.0', scope)).rejects.toMatchObject({
      message: 'dashboard_allocation_unavailable'
    })
    expect(connection.request).toHaveBeenCalledTimes(1)
  })

  it('rejects missing external-mode evidence and bounds the notification wait', async () => {
    const auth = new DashboardCodexAuthentication(
      allocation,
      () => true,
      new DashboardCodexRefreshMailbox()
    )
    const connection = connected(auth)
    const deadline = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    vi.mocked(connection.request).mockImplementationOnce(async () => {
      auth.handleNotification('account/login/completed', {
        loginId: null,
        success: true,
        error: null
      })
      return { type: 'chatgptAuthTokens' }
    })
    const attempt = auth.authenticate(connection, '0.166.0', scope)
    const rejected = expect(attempt).rejects.toMatchObject({
      message: 'dashboard_allocation_unavailable'
    })
    deadline.abort()
    await rejected
    expect(connection.request).toHaveBeenCalledTimes(1)
  })

  it('rejects a different workspace and hides official RPC errors', async () => {
    const auth = new DashboardCodexAuthentication(
      allocation,
      () => true,
      new DashboardCodexRefreshMailbox()
    )
    const connection = connected(auth)
    vi.mocked(connection.request).mockResolvedValueOnce({ type: 'chatgptAuthTokens' })
    const failed = auth.authenticate(connection, '0.166.0', scope)
    auth.handleNotification('account/login/completed', {
      loginId: null,
      success: true,
      error: null
    })
    auth.handleNotification('account/updated', { authMode: 'chatgptAuthTokens' })
    vi.mocked(connection.request).mockResolvedValueOnce({
      ...readyAccount(),
      workspaceRouting: { chatgptAccountId: 'other' }
    })
    await expect(failed).rejects.toMatchObject({ message: 'dashboard_allocation_unavailable' })
    const next = new DashboardCodexAuthentication(
      allocation,
      () => true,
      new DashboardCodexRefreshMailbox()
    )
    vi.mocked(connection.request).mockRejectedValueOnce(new Error('secret fixture-private-access'))
    await expect(next.authenticate(connection, '0.166.0', scope)).rejects.toMatchObject({
      message: 'dashboard_allocation_unavailable'
    })
  })

  it('rejects a refresh for another workspace while login is pending', async () => {
    const auth = new DashboardCodexAuthentication(
      allocation,
      () => true,
      new DashboardCodexRefreshMailbox()
    )
    const connection = connected(auth)
    vi.mocked(connection.request).mockImplementationOnce(async () => {
      expect(
        auth.handleRefresh(connection, {
          id: 91,
          method: 'account/chatgptAuthTokens/refresh',
          params: { reason: 'unauthorized', previousAccountId: 'other-workspace' }
        })
      ).toBe(true)
      return { type: 'chatgptAuthTokens' }
    })
    await expect(auth.authenticate(connection, '0.166.0', scope)).rejects.toMatchObject({
      message: 'dashboard_allocation_unavailable'
    })
    expect(connection.respondWithError).toHaveBeenCalledWith(
      91,
      -32001,
      'Dashboard credential refresh is not available'
    )
    expect(connection.request).toHaveBeenCalledTimes(1)
    expect(auth.handleRefresh(connection, { id: 92, method: 'other', params: {} })).toBe(false)
  })
})
