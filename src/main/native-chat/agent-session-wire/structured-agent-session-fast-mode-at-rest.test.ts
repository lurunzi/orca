import { afterEach, expect, it } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import {
  hostTestAttachParams,
  hostTestOperationId
} from './structured-agent-session-host-test-data'
import {
  createRestTestRig,
  REST_TEST_CALLER as CALLER,
  REST_TEST_SESSION as SESSION,
  type RestTestRig
} from './structured-agent-session-rest-test-rig'

let rig: RestTestRig | undefined
afterEach(async () => {
  await rig?.dispose()
})

it('refuses enabling Claude Fast at rest despite an older catalog claiming support', async () => {
  rig = await createRestTestRig({
    idleSweep: { intervalMs: 3_600_000 },
    modelCatalog: {
      read: async () => ({
        origin: 'live-session',
        fetchedAt: 1,
        models: [
          { id: 'opus', label: 'Opus', isDefault: true, efforts: [], supportsFastMode: true }
        ],
        fastModeSupport: { supported: true }
      })
    }
  })
  const providerSessionId = '819cf9f8-e43c-4ad7-b50f-54aa158a726a'
  rig.adapter.acquire.mockImplementation(async ({ fence, spawnToken }) => ({
    acquisitionGeneration: 'claude-generation',
    process: { hostId: 'local', pid: 4242, processStartTimeMs: 1, spawnToken },
    link: {
      linkId: 'claude-link',
      handle: { provider: 'claude', sessionId: providerSessionId, leafUuid: null },
      origin: 'created',
      mintedAtFence: fence,
      observedAt: 1
    }
  }))
  expect(
    await rig.host.attach(
      CALLER,
      hostTestAttachParams(null, {
        provider: 'claude',
        agent: 'claude',
        accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: rig.root },
        providerHandle: { kind: 'claude', sessionId: providerSessionId, leafUuid: null },
        options: { model: 'opus', fastMode: 'true' }
      })
    )
  ).toMatchObject({ ok: true })
  await rig.restart()
  rig.adapter.acquire.mockClear()
  await expect(rig.host.readOptions(SESSION)).resolves.toMatchObject({
    fastModeSupport: { supported: false, reason: 'availability-unconfirmed' }
  })
  const currentRig = rig
  const setFast = (value: string) => {
    const fields = { key: 'fastMode', value }
    return currentRig.host.setOption(CALLER, {
      ...fields,
      envelope: {
        sessionId: SESSION,
        clientOperationId: hostTestOperationId(),
        expectedRuntimeFence: currentRig.store.getRecord(SESSION)!.lease.runtimeFence,
        payloadFingerprint: computeAgentSessionPayloadFingerprint({
          method: 'agentSession.setOption',
          sessionId: SESSION,
          fields
        })
      }
    })
  }
  const before = rig.store.getRecord(SESSION)?.options
  expect(await setFast('true')).toMatchObject({
    ok: false,
    refusal: { code: 'agent_session_operation_invalid' }
  })
  expect(rig.store.getRecord(SESSION)?.options).toEqual(before)
  expect(await setFast('false')).toMatchObject({ ok: true })
  expect(rig.store.getRecord(SESSION)?.options?.fastMode).toBe('false')
  expect(rig.adapter.acquire).not.toHaveBeenCalled()
})
