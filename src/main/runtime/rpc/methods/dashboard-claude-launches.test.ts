import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'
import { DASHBOARD_ACCOUNT_METHODS } from './dashboard-accounts'
import { getStructuredAgentSessionHost } from '../../../native-chat/agent-session-wire/structured-agent-session-registry'

vi.mock('../../../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: vi.fn()
}))
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})
const method = DASHBOARD_ACCOUNT_METHODS[3]
function context(): RpcContext {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler reads only transport identity and Runtime id.
  return { caller: { kind: 'local-cli' }, runtime: { getRuntimeId: () => 'r1' } } as RpcContext
}
function installed(read: (() => unknown) | undefined) {
  const registration = vi.fn(() => ({ adapter: { readDashboardClaudeLaunches: read } }))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this fixture implements the only registry lookup used by the handler.
  vi.mocked(getStructuredAgentSessionHost).mockReturnValue({
    deps: { agents: { registration } }
  } as never)
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'i1')
  return registration
}
function processLaunch() {
  return {
    session_id: 's1',
    fence: 7,
    acquisition_generation: 'g1',
    process: { hostId: 'h1', pid: 42, processStartTimeMs: null, spawnToken: 'spawn-1' },
    account_id: 'a1',
    binding_revision: 2,
    credential_version: 3,
    initialized: false,
    connection_open: true,
    closing: false
  }
}
const common = { schema_version: 1, instance_id: 'i1', runtime_id: 'r1' }

describe.skipIf(process.platform !== 'linux')('Claude local startup report RPC', () => {
  it('distinguishes an absent host, absent capability and supported empty report', async () => {
    vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'i1')
    vi.mocked(getStructuredAgentSessionHost).mockReturnValue(null)
    await expect(method.handler({}, context())).resolves.toEqual({ ...common, supported: false })
    installed(undefined)
    await expect(method.handler({}, context())).resolves.toEqual({ ...common, supported: false })
    const read = vi.fn(() => ({ pending_acquisitions: 0, processes: [] }))
    const registration = installed(read)
    await expect(method.handler({}, context())).resolves.toEqual({
      ...common,
      supported: true,
      pending_acquisitions: 0,
      processes: []
    })
    expect(registration).toHaveBeenCalledExactlyOnceWith('claude')
    expect(read).toHaveBeenCalledOnce()
    expect(method.name).toBe('dashboard.accounts.claudeLaunches')
    expect(method.permission).toBe('accounts-admin')
    expect(method.params.safeParse({ path: '/private' }).success).toBe(false)
  })

  it.each([false, true])(
    'returns current launch and original identity (initialized=%s)',
    async (initialized) => {
      const process = { ...processLaunch(), initialized }
      const read = vi.fn(() => ({ pending_acquisitions: 1, processes: [process] }))
      installed(read)
      await expect(method.handler({}, context())).resolves.toEqual({
        ...common,
        supported: true,
        pending_acquisitions: 1,
        processes: [process]
      })
      expect(read).toHaveBeenCalledOnce()
    }
  )

  it.each([
    { pending_acquisitions: 0, processes: [], access_token: 'private' },
    { pending_acquisitions: 0, processes: [{ ...processLaunch(), access_token: 'private' }] },
    {
      pending_acquisitions: 0,
      processes: [
        { ...processLaunch(), process: { ...processLaunch().process, credential: 'private' } }
      ]
    },
    { pending_acquisitions: 0, processes: [{ ...processLaunch(), initialized: undefined }] }
  ])('rejects credentials and incomplete startup state %#', async (state) => {
    installed(() => state)
    await expect(method.handler({}, context())).rejects.toThrow('dashboard_allocation_unavailable')
  })

  it('scrubs adapter exceptions and refuses queries outside pool mode', async () => {
    installed(() => {
      throw new Error('private credential and path')
    })
    await expect(method.handler({}, context())).rejects.toThrow('dashboard_allocation_unavailable')
    vi.mocked(getStructuredAgentSessionHost).mockClear()
    vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', undefined)
    await expect(method.handler({}, context())).rejects.toThrow('dashboard_allocation_unavailable')
    expect(getStructuredAgentSessionHost).not.toHaveBeenCalled()
  })
})
