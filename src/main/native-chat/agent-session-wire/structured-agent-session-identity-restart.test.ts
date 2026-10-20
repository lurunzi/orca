// Fork: restarting a provider child after a coordinator identity grant, against the real host.
// The harness is the one structured-agent-session-surface-lifetime.test.ts uses.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AgentSessionOwnerProbe } from '../../../shared/agent-session-lease-adjudication'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import type { AgentSessionMutationEnvelope } from '../../../shared/agent-session-wire'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { openTestAgentSessionRecordStore } from '../../runtime/agent-session-record-store-test-harness'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import { StructuredAgentSessionHost } from './structured-agent-session-host'
import type { StructuredAgentSessionStatusSink } from './structured-agent-session-status-feed'
import {
  HOST_TEST_NOW as NOW,
  HOST_TEST_SESSION as SESSION,
  HOST_TEST_THREAD as THREAD,
  hostTestAttachParams,
  hostTestMessage,
  hostTestOperationId,
  resetHostTestOperationIds
} from './structured-agent-session-host-test-data'
import { agentSessionFailureFact } from '../../../shared/agent-session-failure'
import { agentSessionFailureWords } from '../../../shared/agent-session-failure-words'
import {
  closeTestJournalHostDatabase,
  openTestJournalHostDatabase
} from '../agent-session-journal/journal-host-database-test-support'
import { codexProviderHandle } from '../../../shared/agent-session-provider-handle-encoding'
import {
  NO_STRUCTURED_AGENTS,
  claudeAndCodexRouter
} from './structured-agent-session-adapter-router-test-support'
import { startsWhenPublished } from './structured-agent-session-instant-start.test-support'

const REQUESTED_CLOSE_END = { type: 'ended', reason: 'closed', cause: 'requested-close' } as const

const CALLER = { callerKey: 'client-1' }
/** Short enough to keep the suite fast; the host clock below decides what is idle. */
const SWEEP_MS = 5
const IDLE_MS = 1_000

let root: string
let store: AgentSessionRecordStore
let host: StructuredAgentSessionHost
let acquire: Mock<StructuredAgentSessionAdapter['acquire']>
let closeSession: Mock<NonNullable<StructuredAgentSessionAdapter['closeSession']>>
let dispatch: Mock<StructuredAgentSessionAdapter['dispatch']>
let hostErrors: unknown[]
let statusSink: StructuredAgentSessionStatusSink
let clock: number
let suggestion: string | null
function adapter(): StructuredAgentSessionAdapter {
  const provider = startsWhenPublished(
    {
      supportsLocation: () => true,
      acquire,
      closeSession,
      readPromptSuggestion: () => suggestion,
      releaseAcquisition: vi.fn(async () => true),
      dispatch,
      cancelTurn: vi.fn(async () => ({ cancelled: false })),
      answerPrompt: vi.fn(async () => undefined),
      setOption: vi.fn(async () => undefined)
    },
    () => host
  )
  return claudeAndCodexRouter({ claude: provider, codex: provider }, async () => {})
}

function openHost(
  probeOwner?: (record: AgentSessionRecord) => Promise<AgentSessionOwnerProbe>
): void {
  host = new StructuredAgentSessionHost({
    agents: NO_STRUCTURED_AGENTS,
    logger: {
      warn: (_message, fields) => hostErrors.push(fields.error),
      error: (_message, fields) => hostErrors.push(fields.error)
    },
    store,
    adapter: adapter(),
    journalDatabase: openTestJournalHostDatabase(root),
    claimKeyId: 'key-1',
    mintSpawnToken: () => `spawn-${acquire.mock.calls.length}`,
    idleSweep: { intervalMs: SWEEP_MS, idleMs: IDLE_MS },
    now: () => clock,
    statusSink,
    ...(probeOwner ? { probeOwner } : {})
  })
}

/** A fresh app generation over the same durable store, with its owner proven gone. */

async function attach(): Promise<void> {
  expect(await host.attach(CALLER, hostTestAttachParams(null))).toMatchObject({ ok: true })
}

/** What a send's delivery or `agentSession.ensure` does: attach at the record's current fence. */

function envelope(method: string, fields: Record<string, unknown>): AgentSessionMutationEnvelope {
  return {
    sessionId: SESSION,
    clientOperationId: hostTestOperationId(),
    expectedRuntimeFence: store.getRecord(SESSION)?.lease.runtimeFence ?? 1,
    payloadFingerprint: computeAgentSessionPayloadFingerprint({
      method,
      sessionId: SESSION,
      fields
    })
  }
}

