import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DashboardToolProvider } from '../../../../../shared/dashboard-account-provider'
import { AgentSessionPoolAccountOrigin } from '../../../../../shared/agent-session/lifecycle/agent-session-pool-account'
import { codexProviderHandle } from '../../../../../shared/agent-session/lifecycle/agent-session-provider-handle-encoding'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../../../shared/agent-session/journal/agent-session-journal-types'
import { structuredAgentSessionCreateParams } from '../../../../../shared/agent-session/structured-agent-session-create'
import { DashboardAllocationError } from '../../../../dashboard-accounts/dashboard-allocation-protocol'
import type { CodexPoolCopyReceipt } from '../../../../dashboard-accounts/dashboard-codex-pool-copy'
import {
  readPersistedTestAgentSessionStore,
  seedTestAgentSessionRecordStore
} from '../../../../runtime/agent-session/records/agent-session-record-store-test-harness'
import { agentSessionRecordFixture } from '../../../agent-session-record-test-fixture'
import { openAgentSessionJournal } from '../../../agent-session-journal/journal-store-factory'
import { openTestJournalHostDatabase } from '../../../agent-session-journal/store-lifecycle/journal-host-database-test-support'
import {
  createRestTestRig,
  type RestTestRig
} from '../../host/testing/structured-agent-session-rest-test-rig'
import { hostTestMessage } from '../../host/testing/structured-agent-session-host-test-data'
import { claudeAndCodexDeclared } from '../../providers/testing/structured-agent-session-adapter-router-test-support'
import { prepareStructuredAgentSessionFork } from '../structured-agent-session-fork'

const SOURCE = '019e6b26-18e2-7103-b7a0-7ba6bb071123'
const COPY = '019e6b26-18e2-7103-b7a0-7ba6bb071124'
const CALLER = { callerKey: 'device-1' }
let rig: RestTestRig

beforeEach(async () => {
  rig = await createRestTestRig({
    agents: claudeAndCodexDeclared(),
    idleSweep: { intervalMs: 60_000 }
  })
})
afterEach(async () => {
  await rig.dispose()
  vi.restoreAllMocks()
})

async function poolSource() {
  const source = agentSessionRecordFixture({
    sessionId: 'source-chat',
    provider: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: join(rig.root, 'source-account') },
    launchDirectory: rig.root,
    poolAccount: {
      version: 1,
      origin: AgentSessionPoolAccountOrigin.InheritedCopy,
      provider: DashboardToolProvider.Codex,
      instanceId: 'instance-1',
      accountId: 'account-1',
      bindingRevision: 2,
      credentialVersion: 3,
      sourceSessionId: 'earlier-ancestor'
    },
    providerHandleChain: [
      {
        linkId: 'source-head',
        origin: 'adopted',
        mintedAtFence: 1,
        observedAt: 1,
        handle: codexProviderHandle(SOURCE)
      }
    ]
  })
  await seedTestAgentSessionRecordStore(rig.root, { records: [source] })
  await rig.restart()
  const journal = await openAgentSessionJournal({
    database: openTestJournalHostDatabase(rig.root),
    identity: {
      sessionId: source.sessionId,
      workspaceId: source.location.workspaceId,
      hostId: 'local',
      agent: 'codex',
      providerHandle: codexProviderHandle(SOURCE)
    },
    now: () => rig.clock.now
  })
  const turn = await journal.appendItem(
    { provider: 'codex', threadId: SOURCE, turnId: 'completed-turn', ordinal: 0 },
    { kind: 'turn', turnId: 'completed-turn', state: 'completed' },
    { fence: 1, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
  )
  const selected = await journal.appendItem(
    { provider: 'codex', threadId: SOURCE, turnId: 'completed-turn', ordinal: 1 },
    { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'Remembered' }] },
    { fence: 1, turnScope: { kind: 'turn', turnItemId: turn.itemId } }
  )
  await journal.close()
  const receipt: CodexPoolCopyReceipt = {
    provider: DashboardToolProvider.Codex,
    sourceSessionId: source.sessionId,
    sourceProviderSessionId: SOURCE,
    targetProviderSessionId: COPY,
    identity: {
      provider: DashboardToolProvider.Codex,
      instanceId: 'instance-1',
      accountId: 'account-1',
      bindingRevision: 4,
      credentialVersion: 5
    }
  }
  const copy = vi.fn(async () => {
    const directory = join(rig.root, 'source-account', 'sessions', '2026', '11', '03')
    await mkdir(directory, { recursive: true })
    const filePath = join(directory, `rollout-2026-11-03T19-00-00-${COPY}.jsonl`)
    await writeFile(
      filePath,
      `${[
        {
          type: 'session_meta',
          payload: { id: COPY, timestamp: '2026-11-03T19:00:00.000Z', cwd: rig.root }
        },
        {
          type: 'response_item',
          timestamp: '2026-11-03T19:00:01.000Z',
          payload: { type: 'message', role: 'user', content: 'Remember the nonce 57319' }
        }
      ]
        .map((row) => JSON.stringify(row))
        .join('\n')}\n`
    )
    return { sessionId: COPY, filePath, poolCopy: receipt }
  })
  rig.host.deps.adapter.copyConversation = copy
  const intent = structuredAgentSessionCreateParams({
    sessionId: 'codex_independent_child',
    agent: 'codex',
    worktree: 'id:workspace-1',
    forkFrom: { sessionId: source.sessionId, throughItemId: selected.itemId },
    now: rig.clock.now,
    randomUuid: () => '00000000-0000-0000-0000-000000000123'
  })
  const prepare = () =>
    prepareStructuredAgentSessionFork({
      host: rig.host,
      sessionId: source.sessionId,
      throughItemId: selected.itemId,
      agent: 'codex',
      location: source.location,
      envelope: intent.envelope
    })
  return { source, receipt, copy, intent, prepare }
}

