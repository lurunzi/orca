import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readDashboardCodexAllocationContext } from './dashboard-allocation-reader'
import {
  DashboardAllocationPendingError,
  DashboardToolProvider
} from './dashboard-allocation-protocol'

const { readFile, close, stat } = vi.hoisted(() => ({
  readFile: vi.fn<() => Promise<Buffer>>(),
  close: vi.fn(async () => {}),
  stat: vi.fn(async () => ({ uid: 0, gid: 1000, mode: 0o640, size: 4096, isFile: () => true }))
}))
const { open } = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('node:fs/promises', () => ({
  lstat: vi.fn(async () => ({
    uid: 0,
    gid: 1000,
    mode: 0o750,
    isDirectory: () => true,
    isSymbolicLink: () => false
  })),
  open
}))
const snapshot = {
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
}
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
beforeEach(() => {
  open.mockImplementation(async () => ({ stat, readFile, close }))
})
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
    return Buffer.from(JSON.stringify(snapshot))
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

it('rejects a valid allocation when its file is group-writable', async () => {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'instance-fixture')
  stat.mockResolvedValueOnce({ uid: 0, gid: 1000, mode: 0o664, size: 4096, isFile: () => true })
  readFile.mockResolvedValue(Buffer.from(JSON.stringify(snapshot)))
  await expect(readDashboardCodexAllocationContext()).rejects.toMatchObject({
    code: 'dashboard_allocation_unavailable'
  })
})

it('reports a missing file and a pending refresh as pending, and an unassigned binding as final', async () => {
  Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' })
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'instance-fixture')
  open.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  await expect(readDashboardCodexAllocationContext()).rejects.toBeInstanceOf(
    DashboardAllocationPendingError
  )
  const [codex, claude] = snapshot.bindings
  const pending = {
    ...snapshot,
    bindings: [
      {
        provider: 'codex',
        state: 'unavailable',
        account_id: codex.account_id,
        binding_revision: codex.binding_revision,
        credential_version: codex.credential_version,
        reason: 'refresh_pending'
      },
      claude
    ]
  }
  readFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(pending)))
  await expect(readDashboardCodexAllocationContext()).rejects.toBeInstanceOf(
    DashboardAllocationPendingError
  )
  const unassigned = { ...snapshot, bindings: [{ ...claude, provider: 'codex' }, claude] }
  readFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(unassigned)))
  const rejection = await readDashboardCodexAllocationContext().catch((error: unknown) => error)
  expect(rejection).toMatchObject({ code: 'dashboard_allocation_unavailable' })
  expect(rejection).not.toBeInstanceOf(DashboardAllocationPendingError)
})
