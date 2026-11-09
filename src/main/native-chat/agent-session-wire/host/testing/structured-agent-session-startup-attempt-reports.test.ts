import { describe, expect, it } from 'vitest'
import { DashboardToolProvider } from '../../../../../shared/dashboard-account-provider'
import { AgentSessionPoolAccountOrigin } from '../../../../../shared/agent-session/lifecycle/agent-session-pool-account'
import { mintStructuredAgentSessionStartupAttempt } from '../../startup/structured-agent-session-startup-attempt-mint'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION
} from './structured-agent-session-host-test-data'
import {
  acquire,
  dispatch,
  eventually,
  heldBehindStart,
  host,
  proveOpen,
  publishFirst,
  restartWith,
  store,
  submission,
  registerStartupAttemptHostTests
} from './structured-agent-session-startup-attempt-host-test-support'

registerStartupAttemptHostTests()

it.each([false, true])(
  'keeps current-generation reports across readiness (replaced=%s)',
  async (replaced) => {
    await store.replaceSessionOptions({
      sessionId: SESSION,
      fence: store.getRecord(SESSION)!.lease.runtimeFence,
      permissionMode: 'own',
      now: NOW
    })
    await restartWith(publishFirst)
    const id = await heldBehindStart('hello')
    const fence = store.getRecord(SESSION)!.lease.runtimeFence
    const acquisitionGeneration = `generation-${acquire.mock.calls.length}`
    const report = (
      reportedOptions: { reportedPermissionMode?: string | null },
      generation = acquisitionGeneration,
      reportFence = fence
    ) =>
      host.handleAdapterEvent({
        type: 'options-reported',
        sessionId: SESSION,
        fence: reportFence,
        acquisitionGeneration: generation,
        reportedOptions
      })
    const early = report({ reportedPermissionMode: 'accept-edits' })
    expect(host.readStatusSummary(SESSION)?.runtimePermission).toBeNull()
    if (replaced) {
      await host.close(SESSION, 'evict')
      await early
      await proveOpen()
      await host.flushStreamedEvents(SESSION)
      expect(host.readStatusSummary(SESSION)?.runtimePermission).toBeNull()
      return
    }
    await proveOpen()
    await early
    await eventually(async () => expect((await submission(id))?.dispatchState).toBe('accepted'))
    const current = () => host.readStatusSummary(SESSION)?.runtimePermission
    expect(current()).toEqual({ fence, mode: 'accept-edits' })
    await report({ reportedPermissionMode: 'full-access' }, 'foreign')
    await report({ reportedPermissionMode: 'full-access' }, acquisitionGeneration, fence + 1)
    await report({})
    expect(current()).toEqual({ fence, mode: 'accept-edits' })
    await report({ reportedPermissionMode: null })
    expect(current()).toEqual({ fence, mode: null })
    expect(store.getRecord(SESSION)?.permissionMode).toBe('own')
    expect(dispatch).toHaveBeenCalledTimes(1)
    await host.close(SESSION, 'evict')
    expect(current()).toBeNull()
  }
)

it('carries a persisted inherited pool identity into acquisition as an independent snapshot', async () => {
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
      sourceSessionId: 'source-session'
    }
  }))
  await restartWith(publishFirst)
  const id = await heldBehindStart('hello')
  const input = acquire.mock.calls.at(-1)![0]
  const stored = store.requireWritableRecord(SESSION)
  expect(input.launch?.poolAccount).toEqual({
    version: 1,
    origin: 'inherited_copy',
    instanceId: 'instance-1',
    provider: 'codex',
    accountId: 'account-1',
    bindingRevision: 3,
    credentialVersion: 7,
    sourceSessionId: 'source-session'
  })
  expect(input.launch?.poolAccount).not.toBe(stored.poolAccount)

  const source = structuredClone(stored)
  const attempt = mintStructuredAgentSessionStartupAttempt({
    record: source,
    identity: input.identity,
    spawnToken: input.spawnToken
  })
  if (source.poolAccount?.origin !== AgentSessionPoolAccountOrigin.InheritedCopy) {
    throw new Error('expected persisted inherited identity')
  }
  source.poolAccount.accountId = 'account-2'
  source.poolAccount.bindingRevision = 4
  source.poolAccount.credentialVersion = 8
  source.poolAccount.sourceSessionId = 'another-source'
  await store.transitionHandoff(SESSION, (record) => ({
    ...record,
    poolAccount: source.poolAccount
  }))
  for (const launch of [input.launch, attempt.launch]) {
    expect(launch?.poolAccount).toEqual({
      version: 1,
      origin: 'inherited_copy',
      instanceId: 'instance-1',
      provider: 'codex',
      accountId: 'account-1',
      bindingRevision: 3,
      credentialVersion: 7,
      sourceSessionId: 'source-session'
    })
  }
  await proveOpen()
  await eventually(async () => expect((await submission(id))?.dispatchState).toBe('accepted'))
  await host.close(SESSION, 'evict')
})

describe('what a started child reports', () => {
  it('keeps provider reports out of the saved next-message choice', async () => {
    await restartWith(publishFirst)
    const id = await heldBehindStart('hello')
    await proveOpen('reported')
    await eventually(async () => expect((await submission(id))?.dispatchState).toBe('accepted'))
    await host.handleAdapterEvent({
      type: 'options-reported',
      sessionId: SESSION,
      fence: store.getRecord(SESSION)!.lease.runtimeFence,
      acquisitionGeneration: `generation-${acquire.mock.calls.length}`,
      reportedOptions: { model: 'from-settings' }
    })
    await host.flushStreamedEvents(SESSION)
    expect(store.getRecord(SESSION)?.options).toBeUndefined()
  })

  it('preserves a later accepted pick when an older child reports options', async () => {
    await restartWith(publishFirst)
    const id = await heldBehindStart('hello')
    await store.replaceSessionOptions({
      sessionId: SESSION,
      fence: store.getRecord(SESSION)!.lease.runtimeFence,
      options: { model: 'picked' },
      now: NOW
    })
    await proveOpen('reported')
    await eventually(async () => expect((await submission(id))?.dispatchState).toBe('accepted'))
    await host.handleAdapterEvent({
      type: 'options-reported',
      sessionId: SESSION,
      fence: store.getRecord(SESSION)!.lease.runtimeFence,
      acquisitionGeneration: `generation-${acquire.mock.calls.length}`,
      reportedOptions: { model: 'from-settings' }
    })
    await host.flushStreamedEvents(SESSION)
    expect(store.getRecord(SESSION)?.options).toEqual({ model: 'picked' })
  })
})
