import { describe, expect, it, vi } from 'vitest'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../shared/agent-session/journal/agent-session-journal-types'
import {
  DashboardAgentRestartCode as Code,
  type DashboardAgentRestartRequest
} from '../../dashboard-accounts/dashboard-agent-restart-protocol'
import { DashboardToolProvider } from '../../dashboard-accounts/dashboard-allocation-protocol'
import { AgentSessionAcquisitionRootExitObservedError } from './acquisition/structured-agent-session-acquisition-errors'
import { holdDelivery } from './host/testing/structured-agent-session-delivery-hold.test-fixture'
import {
  hostTestState,
  attach,
  CALLER,
  envelope,
  accepted
} from './host/testing/structured-agent-session-host-test-harness'
import {
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD,
  HOST_TEST_NOW as NOW,
  hostTestMessage
} from './host/testing/structured-agent-session-host-test-data'

async function target(): Promise<DashboardAgentRestartRequest> {
  await attach()
  const { host, store } = hostTestState()
  const child = host.collaboratorsForTests().sessions.get(SESSION)?.child
  const process = store.requireWritableRecord(SESSION).lease.ownerProcess
  if (!child?.generation || !process) {
    throw new Error('expected acquired fixture')
  }
  return {
    provider: DashboardToolProvider.Codex,
    session_id: SESSION,
    fence: child.fence,
    acquisition_generation: child.generation,
    confirm_interrupt: true,
    process: {
      hostId: process.hostId,
      pid: process.pid,
      processStartTimeMs: process.processStartTimeMs,
      spawnToken: process.spawnToken
    }
  }
}
function send(text: string, delivery?: 'queue-if-active') {
  const { host } = hostTestState()
  const fields = { body: hostTestMessage(text), ...(delivery ? { delivery } : {}) }
  return host.send(CALLER, {
    envelope: envelope('agentSession.send', fields),
    ...fields,
    userSend: true
  })
}

