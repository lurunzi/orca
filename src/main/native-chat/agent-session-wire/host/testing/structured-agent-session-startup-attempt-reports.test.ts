import { describe, expect, it } from 'vitest'
import { DashboardToolProvider } from '../../../../../shared/dashboard-account-provider'
import { AgentSessionPoolAccountOrigin } from '../../../../../shared/agent-session/lifecycle/accounts/agent-session-pool-account'
import { mintStructuredAgentSessionStartupAttempt } from '../../startup/structured-agent-session-startup-attempt-mint'
import { writeTestAgentSessionRecordRow } from '../../../../runtime/agent-session/records/agent-session-record-row-write.test-fixture'
import {
  agentSessionFailureFact,
  readWholeAgentSessionFailureFact
} from '../../../../../shared/agent-session/failures/agent-session-failure'
import {
  AgentSessionAcquisitionExitProvenError,
  AgentSessionAcquisitionExitUnprovenError
} from '../../acquisition/structured-agent-session-acquisition-errors'
import { AgentSessionStartFailure } from '../../startup/structured-agent-session-start-failure'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION
} from './structured-agent-session-host-test-data.test-fixture'
import {
  acquire,
  accept,
  advanceHostWallClock,
  eventually,
  heldBehindStart,
  host,
  proveOpen,
  publishFirst,
  restartWith,
  root,
  store,
  submission,
  registerStartupAttemptHostTests
} from './structured-agent-session-startup-attempt-host.test-fixture'

registerStartupAttemptHostTests()

it('carries a persisted inherited pool identity into acquisition as an independent snapshot', async () => {
  await writeTestAgentSessionRecordRow(
    root,
    {
      ...store.requireWritableRecord(SESSION),
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
    },
    store
  )
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
  await writeTestAgentSessionRecordRow(
    root,
    { ...store.requireWritableRecord(SESSION), poolAccount: source.poolAccount },
    store
  )
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
  it('preserves a final provider answer through nested acquisition exit proofs', async () => {
    await restartWith(async () => {
      throw new AgentSessionAcquisitionExitProvenError(
        new AgentSessionAcquisitionExitProvenError(
          new AgentSessionStartFailure(new Error('the connection ended'), 'never', {
            kind: 'providerStartFailed',
            detail: { text: 'the provider declined startup', audience: 'person' }
          })
        )
      )
    })
    const id = await accept('preserve the final answer')
    await eventually(async () => {
      const sent = await submission(id)
      expect(sent?.dispatchState).toBe('rejected')
      expect(readWholeAgentSessionFailureFact(sent?.rejection)).toMatchObject({
        kind: 'providerStartFailed',
        detail: { text: 'the provider declined startup', audience: 'person' }
      })
    })
  })

  it('keeps an unproven owner refusal ahead of an embedded provider failure', async () => {
    await restartWith(async () => {
      throw new AgentSessionAcquisitionExitUnprovenError(
        new AgentSessionStartFailure(
          new Error('provider exited'),
          'safe',
          agentSessionFailureFact('providerStartFailed')
        )
      )
    })
    const id = await accept('preserve ownership')
    await eventually(async () => {
      const sent = await submission(id)
      expect(sent?.dispatchState).toBe('rejected')
      expect(readWholeAgentSessionFailureFact(sent?.rejection)).toMatchObject({
        kind: 'restartFailed',
        refusal: {
          code: 'agent_session_ownership_unknown',
          details: { reason: 'ownerUnproven' }
        }
      })
    })
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

describe('a start across a sleep', () => {
  it('lets a start that a sleep held past the idle window finish and deliver its message', async () => {
    await restartWith(publishFirst)
    const id = await heldBehindStart('hello')
    advanceHostWallClock(2 * 60 * 60_000)
    await host.collaboratorsForTests().lifetime.idleSweep.tick()
    await proveOpen()
    await eventually(async () => expect((await submission(id))?.dispatchState).toBe('accepted'))
  })
})
