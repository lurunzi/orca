import { afterEach, expect, it, vi } from 'vitest'
import type { CodexAppServerConnection } from '../codex/app-server/codex-app-server-connection-types'
import type { DashboardCodexLifecycleOptions } from './dashboard-codex-rpc'
import {
  DashboardAllocationState,
  DashboardToolProvider,
  type DashboardCodexAllocation
} from './dashboard-allocation-protocol'
import { readDashboardCodexAllocation } from './dashboard-allocation-reader'
import { DashboardCodexRefresh } from './dashboard-codex-refresh'
import { DashboardCodexRefreshMailbox } from './dashboard-codex-refresh-mailbox'
import {
  DashboardCodexRefreshOperation,
  DashboardCodexRefreshSource,
  type DashboardCodexRefreshScope
} from './dashboard-codex-refresh-protocol'

const scope: DashboardCodexRefreshScope = {
  source: DashboardCodexRefreshSource.Session,
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
function fixture(current = () => true, options: DashboardCodexLifecycleOptions = {}) {
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
  const mailbox = new DashboardCodexRefreshMailbox()
  const refresh = new DashboardCodexRefresh(allocation, current, failed, mailbox, options)
  refresh.activate(connection, scope)
  return { connection, failed, refresh, mailbox }
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
  expect(f.mailbox.read().requests).toMatchObject([{ ...scope, credential_version: 4 }])
  await vi.advanceTimersByTimeAsync(250)
  expect(f.mailbox.read()).toEqual({ requests: [] })
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

it('captures the original scope before callers can change it', async () => {
  vi.useFakeTimers()
  const f = fixture(),
    reading = deferred()
  const captured = { ...scope, process: { ...scope.process } }
  f.refresh.activate(f.connection, captured)
  captured.session_id = 'modified-session'
  captured.process.pid = 999
  vi.mocked(readDashboardCodexAllocation).mockReturnValueOnce(reading.promise)
  f.refresh.handle(f.connection, request())
  expect(f.mailbox.read().requests).toMatchObject([{ ...scope, credential_version: 4 }])
  reading.resolve(next)
  await vi.advanceTimersByTimeAsync(0)
  expect(f.mailbox.read()).toEqual({ requests: [] })
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
  expect(f.mailbox.read().requests).toMatchObject([{ credential_version: 5 }])
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
  expect(f.mailbox.read()).toEqual({ requests: [] })
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

it('cancels a short-lived refresh during a file read without any late reply', async () => {
  const cancel = new AbortController()
  const f = fixture(() => true, { signal: cancel.signal })
  f.refresh.activate(f.connection, {
    source: DashboardCodexRefreshSource.ShortLivedOperation,
    operation_id: 'operation-fixture',
    operation: DashboardCodexRefreshOperation.ReadAccountUsage,
    source_session_id: 'session-fixture',
    process: scope.process
  })
  const reading = deferred()
  vi.mocked(readDashboardCodexAllocation).mockReturnValueOnce(reading.promise)
  f.refresh.handle(f.connection, request())
  expect(f.mailbox.read().requests).toMatchObject([
    {
      source: 'short_lived_operation',
      operation_id: 'operation-fixture',
      operation: 'read_account_usage',
      source_session_id: 'session-fixture'
    }
  ])
  cancel.abort(new Error('private-new-access'))
  expect(f.mailbox.read()).toEqual({ requests: [] })
  f.refresh.dispose()
  reading.resolve(next)
  await reading.promise
  expect(f.connection.respond).not.toHaveBeenCalled()
  expect(f.connection.respondWithError).not.toHaveBeenCalled()
})

it('does not enable credential replies before pinned-version authentication', async () => {
  vi.useFakeTimers()
  const f = fixture()
  const refresh = new DashboardCodexRefresh(allocation, () => true, f.failed, f.mailbox)
  refresh.handle(f.connection, request())
  await vi.advanceTimersByTimeAsync(0)
  expect(readDashboardCodexAllocation).not.toHaveBeenCalled()
  expect(f.connection.respond).not.toHaveBeenCalled()
  expect(f.connection.respondWithError).toHaveBeenCalledOnce()
})
