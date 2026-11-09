import { afterEach, expect, it, vi } from 'vitest'
import { readDashboardCodexAllocationContext } from './dashboard-allocation-reader'
import { DashboardToolProvider } from './dashboard-allocation-protocol'

const { readFile, close } = vi.hoisted(() => ({
  readFile: vi.fn<() => Promise<Buffer>>(),
  close: vi.fn(async () => {})
}))
vi.mock('node:fs/promises', () => ({
  lstat: vi.fn(async () => ({
    uid: 0,
    gid: 1000,
    mode: 0o750,
    isDirectory: () => true,
    isSymbolicLink: () => false
  })),
  open: vi.fn(async () => ({
    stat: async () => ({ uid: 0, gid: 1000, mode: 0o640, size: 4096, isFile: () => true }),
    readFile,
    close
  }))
}))
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

it('returns the instance and binding from the same verified snapshot even if the environment changes during the read', async () => {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'instance-fixture')
  readFile.mockImplementationOnce(async () => {
    vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'replacement-instance')
    return Buffer.from(
      JSON.stringify({
        schema_version: 1,
        instance_id: 'instance-fixture',
        bindings: [
          {
            provider: 'codex',
            state: 'available',
            account_id: 'pool-fixture',
            binding_revision: 2,
            credential_version: 3,
            access_token: 'private-fixture-token',
            chatgpt_account_id: 'workspace-fixture',
            expires_at: null
          },
          {
            provider: 'claude_code',
            state: 'unassigned',
            account_id: null,
            binding_revision: 0,
            credential_version: 0
          }
        ]
      })
    )
  })
  await expect(readDashboardCodexAllocationContext()).resolves.toEqual({
    instanceId: 'instance-fixture',
    allocation: {
      provider: DashboardToolProvider.Codex,
      state: 'available',
      account_id: 'pool-fixture',
      binding_revision: 2,
      credential_version: 3,
      access_token: 'private-fixture-token',
      chatgpt_account_id: 'workspace-fixture',
      expires_at: null
    }
  })
  expect(close).toHaveBeenCalled()
})
