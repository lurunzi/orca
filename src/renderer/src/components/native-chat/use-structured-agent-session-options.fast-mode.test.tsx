// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClientTarget } from '../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type { SessionOptionDescriptor } from '../../../../shared/native-chat/input/native-chat-session-options'
import type * as HostCapability from '@/runtime/native-chat/host-capabilities/structured-agent-session-host-capability'
import type * as LaunchOptions from '@/lib/agent-session/launch/structured-agent-session-launch-options'
import { forgetStructuredSessionSelection } from '@/lib/agent-session/options/structured-agent-session-selection-controller'
import { replaceRuntimeEnvironmentRevisions } from '@/runtime/rpc/environment-revisions/runtime-environment-revision'
import { resetHostModelCatalogSnapshotsForTests } from '@/runtime/native-chat/model-catalogs/host-model-catalog-snapshots'
import { useStructuredAgentSessionOptionStamp } from './session/status/structured-agent-session-status-hooks'
import {
  useStructuredAgentSessionMutate,
  type StructuredAgentSessionMutate
} from './session/structured/writes/use-structured-agent-session-mutate'
import { useStructuredAgentSessionOptions } from './session/options/structured/use-structured-agent-session-options'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  subscribeStatus: vi.fn(async () => ({ unsubscribe: vi.fn() })),
  enqueue: vi.fn(),
  pick: vi.fn(),
  toastError: vi.fn<(message: string) => void>(),
  coherentCatalog: false
}))

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock(
  '@/runtime/native-chat/host-capabilities/structured-agent-session-host-capability',
  async () => {
    const actual = await vi.importActual<typeof HostCapability>(
      '@/runtime/native-chat/host-capabilities/structured-agent-session-host-capability'
    )
    return {
      ...actual,
      useStructuredAgentSessionHostCapability: (
        target: RuntimeClientTarget,
        capability: Parameters<typeof actual.useStructuredAgentSessionHostCapability>[1]
      ) =>
        (mocks.coherentCatalog && capability === 'agent-session.coherent-model-catalog.v1') ||
        actual.useStructuredAgentSessionHostCapability(target, capability)
    }
  }
)
vi.mock('@/runtime/native-chat/requests/structured-agent-session-subscriptions', () => ({
  subscribeStructuredAgentSessionStatus: mocks.subscribeStatus
}))
vi.mock('@/runtime/native-chat/requests/structured-agent-session-call', () => ({
  callStructuredAgentSession: mocks.call
}))
vi.mock('./session/options/native-chat-session-option-settings-write', () => ({
  enqueueSessionOptionSettingsWrite: mocks.enqueue
}))
vi.mock('@/lib/agent-session/launch/structured-agent-session-launch-options', async () => ({
  ...(await vi.importActual<typeof LaunchOptions>(
    '@/lib/agent-session/launch/structured-agent-session-launch-options'
  )),
  holdStructuredAgentSessionLaunchOption: () => null,
  getStructuredAgentSessionLaunchSelection: () => null
}))

const LOCAL_TARGET = { kind: 'local' } as const
const PAIRED_TARGET = { kind: 'environment', environmentId: 'server-1' } as const

function answer(answers: {
  options: () => Promise<unknown>
  modelCatalog: () => Promise<unknown>
}): void {
  mocks.call.mockImplementation(
    async (
      _target: RuntimeClientTarget,
      method: string,
      params: { key: string; value: string }
    ) => {
      if (method === 'agentSession.setOption') {
        const value = await mocks.pick(method, method, { key: params.key, value: params.value })
        return value ? { ok: true, value } : Promise.reject(new Error('Unconfirmed option write'))
      }
      if (method === 'agentSession.options') {
        return answers.options()
      }
      if (method === 'agentSession.modelCatalog') {
        return answers.modelCatalog()
      }
      return new Promise(() => {})
    }
  )
}

type MutateCall = (...args: unknown[]) => Promise<unknown>

function mutateWith(reply: MutateCall): {
  mutate: StructuredAgentSessionMutate
  calls: ReturnType<typeof vi.fn<MutateCall>>
} {
  const calls = vi.fn<MutateCall>(reply)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each reply is null or the AgentSessionOptionResult shape the hook reads.
  return { mutate: calls as unknown as StructuredAgentSessionMutate, calls }
}

function renderOptions(
  initial: { agent: 'claude'; paired: boolean },
  mutate: StructuredAgentSessionMutate
) {
  mocks.pick.mockImplementation(mutate)
  const target = initial.paired ? PAIRED_TARGET : LOCAL_TARGET
  return renderHook(() => {
    useStructuredAgentSessionMutate({
      sessionId: 'session-1',
      target,
      stateRef: { current: { fence: 1 } },
      enabled: true
    })
    const hostOptionStamp = useStructuredAgentSessionOptionStamp('session-1', target)
    return useStructuredAgentSessionOptions({
      hostOptionStamp,
      agent: initial.agent,
      sessionId: 'session-1',
      target,
      transportEnabled: true,
      isVisible: true,
      providerVisible: true,
      fence: 1,
      turnId: null,
      unloadedTurnRevisions: undefined,
      mutate
    })
  })
}

function descriptor(snapshot: readonly SessionOptionDescriptor[], id: string) {
  return snapshot.find((entry) => entry.id === id)
}

describe('useStructuredAgentSessionOptions Fast mode', () => {
  beforeEach(() => {
    forgetStructuredSessionSelection('session-1')
    mocks.call.mockReset()
    mocks.enqueue.mockReset()
    mocks.toastError.mockReset()
    mocks.coherentCatalog = false
    resetHostModelCatalogSnapshotsForTests()
  })

  it.each([false, true])(
    'refreshes a limited session without a new turn (paired: %s)',
    async (paired) => {
      // A paired host answers only once its pairing revision is known.
      replaceRuntimeEnvironmentRevisions(paired ? [{ id: 'server-1', createdAt: 1 }] : [])
      mocks.coherentCatalog = true
      let blocked = false
      const models = [{ id: 'opus', label: 'Opus', efforts: [], supportsFastMode: true }]
      answer({
        modelCatalog: async () => ({
          origin: 'probe',
          models,
          fetchedAt: 1_000,
          fastModeSupport: { supported: false, reason: 'availability-unconfirmed' }
        }),
        options: async () => ({
          models,
          fastModeSupport: blocked
            ? { supported: false, reason: 'extra_usage_disabled' }
            : { supported: true },
          current: { model: 'opus', fastMode: true, fastModeState: 'on', confirmed: ['fastMode'] }
        })
      })
      const mutation = mutateWith(async () => null)
      const { result, unmount } = renderOptions({ agent: 'claude', paired }, mutation.mutate)
      await waitFor(() =>
        expect(descriptor(result.current.optionSnapshot, 'fastMode')).toMatchObject({
          settable: true
        })
      )
      blocked = true
      act(() => result.current.optionSurface.demandModelCatalog?.())
      await waitFor(() =>
        expect(descriptor(result.current.optionSnapshot, 'fastMode')).toMatchObject({
          settable: false
        })
      )
      await act(async () =>
        expect(await result.current.setStructuredOption('fastMode', true)).toBe(false)
      )
      expect(mutation.calls).not.toHaveBeenCalled()
      blocked = false
      act(() => result.current.optionSurface.demandModelCatalog?.())
      await waitFor(() =>
        expect(descriptor(result.current.optionSnapshot, 'fastMode')).toMatchObject({
          settable: true
        })
      )
      unmount()
    }
  )
})
