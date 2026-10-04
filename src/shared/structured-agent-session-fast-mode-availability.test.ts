import { expect, it } from 'vitest'
import { getAgentSessionOptionCatalog } from './agent-session-option-catalog'
import {
  applyStructuredAgentSessionModelCatalog,
  applyStructuredAgentSessionOptions,
  createStructuredAgentSessionOptionState,
  structuredAgentSessionOptionSnapshot
} from './structured-agent-session-options'

const models = [{ id: 'opus', label: 'Opus', isDefault: true, supportsFastMode: true, efforts: [] }]
const current = { model: 'opus', fastMode: true, confirmed: ['fastMode'] }

it('keeps Claude Fast off and unavailable across cached and older-host answers', () => {
  const seed = getAgentSessionOptionCatalog('claude')!
  let state = applyStructuredAgentSessionModelCatalog(
    createStructuredAgentSessionOptionState('claude', seed),
    seed,
    { origin: 'live-session', models, fetchedAt: 1, fastModeSupport: { supported: true } },
    { namesDefault: true }
  )
  const fast = () =>
    structuredAgentSessionOptionSnapshot(state).find((item) => item.id === 'fastMode')
  expect(fast()).toMatchObject({ settable: false, kind: { currentValue: false } })
  state = applyStructuredAgentSessionOptions(state, seed, {
    models,
    current,
    fastModeSupport: { supported: true }
  })
  expect(fast()).toMatchObject({
    settable: false,
    kind: { currentValue: false },
    disabledReason: 'fast-mode-availability-unconfirmed'
  })
  state = applyStructuredAgentSessionOptions(state, seed, {
    models,
    current: { ...current, fastModeState: 'off' },
    fastModeSupport: { supported: false, reason: 'extra_usage_disabled' }
  })
  expect(fast()).toMatchObject({
    settable: false,
    kind: { currentValue: false },
    disabledReason: 'fast-mode-extra-usage-required'
  })
  state = applyStructuredAgentSessionOptions(state, seed, {
    models,
    current: { ...current, fastModeState: 'on' },
    fastModeSupport: { supported: true }
  })
  expect(fast()).toMatchObject({ settable: true, kind: { currentValue: true } })
})

it('leaves Codex availability independent of Claude routing state', () => {
  const seed = getAgentSessionOptionCatalog('codex')!
  const state = applyStructuredAgentSessionOptions(
    createStructuredAgentSessionOptionState('codex'),
    seed,
    {
      models,
      current,
      fastModeSupport: { supported: true }
    }
  )
  expect(
    structuredAgentSessionOptionSnapshot(state).find((item) => item.id === 'fastMode')
  ).toMatchObject({
    settable: true,
    kind: { currentValue: true }
  })
})
