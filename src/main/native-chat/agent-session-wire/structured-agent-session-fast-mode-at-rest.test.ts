import { afterEach, expect, it } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import { claudeProviderHandle } from '../../../shared/agent-session-provider-handle-encoding'
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

function catalogListing(modelSupported: boolean) {
  return {
    origin: 'live-session' as const,
    fetchedAt: 1,
    models: [
      { id: 'opus', label: 'Opus', isDefault: true, efforts: [], supportsFastMode: modelSupported }
    ],
    fastModeSupport: { supported: true as const }
  }
}

let rig: RestTestRig | undefined
afterEach(async () => {
  await rig?.dispose()
})

it.each([
  {
    name: 'verified account',
    live: { supported: true, accountVerified: true },
    modelSupported: true,
    expected: { supported: true, accountVerified: true }
  },
  {
    name: 'unverified account',
    live: { supported: true },
    modelSupported: true,
    expected: { supported: true }
  },
  {
    name: 'unsupported model',
    live: { supported: true, accountVerified: true },
    modelSupported: false,
    expected: { supported: false, reason: 'model-not-supported' }
  },
  {
    name: 'restricted account',
    live: { supported: false, reason: 'extra_usage_disabled' },
    modelSupported: true,
    expected: { supported: false, reason: 'extra_usage_disabled' }
  }
] as const)(
  'preserves $name live and refuses enabling Claude Fast at rest',
  async ({ live, modelSupported, expected }) => {
    rig = await createRestTestRig({
      idleSweep: { intervalMs: 3_600_000 },
      modelCatalog: {
        snapshot: () => catalogListing(modelSupported),
        demand: async () => {},
        prepareSaved: async () => catalogListing(modelSupported),
        captureSource: () => () => true,
        retireContext: () => {},
        peek: () => null,
        read: async () => catalogListing(modelSupported),
        recordLiveListing: () => {},
        prewarm: async () => {},
        stop: () => {},
        providerStarted: () => {}
      }
    })
    const providerSessionId = '819cf9f8-e43c-4ad7-b50f-54aa158a726a'
    rig.adapter.readOptions.mockResolvedValue({
      models: [],
      current: { model: 'opus' },
      fastModeSupport: live
    })
    rig.adapter.acquire.mockImplementation(async ({ fence, spawnToken }) => ({
      acquisitionGeneration: 'claude-generation',
      process: { hostId: 'local', pid: 4242, processStartTimeMs: 1, spawnToken },
      link: {
        linkId: 'claude-link',
        handle: claudeProviderHandle(providerSessionId, null),
        origin: 'created' as const,
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
    expect((await rig.host.readOptions(SESSION)).fastModeSupport).toEqual(expected)
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
  }
)