function inheritedIdentity() {
  return {
    version: 1,
    origin: AgentSessionPoolAccountOrigin.InheritedCopy,
    provider: DashboardToolProvider.Codex,
    instanceId: 'instance-1',
    accountId: 'account-1',
    bindingRevision: 4,
    credentialVersion: 5,
    sourceSessionId: 'source-chat'
  }
}

it('commits the directly copied pool identity, reloads it, and replays without rewriting it', async () => {
  const test = await poolSource()
  const params = await test.prepare()
  test.receipt.identity.credentialVersion = 99
  expect(await rig.host.create(CALLER, params)).toMatchObject({ ok: true })
  const sessionId = test.intent.envelope.sessionId
  expect(rig.store.getRecord(sessionId)?.poolAccount).toEqual(inheritedIdentity())
  expect((await readPersistedTestAgentSessionStore(rig.root)).records[sessionId]).toMatchObject({
    poolAccount: inheritedIdentity(),
    forkedFrom: { sessionId: 'source-chat' }
  })
  await rig.restart()
  expect(rig.store.getRecord(sessionId)?.poolAccount).toEqual(inheritedIdentity())
  await rig.store.transitionHandoff('source-chat', (record) => ({
    ...record,
    poolAccount: { ...record.poolAccount!, accountId: 'changed-account' }
  }))
  const replay = {
    ...params,
    fork: {
      ...params.fork!,
      poolCopy: {
        ...test.receipt,
        identity: { ...test.receipt.identity, accountId: 'changed-account', credentialVersion: 9 }
      },
      revalidate: async () => {
        throw new Error('Committed replay must not rediscover the source')
      }
    }
  }
  expect(await rig.host.create(CALLER, replay)).toMatchObject({ ok: true, replayed: true })
  expect(
    (await readPersistedTestAgentSessionStore(rig.root)).records[sessionId]?.poolAccount
  ).toEqual(inheritedIdentity())
})

it('stores the inherited identity in the same founding receipt as the first message', async () => {
  const test = await poolSource()
  const params = await test.prepare()
  const result = await rig.host.create(CALLER, params, {
    firstMessage: { clientMessageId: 'first-copy-message', body: hostTestMessage('Continue') }
  })
  expect(result).toMatchObject({
    ok: true,
    value: { firstMessage: { clientMessageId: 'first-copy-message' } }
  })
  await rig.restart()
  expect(rig.store.getRecord(test.intent.envelope.sessionId)?.poolAccount).toEqual(
    inheritedIdentity()
  )
  const snapshot = await rig.host.journalSnapshot(test.intent.envelope.sessionId)
  expect(snapshot.submissions).toContainEqual(
    expect.objectContaining({ clientMessageId: 'first-copy-message' })
  )
})

it('rejects an account change during native copy before publishing an adoption', async () => {
  const test = await poolSource()
  const copy = test.copy.getMockImplementation()!
  test.copy.mockImplementationOnce(async () => {
    const result = await copy()
    await rig.store.transitionHandoff('source-chat', (record) => ({
      ...record,
      poolAccount: { ...record.poolAccount!, accountId: 'another-account' }
    }))
    return result
  })
  await expect(test.prepare()).rejects.toEqual(new DashboardAllocationError())
  expect(rig.store.getRecord(test.intent.envelope.sessionId)).toBeNull()
})

it('rechecks the source head in the final founding draft after host revalidation', async () => {
  const test = await poolSource()
  const params = await test.prepare()
  const commit = rig.store.founding.commit
  vi.spyOn(rig.store.founding, 'commit').mockImplementationOnce(async (request) => {
    await rig.store.transitionHandoff('source-chat', (record) => ({
      ...record,
      providerHandleChain: [
        {
          ...record.providerHandleChain[0]!,
          handle: codexProviderHandle('different-source-head')
        }
      ]
    }))
    return commit(request)
  })
  await expect(rig.host.create(CALLER, params)).rejects.toEqual(new DashboardAllocationError())
  expect(rig.store.getRecord(test.intent.envelope.sessionId)).toBeNull()
  expect(rig.store.getOperationRow(CALLER.callerKey, params.envelope.clientOperationId)).toBeNull()
})

it('keeps a pool copy valid across a same-native-id relaunch, but rejects a missing receipt', async () => {
  const test = await poolSource()
  const copy = test.copy.getMockImplementation()!
  test.copy.mockImplementationOnce(async () => {
    await rig.store.transitionHandoff('source-chat', (record) => ({
      ...record,
      providerHandleChain: [
        ...record.providerHandleChain,
        {
          ...record.providerHandleChain[0]!,
          linkId: 'relaunched-source',
          origin: 'resumed',
          mintedAtFence: 2,
          observedAt: rig.clock.now
        }
      ],
      lease: { ...record.lease, runtimeFence: 2 }
    }))
    return copy()
  })
  const params = await test.prepare()
  expect(await rig.host.create(CALLER, params)).toMatchObject({ ok: true })
  expect(rig.store.getRecord(test.intent.envelope.sessionId)?.poolAccount).toEqual(
    inheritedIdentity()
  )
  rig.host.deps.adapter.copyConversation = async () => ({ sessionId: 'another-native-copy' })
  await expect(test.prepare()).rejects.toEqual(new DashboardAllocationError())
})
