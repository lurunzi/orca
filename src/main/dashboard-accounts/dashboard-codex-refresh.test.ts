import { afterEach, expect, it, vi } from 'vitest'
import type { CodexAppServerConnection } from '../codex/app-server/codex-app-server-connection-types'
import {
  DashboardAllocationState,
  DashboardToolProvider,
  type DashboardCodexAllocation
} from './dashboard-allocation-protocol'
import { readDashboardCodexAllocation } from './dashboard-allocation-reader'
import { DashboardCodexRefresh } from './dashboard-codex-refresh'

vi.mock('./dashboard-allocation-reader', () => ({ readDashboardCodexAllocation: vi.fn() }))
const allocation: DashboardCodexAllocation = {
  provider: DashboardToolProvider.Codex,
  state: DashboardAllocationState.Available,
  account_id: 'pool-fixture',
  binding_revision: 3,
  credential_version: 4,
  access_token: 'private-old-access',
  chatgpt_account_id: 'workspace-fixture',
  expires_at: null
}
const next = { ...allocation, credential_version: 5, access_token: 'private-new-access' }
const request = (id = 1) => ({
  id,
  method: 'account/chatgptAuthTokens/refresh',
  params: { reason: 'unauthorized', previousAccountId: 'workspace-fixture' }
})
function fixture(current = () => true) {
  const connection: CodexAppServerConnection = {
    pid: 42,
    closed: false,
    request: vi.fn(),
    notify: vi.fn(),
    respond: vi.fn(),
    respondWithError: vi.fn(),
    close: vi.fn()
  }
  const failed = vi.fn()
  const refresh = new DashboardCodexRefresh(allocation, current, failed)
  refresh.activate(connection)
  return { connection, failed, refresh }
}
function deferred() {
  let resolve!: (value: DashboardCodexAllocation | null) => void
  const promise = new Promise<DashboardCodexAllocation | null>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('waits for a newer same-binding version and returns only official fields', async () => {
  vi.useFakeTimers()
  const f = fixture()
  vi.mocked(readDashboardCodexAllocation)
    .mockResolvedValueOnce(allocation)
    .mockResolvedValueOnce(next)
  expect(f.refresh.handle(f.connection, request())).toBe(true)
  await vi.advanceTimersByTimeAsync(250)
  expect(f.connection.respond).toHaveBeenCalledExactlyOnceWith(1, {
    accessToken: 'private-new-access',
    chatgptAccountId: 'workspace-fixture',
    chatgptPlanType: null
  })
  expect(f.connection.respondWithError).not.toHaveBeenCalled()
  expect(f.failed).not.toHaveBeenCalled()
  expect(JSON.stringify(f.refresh)).not.toMatch(/private-old-access|private-new-access/)
  expect(vi.getTimerCount()).toBe(0)
})

it('uses the last answered version as the next callback baseline', async () => {
  vi.useFakeTimers()
  const f = fixture()
  vi.mocked(readDashboardCodexAllocation).mockResolvedValueOnce(next)
  f.refresh.handle(f.connection, request(1))
  await vi.advanceTimersByTimeAsync(0)
  vi.mocked(readDashboardCodexAllocation)
    .mockResolvedValueOnce(next)
    .mockResolvedValueOnce({
      ...next,
      credential_version: 6,
      access_token: 'private-newest-access'
    })
  f.refresh.handle(f.connection, request(2))
  await vi.advanceTimersByTimeAsync(0)
  expect(f.connection.respond).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(250)
  expect(f.connection.respond).toHaveBeenLastCalledWith(2, {
    accessToken: 'private-newest-access',
    chatgptAccountId: 'workspace-fixture',
    chatgptPlanType: null
  })
  expect(vi.getTimerCount()).toBe(0)
})

it('times out an unfinished read and never replies with a late credential', async () => {
  vi.useFakeTimers()
  const f = fixture(),
    reading = deferred()
  vi.mocked(readDashboardCodexAllocation).mockReturnValueOnce(reading.promise)
  f.refresh.handle(f.connection, request())
  await vi.advanceTimersByTimeAsync(9000)
  expect(f.connection.respondWithError).toHaveBeenCalledExactlyOnceWith(
    1,
    -32001,
    'Dashboard credential refresh is not available'
  )
  expect(f.failed).toHaveBeenCalledOnce()
  reading.resolve(next)
  await vi.advanceTimersByTimeAsync(0)
  expect(f.connection.respond).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('rechecks ownership after an asynchronous credential read', async () => {
  vi.useFakeTimers()
  let current = true
  const f = fixture(() => current),
    reading = deferred()
  vi.mocked(readDashboardCodexAllocation).mockReturnValueOnce(reading.promise)
  f.refresh.handle(f.connection, request())
  current = false
  reading.resolve(next)
  await vi.advanceTimersByTimeAsync(0)
  expect(f.connection.respond).not.toHaveBeenCalled()
  expect(f.connection.respondWithError).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it.each([
  { account_id: 'other-account' },
  { binding_revision: 4 },
  { chatgpt_account_id: 'other-workspace' },
  { credential_version: 3 }
])('rejects a changed binding, workspace or rolled-back version %#', async (change) => {
  vi.useFakeTimers()
  const f = fixture()
  vi.mocked(readDashboardCodexAllocation).mockResolvedValueOnce({ ...next, ...change })
  f.refresh.handle(f.connection, request())
  await vi.advanceTimersByTimeAsync(0)
  expect(f.connection.respond).not.toHaveBeenCalled()
  expect(f.connection.respondWithError).toHaveBeenCalledExactlyOnceWith(
    1,
    -32001,
    'Dashboard credential refresh is not available'
  )
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects an overlapping request without replacing the original wait', async () => {
  vi.useFakeTimers()
  const f = fixture(),
    reading = deferred()
  vi.mocked(readDashboardCodexAllocation).mockReturnValueOnce(reading.promise)
  f.refresh.handle(f.connection, request(1))
  f.refresh.handle(f.connection, request(2))
  expect(f.connection.respondWithError).toHaveBeenCalledExactlyOnceWith(
    2,
    -32001,
    'Dashboard credential refresh is not available'
  )
  expect(f.failed).not.toHaveBeenCalled()
  reading.resolve(next)
  await vi.advanceTimersByTimeAsync(0)
  expect(f.connection.respond).toHaveBeenCalledExactlyOnceWith(1, {
    accessToken: 'private-new-access',
    chatgptAccountId: 'workspace-fixture',
    chatgptPlanType: null
  })
  expect(vi.getTimerCount()).toBe(0)
})

it('does not enable credential replies before pinned-version authentication', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const refresh = new DashboardCodexRefresh(allocation, () => true, f.failed)
  refresh.handle(f.connection, request())
  await vi.advanceTimersByTimeAsync(0)
  expect(readDashboardCodexAllocation).not.toHaveBeenCalled()
  expect(f.connection.respond).not.toHaveBeenCalled()
  expect(f.connection.respondWithError).toHaveBeenCalledOnce()
})
