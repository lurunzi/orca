import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardToolProvider } from '../../../../../shared/dashboard-account-provider'
import { AgentSessionPoolAccountOrigin } from '../../../../../shared/agent-session/lifecycle/agent-session-pool-account'
import { codexProviderHandle } from '../../../../../shared/agent-session/lifecycle/agent-session-provider-handle-encoding'
import { DashboardAllocationError } from '../../../../dashboard-accounts/dashboard-allocation-protocol'
import { openTestAgentSessionRecordStore } from '../../../../runtime/agent-session/records/agent-session-record-store-test-harness'
import { closeTestJournalHostDatabases } from '../../../agent-session-journal/store-lifecycle/journal-host-database-test-support'
import type { StructuredAgentSessionProviderChild } from '../../host/structured-agent-session-host-types'
import type { StructuredAgentSessionLogger } from '../../host/structured-agent-session-logger'
import {
  HOST_TEST_LOCATION as LOCATION,
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION
} from '../../host/testing/structured-agent-session-host-test-data'
import {
  recordStartedHandle,
  type OpenedProvider
} from '../structured-agent-session-start-provider-answer'
import { StructuredAgentSessionStartupAttempts } from '../structured-agent-session-startup-attempt'

let directory: string
let attempts: StructuredAgentSessionStartupAttempts | undefined

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'orca-pool-authentication-'))
})

afterEach(async () => {
  attempts?.dispose()
  attempts = undefined
  vi.restoreAllMocks()
  await closeTestJournalHostDatabases()
  await rm(directory, { recursive: true, force: true })
})

async function startingOwner() {
  const store = await openTestAgentSessionRecordStore(directory)
  await store.reserveOwner({
    sessionId: SESSION,
    location: LOCATION,
    provider: DashboardToolProvider.Codex,
    accountHome: { variable: 'CODEX_HOME', path: '/home/dev/.codex' },
    expectedFence: null,
    spawnToken: 'spawn-a',
    claimKeyId: 'key-1',
    handoffOperationId: null,
    probe: { outcome: 'indeterminate', reason: 'new session' },
    operation: {
      callerKey: 'client-1',
      operationId: `${NOW}-00000000000000000000000000000001`,
      fingerprint: 'fp-1'
    },
    now: NOW
  })
  const process = {
    hostId: 'local',
    pid: 4242,
    processStartTimeMs: 1_700_000_000_000,
    spawnToken: 'spawn-a'
  }
  await store.commitProcessIdentity({ sessionId: SESSION, fence: 1, process, now: NOW })
  await store.proveOwner({ sessionId: SESSION, fence: 1, now: NOW })
  const child: StructuredAgentSessionProviderChild = {
    fence: 1,
    generation: 'generation-1',
    phase: 'starting'
  }
  const startupAttempts = new StructuredAgentSessionStartupAttempts({
    expire: vi.fn(),
    now: () => NOW
  })
  attempts = startupAttempts
  startupAttempts.begin(SESSION, 'attempt-1')
  startupAttempts.published(SESSION, 'attempt-1', child)
  const logger = {
    warn: vi.fn<StructuredAgentSessionLogger['warn']>(),
    error: vi.fn<StructuredAgentSessionLogger['error']>()
  }
  const context = {
    deps: { store, logger },
    sessions: new Map([[SESSION, { child }]]),
    runtimeState: { startupAttempts },
    now: () => NOW
  }
  const event: OpenedProvider = {
    sessionId: SESSION,
    fence: 1,
    acquisitionGeneration: 'generation-1',
    link: {
      linkId: 'authenticated-link',
      handle: codexProviderHandle('authenticated-thread'),
      origin: 'created',
      mintedAtFence: 1,
      observedAt: NOW
    },
    reportedOptions: {},
    poolAuthentication: {
      identity: {
        instanceId: 'instance-1',
        provider: DashboardToolProvider.Codex,
        accountId: 'account-1',
        bindingRevision: 3,
        credentialVersion: 7
      },
      process
    }
  }
  return { store, context, event, logger, startupAttempts }
}

function expectFixedFailure(logger: Awaited<ReturnType<typeof startingOwner>>['logger']) {
  const fields = logger.warn.mock.calls.at(-1)?.[1]
  expect(fields?.error).toBeInstanceOf(DashboardAllocationError)
  expect(fields?.error).toMatchObject({ message: 'dashboard_allocation_unavailable' })
  expect(fields?.error).not.toHaveProperty('cause')
  expect(JSON.stringify(fields)).not.toContain('account-1')
}

