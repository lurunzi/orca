import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DashboardToolProvider } from '../../../../../shared/dashboard-account-provider'
import { AgentSessionPoolAccountOrigin } from '../../../../../shared/agent-session/lifecycle/accounts/agent-session-pool-account'
import { codexProviderHandle } from '../../../../../shared/agent-session/lifecycle/provider-handles/agent-session-provider-handle-encoding'
import { DashboardAllocationError } from '../../../../dashboard-accounts/dashboard-allocation-protocol'
import type { CodexPoolCopyReceipt } from '../../../../dashboard-accounts/dashboard-codex-pool-copy'
import { readPersistedTestAgentSessionStore } from '../../../../runtime/agent-session/records/agent-session-record-store-persistence.test-fixture'
import { writeTestAgentSessionRecordRow } from '../../../../runtime/agent-session/records/agent-session-record-row-write.test-fixture'
import { readTestHostJournal } from '../../../agent-session-journal/journal-observation.test-support'
import {
  createRestTestRig,
  type RestTestRig
} from '../../host/testing/structured-agent-session-rest-test-rig.test-fixture'
import { hostTestMessage } from '../../host/testing/structured-agent-session-host-test-data.test-fixture'
import { claudeAndCodexDeclared } from '../../providers/testing/structured-agent-session-adapter-router.test-fixture'
import { forkTestSource } from './structured-agent-session-fork.test-fixture'

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

/** Preparation reads the fixture's source; founding runs on the rig host against the seeded row. */
function poolSource() {
  const test = forkTestSource(rig, 'codex')
  test.record.poolAccount = {
    version: 1,
    origin: AgentSessionPoolAccountOrigin.InheritedCopy,
    provider: DashboardToolProvider.Codex,
    instanceId: 'instance-1',
    accountId: 'account-1',
    bindingRevision: 2,
    credentialVersion: 3,
    sourceSessionId: 'earlier-ancestor'
  }
  const receipt: CodexPoolCopyReceipt = {
    provider: DashboardToolProvider.Codex,
    sourceSessionId: test.record.sessionId,
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
  const nativeCopy = test.copy.getMockImplementation()!
  test.copy.mockImplementation(async (input) => ({
    ...(await nativeCopy(input)),
    poolCopy: receipt
  }))
  return { ...test, receipt }
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

it('commits the directly copied pool identity and replays without rewriting it', async () => {
  const test = poolSource()
  const params = await test.prepare()
  test.receipt.identity.credentialVersion = 99
  expect(await rig.host.create(CALLER, params)).toMatchObject({ ok: true })
  const sessionId = test.intent.envelope.sessionId
  expect(rig.store.getRecord(sessionId)?.poolAccount).toEqual(inheritedIdentity())
  expect((await readPersistedTestAgentSessionStore(rig.root)).records[sessionId]).toMatchObject({
    poolAccount: inheritedIdentity(),
    forkedFrom: { sessionId: 'source-chat' }
  })
  const stored = rig.store.requireWritableRecord('source-chat')
  await writeTestAgentSessionRecordRow(
    rig.root,
    { ...stored, poolAccount: { ...stored.poolAccount!, accountId: 'changed-account' } },
    rig.store
  )
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
  const test = poolSource()
  const params = await test.prepare()
  const result = await rig.host.create(CALLER, params, {
    firstMessage: { clientMessageId: 'first-copy-message', body: hostTestMessage('Continue') }
  })
  expect(result).toMatchObject({
    ok: true,
    value: { firstMessage: { clientMessageId: 'first-copy-message' } }
  })
  const sessionId = test.intent.envelope.sessionId
  expect((await readPersistedTestAgentSessionStore(rig.root)).records[sessionId]).toMatchObject({
    poolAccount: inheritedIdentity()
  })
  expect((await readTestHostJournal(rig.host, sessionId)).submissions).toContainEqual(
    expect.objectContaining({ clientMessageId: 'first-copy-message' })
  )
})

it('rejects an account change during native copy before publishing an adoption', async () => {
  const test = poolSource()
  const copy = test.copy.getMockImplementation()!
  test.copy.mockImplementationOnce(async (input) => {
    const result = await copy(input)
    test.record.poolAccount = { ...test.record.poolAccount!, accountId: 'another-account' }
    return result
  })
  await expect(test.prepare()).rejects.toEqual(new DashboardAllocationError())
  expect(rig.store.getRecord(test.intent.envelope.sessionId)).toBeNull()
})

it('rechecks the source head in the final founding draft after host revalidation', async () => {
  const test = poolSource()
  const params = await test.prepare()
  const admit = params.fork!.withAdmission
  params.fork!.withAdmission = (run) =>
    admit(async () => {
      // After the host's last look, so only the founding transaction can see the new head.
      await writeTestAgentSessionRecordRow(rig.root, {
        ...test.record,
        providerHandleChain: [
          {
            ...test.record.providerHandleChain[0]!,
            handle: codexProviderHandle('different-source-head')
          }
        ]
      })
      return run()
    })
  // The founding transaction refuses the moved source before any child row is written.
  expect(await rig.host.create(CALLER, params)).toMatchObject({ ok: false })
  expect(rig.store.getRecord(test.intent.envelope.sessionId)).toBeNull()
  expect(rig.store.getOperationRow(CALLER.callerKey, params.envelope.clientOperationId)).toBeNull()
})

it('keeps a pool copy valid across a same-native-id relaunch, but rejects a missing receipt', async () => {
  const test = poolSource()
  const copy = test.copy.getMockImplementation()!
  test.copy.mockImplementationOnce(async (input) => {
    test.record.providerHandleChain = [
      ...test.record.providerHandleChain,
      {
        ...test.record.providerHandleChain[0]!,
        linkId: 'relaunched-source',
        origin: 'resumed',
        mintedAtFence: 2,
        observedAt: rig.clock.now
      }
    ]
    test.record.lease = { ...test.record.lease, runtimeFence: 2 }
    return copy(input)
  })
  const params = await test.prepare()
  expect(await rig.host.create(CALLER, params)).toMatchObject({ ok: true })
  expect(rig.store.getRecord(test.intent.envelope.sessionId)?.poolAccount).toEqual(
    inheritedIdentity()
  )
  test.copy.mockImplementationOnce(async () => ({ sessionId: 'another-native-copy' }))
  await expect(test.prepare()).rejects.toEqual(new DashboardAllocationError())
})
