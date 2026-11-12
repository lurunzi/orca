import { access, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import type * as FileSystem from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { agentSessionRecordFixture } from '../../../native-chat/agent-session-record-test-fixture'
import { resolveHiddenProbeCwd } from '../../../lib/hidden-probe-cwd'
import { readDashboardCodexAllocationContext } from '../../../dashboard-accounts/dashboard-allocation-reader'
import {
  DashboardAllocationState,
  DashboardToolProvider
} from '../../../dashboard-accounts/dashboard-allocation-protocol'
import { codexPoolProviderProbeCwd } from './codex-pool-provider-invocation'
import {
  acquireReadyCodexForTest,
  adapterFor,
  fakeCodex,
  identityFor,
  THREAD_ID
} from './codex-structured-session-adapter-fixture'

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof FileSystem>()),
  stat: vi.fn()
}))
vi.mock('../../../lib/hidden-probe-cwd', () => ({ resolveHiddenProbeCwd: vi.fn() }))
vi.mock('../../../dashboard-accounts/dashboard-allocation-reader', () => ({
  readDashboardCodexAllocationContext: vi.fn()
}))

let home: string
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'orca-pool-maintenance-'))
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
      access_token: 'fixture-access',
      chatgpt_account_id: 'workspace-fixture',
      expires_at: null
    }
  })
})
afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.resetAllMocks()
  await rm(home, { recursive: true, force: true })
})

function record() {
  return agentSessionRecordFixture({
    sessionId: 'session-1',
    provider: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: home }
  })
}

it('does not create a hidden probe directory when cancelled during the directory check', async () => {
  const hidden = join(home, 'hidden-probe')
  vi.mocked(resolveHiddenProbeCwd).mockImplementation(async () => {
    await mkdir(hidden)
    return hidden
  })
  const entered = Promise.withResolvers<void>()
  const reading = Promise.withResolvers<never>()
  vi.mocked(stat).mockImplementation(async () => {
    entered.resolve()
    return reading.promise
  })
  const cancel = new AbortController()
  const cancelled = new Error('fixture-cancelled')
  const probing = codexPoolProviderProbeCwd(
    record(),
    {
      resolveCommand: () => ({ command: 'unused', prefixArgs: [] }),
      resolveEnvironment: async () => ({}),
      resolveLaunchArgs: () => [],
      resolveWorkspacePath: async () => home
    },
    cancel.signal
  )
  const rejected = expect(probing).rejects.toBe(cancelled)
  await entered.promise
  cancel.abort(cancelled)
  reading.reject(Object.assign(new Error('fixture-missing-directory'), { code: 'ENOENT' }))
  await rejected
  await expect(access(hidden)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('does not rename after cancellation while keeping the shared connection usable', async () => {
  const cancel = new AbortController()
  const appliedNames: unknown[] = []
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
  codex.routes['thread/name/set'] = (params) => {
    if (!cancel.signal.aborted) {
      cancel.abort(new Error('fixture-cancelled'))
      throw new Error('rollout at fixture-provider-path is empty')
    }
    appliedNames.push(params?.name)
    return {}
  }
  const adapter = adapterFor(codex)
  try {
    await acquireReadyCodexForTest(adapter, {
      identity: identityFor('session-1'),
      fence: 7,
      spawnToken: 'fixture-spawn'
    })
    vi.useFakeTimers()
    await expect(
      adapter.renameProviderSession({
        record: record(),
        providerSessionId: THREAD_ID,
        name: 'Cancelled rename',
        signal: cancel.signal
      })
    ).rejects.toMatchObject({ message: 'dashboard_allocation_unavailable' })
    await vi.runAllTimersAsync()
    expect(appliedNames).toEqual([])
    await expect(codex.connections.at(-1)!.request('fixture/connection-live')).resolves.toEqual({})
  } finally {
    vi.useRealTimers()
    await adapter.closeAll()
  }
})