describe('the started handle transaction owns Codex pool authentication', () => {
  it('commits the handle and authenticated identity together, survives reopen and hides the identity', async () => {
    const { store, context, event } = await startingOwner()
    expect(await recordStartedHandle(context, event)).toBe(true)
    expect(store.requireWritableRecord(SESSION).lease.provenHandleLinkId).toBe('authenticated-link')
    await closeTestJournalHostDatabases()
    const reopened = await openTestAgentSessionRecordStore(directory)
    expect(reopened.getRecord(SESSION)?.providerHandleChain).toMatchObject([
      { linkId: 'authenticated-link', handle: { nativeId: 'authenticated-thread' } }
    ])
    expect(reopened.getRecord(SESSION)?.poolAccount).toEqual({
      version: 1,
      origin: 'authenticated',
      instanceId: 'instance-1',
      provider: 'codex',
      accountId: 'account-1',
      bindingRevision: 3,
      credentialVersion: 7
    })
    expect(reopened.getConversation(SESSION)).not.toHaveProperty('poolAccount')
    expect(reopened.listConversations()).toHaveLength(1)
    expect(reopened.listConversations()[0]).not.toHaveProperty('poolAccount')
  })

  it('refuses another process without recording either its handle or identity', async () => {
    const { store, context, event, logger } = await startingOwner()
    if (!event.poolAuthentication) {
      throw new Error('expected authentication receipt')
    }
    event.poolAuthentication.process.spawnToken = 'foreign-process'
    const before = store.requireWritableRecord(SESSION)
    expect(await recordStartedHandle(context, event)).toBe(false)
    expect(store.requireWritableRecord(SESSION)).toEqual(before)
    expectFixedFailure(logger)
  })

  it.each(['replacement child', 'cancelled open', 'ended startup'])(
    'rechecks %s inside the queued handoff callback',
    async (reason) => {
      const { store, context, event, logger, startupAttempts } = await startingOwner()
      const before = store.requireWritableRecord(SESSION)
      const entered = Promise.withResolvers<void>()
      const resume = Promise.withResolvers<void>()
      const transition = store.transitionHandoff.bind(store)
      vi.spyOn(store, 'transitionHandoff').mockImplementation(async (sessionId, change) => {
        entered.resolve()
        await resume.promise
        return transition(sessionId, change)
      })
      const controller = new AbortController()
      const recording = recordStartedHandle(context, event, controller.signal)
      await entered.promise
      if (reason === 'replacement child') {
        context.sessions.set(SESSION, {
          child: { fence: 1, generation: 'generation-2', phase: 'starting' }
        })
      } else if (reason === 'cancelled open') {
        controller.abort(new Error('private cancellation reason'))
      } else {
        startupAttempts.released(SESSION, { fence: 1, generation: 'generation-1' })
      }
      resume.resolve()
      expect(await recording).toBe(false)
      expect(store.requireWritableRecord(SESSION)).toEqual(before)
      expectFixedFailure(logger)
    }
  )

  it.each([
    { instanceId: 'another-instance' },
    { accountId: 'another-account' },
    { bindingRevision: 4 },
    { credentialVersion: 8 }
  ])('refuses a receipt conflicting with an existing pool observation: %j', async (previous) => {
    const { store, context, event, logger } = await startingOwner()
    await store.transitionHandoff(SESSION, (record) => ({
      ...record,
      poolAccount: {
        version: 1,
        origin: AgentSessionPoolAccountOrigin.InheritedCopy,
        instanceId: 'instance-1',
        provider: DashboardToolProvider.Codex,
        accountId: 'account-1',
        bindingRevision: 3,
        credentialVersion: 7,
        sourceSessionId: 'source-session',
        ...previous
      }
    }))
    const before = store.requireWritableRecord(SESSION)
    expect(await recordStartedHandle(context, event)).toBe(false)
    expect(store.requireWritableRecord(SESSION)).toEqual(before)
    expectFixedFailure(logger)
  })

  it('does not accept a receipt without a link even when a handle was already proven', async () => {
    const { store, context, event, logger } = await startingOwner()
    expect(await recordStartedHandle(context, { ...event, poolAuthentication: undefined })).toBe(
      true
    )
    const before = store.requireWritableRecord(SESSION)
    expect(await recordStartedHandle(context, { ...event, link: undefined })).toBe(false)
    expect(store.requireWritableRecord(SESSION)).toEqual(before)
    expect(store.requireWritableRecord(SESSION)).not.toHaveProperty('poolAccount')
    expectFixedFailure(logger)
  })
})