/** The sweep stops the child first and closes the conversation last. */

/** Long enough for many sweep ticks, so "not stopped" means the sweep declined. */

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-identity-restart-'))
  resetHostTestOperationIds()
  hostErrors = []
  clock = NOW
  suggestion = null
  statusSink = { publish: vi.fn(), forget: vi.fn() }
  let generation = 0
  acquire = vi.fn(async ({ fence, spawnToken }) => {
    return {
      providerChildPhase: 'starting' as const,
      process: { hostId: 'local', pid: 4242, processStartTimeMs: 1_700_000_000_000, spawnToken },
      acquisitionGeneration: `generation-${++generation}`,
      link: {
        linkId: `link-${fence}`,
        handle: codexProviderHandle(THREAD),
        origin: store.getRecord(SESSION)?.providerHandleChain.length
          ? ('resumed' as const)
          : ('created' as const),
        mintedAtFence: fence,
        observedAt: NOW
      }
    }
  })
  // Like real adapters, the close reports its own end onto the chat's lane before it returns.
  closeSession = vi.fn(async (sessionId: string) => {
    suggestion = null
    const child = host['sessions'].get(sessionId)?.child
    if (child?.generation) {
      void host.handleAdapterEvent({
        ...REQUESTED_CLOSE_END,
        sessionId,
        fence: child.fence,
        acquisitionGeneration: child.generation
      })
    }
    return true
  })
  dispatch = vi.fn(async () => ({
    state: 'rejected' as const,
    ...agentSessionFailureWords(agentSessionFailureFact('providerRejected'), {
      surface: 'rejection'
    })
  }))
  store = await openTestAgentSessionRecordStore(root)
  openHost()
})

afterEach(async () => {
  await host.flushAllStreamedEvents()
  closeTestJournalHostDatabase(root)
  await rm(root, { recursive: true, force: true })
})

async function submissionState(clientMessageId: string): Promise<string | undefined> {
  return (await host.journalSnapshot(SESSION)).submissions.find(
    (entry) => entry.clientMessageId === clientMessageId
  )?.dispatchState
}

// Fork: the coordinator identity grant restarts the provider child through this recovery path.
describe('a provider child restarted for a new identity', () => {
  it('keeps the last suggestion on subscriber frames after an identity restart', async () => {
    await attach()
    suggestion = 'Review the changes'
    const emit = vi.fn()
    await host.subscribe({ id: 'composer', sessionId: SESSION, emit })
    expect(emit.mock.calls.some(([frame]) => frame.promptSuggestion === suggestion)).toBe(true)
    emit.mockClear()
    expect(await host.eventRecovery.restartProviderChild(SESSION, 'identity granted')).toBe(true)
    await host.flushStreamedEvents(SESSION)
    const reconnect = vi.fn()
    await host.subscribe({ id: 'reconnected-composer', sessionId: SESSION, emit: reconnect })
    expect(
      reconnect.mock.calls.some(([frame]) => frame.promptSuggestion === 'Review the changes')
    ).toBe(true)
    expect(emit.mock.calls.some(([frame]) => frame.promptSuggestion === null)).toBe(false)
  })

  it('stops an idle child quietly; the next message starts one that re-reads its launch env', async () => {
    await attach()

    await expect(
      host.eventRecovery.restartProviderChild(SESSION, 'identity granted')
    ).resolves.toBe(true)

    expect(closeSession).toHaveBeenCalledWith(SESSION)
    // No respawn: the conversation waits for work, as after any exit.
    expect(acquire).toHaveBeenCalledOnce()
    expect(store.getRecord(SESSION)?.lease).toMatchObject({ claimStatus: 'released' })
    const history = await host.history({ sessionId: SESSION, direction: 'tail' })
    expect(
      history.ok &&
        history.page.items.some(
          (item) => item.body.kind === 'status' && item.body.text.includes('identity granted')
        )
    ).toBe(false)
    dispatch.mockResolvedValueOnce({
      state: 'accepted',
      providerIdentity: { provider: 'codex', threadId: THREAD, turnId: 'turn-next', ordinal: 1 }
    })
    const body = hostTestMessage('after restart')
    const nextEnvelope = envelope('agentSession.send', { body })
    await host.send(CALLER, { envelope: nextEnvelope, body })
    await vi.waitFor(async () =>
      expect(await submissionState(nextEnvelope.clientOperationId)).toBe('accepted')
    )
    expect(acquire).toHaveBeenCalledTimes(2)
  })
})
