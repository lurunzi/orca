// @vitest-environment happy-dom
import {
  mocks,
  answer,
  mutateWith,
  PROVISIONAL,
  ATTACHED,
  REOPENED,
  renderOptions,
  descriptor,
  setOptionCalls,
  tick
} from './use-structured-agent-session-options.test-fixture'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { forgetStructuredSessionSelection } from '@/lib/structured-agent-session-selection-controller'
import { replaceRuntimeEnvironmentRevisions } from '@/runtime/runtime-environment-revision'
import { resetHostModelCatalogSnapshotsForTests } from '@/runtime/host-model-catalog-snapshots'

describe('useStructuredAgentSessionOptions Fast mode', () => {
  beforeEach(() => {
    mocks.sendSelection = false
    forgetStructuredSessionSelection('session-1')
    mocks.call.mockReset()
    mocks.enqueue.mockReset()
    mocks.hold.mockReset()
    mocks.toastError.mockReset()
    mocks.coherentCatalog = false
    resetHostModelCatalogSnapshotsForTests()
  })

  it.each([false, true])(
    'refreshes a limited session without a new turn (paired: %s)',
    async (paired) => {
      // A paired host answers only once its pairing revision is known.
      replaceRuntimeEnvironmentRevisions(paired ? [{ id: 'server-1', createdAt: 1 }] : [])
      let blocked = false
      answer({
        options: async () => ({
          models: [{ id: 'opus', label: 'Opus', efforts: [], supportsFastMode: true }],
          fastModeSupport: blocked
            ? { supported: false, reason: 'extra_usage_disabled' }
            : { supported: true, accountVerified: true },
          current: { model: 'opus', fastMode: true, fastModeState: 'on', confirmed: ['fastMode'] }
        })
      })
      const mutation = mutateWith(async () => null)
      const { result, unmount } = renderOptions(
        { ...REOPENED, agent: 'claude', paired },
        mutation.mutate
      )
      await waitFor(() =>
        expect(descriptor(result.current.optionSnapshot, 'fastMode')).toMatchObject({
          settable: true
        })
      )
      blocked = true
      act(() => result.current.optionSurface.demandModelCatalog?.())
      await waitFor(() =>
        expect(descriptor(result.current.optionSnapshot, 'fastMode')).toMatchObject({
          settable: false,
          kind: { currentValue: false },
          disabledReason: 'fast-mode-extra-usage-required'
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
          settable: true,
          kind: { currentValue: true }
        })
      )
      expect(descriptor(result.current.optionSnapshot, 'fastMode')?.disabledReason).toBeUndefined()
      unmount()
    }
  )

  it.each([
    { agent: 'claude', paired: false, supportsFastMode: true },
    { agent: 'codex', paired: false, supportsFastMode: true },
    { agent: 'claude', paired: true, supportsFastMode: true },
    { agent: 'codex', paired: true, supportsFastMode: true },
    { agent: 'claude', paired: false, supportsFastMode: undefined },
    { agent: 'claude', paired: true, supportsFastMode: undefined }
  ] as const)(
    'keeps $agent Fast mode after startup (paired: $paired, support: $supportsFastMode)',
    async ({ agent, paired, supportsFastMode }) => {
      // A paired host answers only once its pairing revision is known.
      replaceRuntimeEnvironmentRevisions(paired ? [{ id: 'server-1', createdAt: 1 }] : [])
      const model = agent === 'claude' ? 'opus' : 'gpt-6-astra'
      const models = [{ id: model, label: model, isDefault: true, efforts: [], supportsFastMode }]
      answer({
        modelCatalog: async () => ({ origin: 'probe', models, fetchedAt: 1_000 }),
        options: async () => ({
          models,
          fastModeSupport: { supported: true, accountVerified: true },
          current: { model, fastMode: false, fastModeState: 'off', confirmed: ['fastMode'] }
        })
      })
      const mutation = mutateWith(async () => ({
        key: 'fastMode',
        value: 'true',
        options: { model, fastMode: 'true' }
      }))
      const initial = { ...PROVISIONAL, agent, paired, launchSeedOptions: { model } }
      const { result, rerender, unmount } = renderOptions(initial, mutation.mutate)
      await waitFor(() =>
        expect(descriptor(result.current.optionSnapshot, 'fastMode')).toBeDefined()
      )

      rerender({ ...initial, ...ATTACHED, providerStarting: true })
      await tick()
      expect(descriptor(result.current.optionSnapshot, 'fastMode')).toBeDefined()
      rerender({ ...initial, ...ATTACHED, providerStarting: false, turnId: 'turn-1' })
      await waitFor(() =>
        expect(descriptor(result.current.optionSnapshot, 'fastMode')).toMatchObject({
          kind: { type: 'boolean', currentValue: false },
          valueSource: supportsFastMode ? 'reported' : 'unknown',
          settable: supportsFastMode === true
        })
      )
      await act(async () =>
        expect(await result.current.setStructuredOption('fastMode', true)).toBe(
          supportsFastMode === true
        )
      )
      expect(setOptionCalls(mutation.calls)).toEqual(
        supportsFastMode ? [{ key: 'fastMode', value: 'true' }] : []
      )
      unmount()
    }
  )
})
