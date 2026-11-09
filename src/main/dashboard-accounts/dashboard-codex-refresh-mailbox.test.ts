import { afterEach, expect, it, vi } from 'vitest'
import { DashboardToolProvider } from './dashboard-allocation-protocol'
import { DashboardCodexRefreshMailbox } from './dashboard-codex-refresh-mailbox'
import {
  DashboardCodexRefreshesResponseSchema,
  DashboardCodexRefreshSource,
  DashboardCodexRefreshOperation,
  type DashboardCodexRefreshScope
} from './dashboard-codex-refresh-protocol'

const scope = () =>
  ({
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
  }) satisfies DashboardCodexRefreshScope
const binding = () => ({ account_id: 'pool-fixture', binding_revision: 3, credential_version: 4 })
afterEach(() => {
  vi.useRealTimers()
})

it('copies metadata on registration and every read and removes a completed request', () => {
  const mailbox = new DashboardCodexRefreshMailbox()
  const capturedScope = scope(),
    capturedBinding = binding()
  const deadline = Date.now() + 9000
  const unregister = mailbox.register(capturedScope, capturedBinding, deadline, () => true)
  capturedScope.session_id = 'modified-session'
  capturedScope.process.spawnToken = 'modified-spawn'
  capturedBinding.credential_version = 99
  const first = mailbox.read().requests[0]!
  expect(first).toEqual({
    ...scope(),
    ...binding(),
    provider: DashboardToolProvider.Codex,
    request_id: expect.any(String),
    deadline_at: deadline
  })
  expect(first.request_id).toMatch(/^[a-f0-9-]{36}$/)
  first.account_id = 'modified-account'
  first.process.pid = 999
  expect(mailbox.read().requests[0]).toEqual({
    ...scope(),
    ...binding(),
    provider: DashboardToolProvider.Codex,
    request_id: first.request_id,
    deadline_at: deadline
  })
  unregister()
  unregister()
  expect(mailbox.read()).toEqual({ requests: [] })
})

it('retains an operation identity without borrowing a session lease or accepting mixed source fields', () => {
  const mailbox = new DashboardCodexRefreshMailbox()
  const operation = {
    source: DashboardCodexRefreshSource.ShortLivedOperation,
    operation_id: 'operation-1',
    operation: DashboardCodexRefreshOperation.ReadAccountUsage,
    source_session_id: 'session-fixture',
    process: {
      hostId: 'host-fixture',
      pid: 84,
      processStartTimeMs: 2000,
      spawnToken: 'operation-spawn'
    }
  } satisfies DashboardCodexRefreshScope
  const deadline = Date.now() + 9000
  mailbox.register(operation, binding(), deadline, () => true)
  operation.operation_id = 'replacement-operation'
  operation.process.pid = 999
  const observed = mailbox.read().requests[0]!
  expect(observed).toEqual({
    source: DashboardCodexRefreshSource.ShortLivedOperation,
    operation_id: 'operation-1',
    operation: DashboardCodexRefreshOperation.ReadAccountUsage,
    source_session_id: 'session-fixture',
    process: {
      hostId: 'host-fixture',
      pid: 84,
      processStartTimeMs: 2000,
      spawnToken: 'operation-spawn'
    },
    account_id: 'pool-fixture',
    binding_revision: 3,
    credential_version: 4,
    provider: DashboardToolProvider.Codex,
    request_id: expect.any(String),
    deadline_at: deadline
  })
  expect(
    DashboardCodexRefreshesResponseSchema.safeParse({
      schema_version: 2,
      instance_id: 'instance-fixture',
      runtime_id: 'runtime-fixture',
      supported: true,
      requests: [{ ...observed, fence: 7 }]
    }).success
  ).toBe(false)
})

it('removes expired or no-longer-owned requests without retaining a second process record', () => {
  vi.useFakeTimers()
  const mailbox = new DashboardCodexRefreshMailbox()
  let current = true
  mailbox.register(scope(), binding(), Date.now() + 250, () => true)
  mailbox.register(scope(), binding(), Date.now() + 9000, () => current)
  expect(mailbox.read().requests).toHaveLength(2)
  current = false
  expect(mailbox.read().requests).toHaveLength(1)
  vi.advanceTimersByTime(250)
  expect(mailbox.read()).toEqual({ requests: [] })
  current = true
  expect(mailbox.read()).toEqual({ requests: [] })
})

it('keeps unsupported responses distinct and rejects private fields and unsafe deadlines', () => {
  const common = {
    schema_version: 2,
    instance_id: 'instance-fixture',
    runtime_id: 'runtime-fixture'
  }
  const mailbox = new DashboardCodexRefreshMailbox()
  mailbox.register(scope(), binding(), Date.now() + 9000, () => true)
  const supported = { ...common, supported: true, ...mailbox.read() }
  expect(DashboardCodexRefreshesResponseSchema.safeParse(supported).success).toBe(true)
  expect(
    DashboardCodexRefreshesResponseSchema.safeParse({ ...common, supported: false }).success
  ).toBe(true)
  expect(
    DashboardCodexRefreshesResponseSchema.safeParse({ ...common, supported: false, requests: [] })
      .success
  ).toBe(false)
  const request = supported.requests[0]!
  for (const change of [
    { access_token: 'private' },
    { chatgpt_account_id: 'private-workspace' },
    { deadline_at: Number.MAX_SAFE_INTEGER + 1 }
  ]) {
    expect(
      DashboardCodexRefreshesResponseSchema.safeParse({
        ...supported,
        requests: [{ ...request, ...change }]
      }).success
    ).toBe(false)
  }
})