describe('credential restart of an observed Host child', () => {
  it('waits for close, keeps the conversation and starts without sending a model request', async () => {
    const input = await target()
    const { host, store, acquire, dispatch } = hostTestState()
    const before = store.requireWritableRecord(SESSION)
    const original = host.collaboratorsForTests().sessions.get(SESSION)
    const closing = Promise.withResolvers<boolean>()
    const entered = Promise.withResolvers<void>()
    const close = vi.fn(async () => {
      entered.resolve()
      return closing.promise
    })
    host.deps.adapter.closeSession = close
    const restarted = host.mutations.restartAgentForCredentials(input)
    await entered.promise
    expect(acquire).toHaveBeenCalledTimes(1)
    closing.resolve(true)
    const result = await restarted
    expect(close).toHaveBeenCalledOnce()
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(dispatch).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      provider: DashboardToolProvider.Codex,
      session_id: SESSION,
      previous_exit_observed: true
    })
    expect(result.fence).toBeGreaterThan(input.fence)
    expect(result.acquisition_generation).not.toBe(input.acquisition_generation)
    expect(Object.keys(result.process).sort()).toEqual(Object.keys(input.process).sort())
    expect(host.collaboratorsForTests().sessions.get(SESSION)).toBe(original)
    expect(store.requireWritableRecord(SESSION)).toMatchObject({
      location: before.location,
      accountHome: before.accountHome
    })
  })

  it.each([
    {
      name: 'fence',
      change: (input: DashboardAgentRestartRequest) => ({ ...input, fence: input.fence + 1 })
    },
    {
      name: 'generation',
      change: (input: DashboardAgentRestartRequest) => ({
        ...input,
        acquisition_generation: 'another'
      })
    },
    {
      name: 'process',
      change: (input: DashboardAgentRestartRequest) => ({
        ...input,
        process: { ...input.process, spawnToken: 'another' }
      })
    },
    {
      name: 'tool',
      change: (input: DashboardAgentRestartRequest) => ({
        ...input,
        provider: DashboardToolProvider.ClaudeCode
      })
    }
  ])('refuses a changed $name before stop', async ({ change }) => {
    const input = await target()
    const { host, acquire } = hostTestState()
    const close = vi.fn(async () => true)
    host.deps.adapter.closeSession = close
    await expect(host.mutations.restartAgentForCredentials(change(input))).rejects.toMatchObject({
      code: Code.TargetChanged
    })
    expect(close).not.toHaveBeenCalled()
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it('requires explicit confirmation and rejects extra input before stop', async () => {
    const input = await target()
    const { host, acquire } = hostTestState()
    const close = vi.fn(async () => true)
    host.deps.adapter.closeSession = close
    await expect(
      host.mutations.restartAgentForCredentials({ ...input, confirm_interrupt: false })
    ).rejects.toMatchObject({ code: Code.InvalidRequest })
    await expect(
      host.mutations.restartAgentForCredentials({ ...input, credential: 'never accepted' })
    ).rejects.toMatchObject({ code: Code.InvalidRequest })
    expect(close).not.toHaveBeenCalled()
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it('checks the target after earlier operations in the same session lane', async () => {
    const input = await target()
    const { host, acquire } = hostTestState()
    const close = vi.fn(async () => true)
    host.deps.adapter.closeSession = close
    const closed = host.close(SESSION, 'user-close')
    const restart = expect(host.mutations.restartAgentForCredentials(input)).rejects.toMatchObject({
      code: Code.TargetChanged
    })
    await closed
    await restart
    expect(close).toHaveBeenCalledOnce()
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it('retains an unconfirmed closing child without starting another one', async () => {
    const input = await target()
    const { host, acquire } = hostTestState()
    const close = vi.fn(async () => false)
    host.deps.adapter.closeSession = close
    await expect(host.mutations.restartAgentForCredentials(input)).rejects.toMatchObject({
      code: Code.ExitUnconfirmed,
      message: Code.ExitUnconfirmed
    })
    expect(acquire).toHaveBeenCalledTimes(1)
    expect(host.collaboratorsForTests().sessions.get(SESSION)?.child?.close).toBeDefined()
    close.mockResolvedValue(true)
  })

  it('retains the child and lease after kill until actual exit, including subsequent closes', async () => {
    const input = await target()
    const { host, acquire, store } = hostTestState()
    const original = host.collaboratorsForTests().sessions.get(SESSION)?.child
    const close = vi
      .fn(async () => true)
      .mockRejectedValueOnce(
        new AgentSessionAcquisitionRootExitObservedError(
          new Error('private provider failure'),
          'kill-delivered'
        )
      )
    host.deps.adapter.closeSession = close
    await expect(host.mutations.restartAgentForCredentials(input)).rejects.toMatchObject({
      code: Code.ExitUnconfirmed,
      message: Code.ExitUnconfirmed
    })
    await expect(host.close(SESSION, 'user-close')).rejects.toThrow()
    expect(close).toHaveBeenCalledOnce()
    expect(host.collaboratorsForTests().sessions.get(SESSION)?.child).toBe(original)
    expect(original?.close?.exitConfirmation).toEqual({ awaitingObservation: true })
    expect(store.requireWritableRecord(SESSION).lease).toMatchObject({
      runtimeFence: input.fence,
      claimStatus: 'live',
      ownerProcess: input.process
    })
    await host.handleAdapterEvent({
      type: 'ended',
      sessionId: SESSION,
      fence: input.fence,
      acquisitionGeneration: input.acquisition_generation,
      cause: 'requested-close',
      reason: 'kill reported',
      deathEvidenceKind: 'kill-delivered'
    })
    expect(host.collaboratorsForTests().sessions.get(SESSION)?.child).toBe(original)
    await host.handleAdapterEvent({
      type: 'ended',
      sessionId: SESSION,
      fence: input.fence,
      acquisitionGeneration: input.acquisition_generation,
      cause: 'requested-close',
      reason: 'observed exit',
      processExit: { root: 'exited', workload: 'exited' }
    })
    expect(host.collaboratorsForTests().sessions.get(SESSION)?.child).toBeNull()
    expect(store.requireWritableRecord(SESSION).lease).toMatchObject({
      claimStatus: 'released',
      ownerProcess: null
    })
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it('reports a fixed error when the replacement cannot start', async () => {
    const input = await target()
    const { host, acquire, dispatch, store } = hostTestState()
    host.deps.adapter.closeSession = vi.fn(async () => true)
    acquire.mockRejectedValueOnce(new Error('private provider failure'))
    await expect(host.mutations.restartAgentForCredentials(input)).rejects.toMatchObject({
      code: Code.Failed,
      message: Code.Failed
    })
    expect(dispatch).not.toHaveBeenCalled()
    expect(store.getRecord(SESSION)).not.toBeNull()
  })

  it('retains an accepted ordinary send blocked before handover as a paused card', async () => {
    const input = await target()
    const { host, dispatch } = hostTestState()
    host.deps.adapter.closeSession = vi.fn(async () => true)
    const held = holdDelivery()
    const sending = send('ordinary waiting')
    try {
      await held.held
      const restarting = host.mutations.restartAgentForCredentials(input)
      held.release()
      await restarting
    } finally {
      held.release()
    }
    await sending
    const journal = host.collaboratorsForTests().sessions.get(SESSION)?.journal
    expect(journal?.queuedMessages.list()).toMatchObject([
      { state: 'waiting', body: { blocks: [{ type: 'text', text: 'ordinary waiting' }] } }
    ])
    expect(journal?.queuedMessages.nextInputCard()).toBeNull()
    expect((await host.journalSnapshot(SESSION)).submissions).toMatchObject([
      { dispatchState: 'rejected', keptAsQueuedMessageId: expect.any(String) }
    ])
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('settles an unwritten handover as a kept card even when stopping cannot confirm exit', async () => {
    const input = await target()
    const { host, dispatch, store } = hostTestState()
    const preparing = Promise.withResolvers<AbortSignal>()
    dispatch.mockImplementationOnce(({ signal }) => {
      if (!signal) {
        throw new Error('expected preparation cancellation signal')
      }
      preparing.resolve(signal)
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const close = vi.fn(async () => false)
    host.deps.adapter.closeSession = close
    try {
      const sent = await send('preparing before provider write')
      if (!sent.ok) {
        throw new Error('expected admitted send')
      }
      const { clientMessageId } = sent.value
      const signal = await preparing.promise
      await expect(host.mutations.restartAgentForCredentials(input)).rejects.toMatchObject({
        code: Code.ExitUnconfirmed
      })
      expect(signal.aborted).toBe(true)
      // A kept card stays the queue's to hand over, so its row is the proof, not a send answer.
      await vi.waitFor(async () =>
        expect((await host.journalSnapshot(SESSION)).submissions).toMatchObject([
          { clientMessageId, dispatchState: 'rejected', keptAsQueuedMessageId: clientMessageId }
        ])
      )
      expect(store.requireWritableRecord(SESSION).lease).toMatchObject({
        runtimeFence: input.fence,
        claimStatus: 'live',
        ownerProcess: input.process
      })
    } finally {
      close.mockResolvedValue(true)
    }
  })

  it('preserves queued messages and does not replay interrupted work', async () => {
    const input = await target()
    const { host, dispatch, acquire } = hostTestState()
    host.deps.adapter.closeSession = vi.fn(async () => true)
    const received = Promise.withResolvers<void>()
    dispatch.mockImplementationOnce(async () => {
      received.resolve()
      return accepted()
    })
    expect(await send('working')).toMatchObject({ ok: true })
    await received.promise
    acquire.mock.calls[0]?.[0].events?.appendItem(
      { provider: 'codex', threadId: THREAD, turnId: 'turn-1', ordinal: 100 },
      { kind: 'turn', turnId: 'turn-1', state: 'running', startedAt: NOW, requestedAt: NOW },
      { turnScope: AGENT_JOURNAL_THREAD_SCOPE }
    )
    await host.flushStreamedEvents(SESSION)
    expect(await send('waiting', 'queue-if-active')).toMatchObject({
      ok: true,
      value: { queued: { state: 'waiting' } }
    })
    const journal = host.collaboratorsForTests().sessions.get(SESSION)?.journal
    const originalDrafts = journal?.queuedMessages.list()
    const dispatched = dispatch.mock.calls.length
    await host.mutations.restartAgentForCredentials(input)
    await host.flushStreamedEvents(SESSION)
    await host.collaboratorsForTests().serialize(SESSION, async () => {})
    expect(dispatch).toHaveBeenCalledTimes(dispatched)
    expect(journal?.queuedMessages.list()).toEqual(originalDrafts)
    expect(journal?.queuedMessages.pauses().length).toBeGreaterThan(0)
    expect((await host.journalSnapshot(SESSION)).submissions).toHaveLength(1)
  })
})
