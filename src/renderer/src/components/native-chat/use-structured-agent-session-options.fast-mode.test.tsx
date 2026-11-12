// @vitest-environment happy-dom
import {
  mocks,
  answer,
  mutateWith,
  REOPENED,
  renderOptions,
  descriptor
} from './session/options/structured/use-structured-agent-session-options.test-fixture'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { forgetStructuredSessionSelection } from '@/lib/agent-session/options/structured-agent-session-selection-controller'
import { replaceRuntimeEnvironmentRevisions } from '@/runtime/rpc/environment-revisions/runtime-environment-revision'
import { resetHostModelCatalogSnapshotsForTests } from '@/runtime/native-chat/model-catalogs/host-model-catalog-snapshots'

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
