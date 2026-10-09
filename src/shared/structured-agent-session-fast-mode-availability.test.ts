import { expect, it } from 'vitest'
import { getAgentSessionOptionCatalog } from './agent-session-option-catalog'
import {
  applyStructuredAgentSessionModelCatalog,
  applyStructuredAgentSessionOptions,
  canSetStructuredAgentSessionOption,
  commitStructuredAgentSessionOption,
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
  for (const fastModeState of ['off', 'on', 'cooldown'] as const) {
    state = applyStructuredAgentSessionOptions(state, seed, {
      models,
      current: { ...current, fastModeState },
      fastModeSupport: { supported: true }
    })
    expect(fast()).toMatchObject({ settable: false, kind: { currentValue: false } })
  }
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
    fastModeSupport: { supported: true, accountVerified: true }
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

it.each([undefined, false, true])(
  'keeps unconfirmed Claude model capability disabled with account support %s',
  (accountSupport) => {
    const seed = getAgentSessionOptionCatalog('claude')!
    const result = {
      models: [{ id: 'fable', label: 'Fable 5.1', isDefault: true, efforts: [] }],
      current: { model: 'fable', fastMode: true, confirmed: ['fastMode'] },
      ...(accountSupport === undefined
        ? {}
        : { fastModeSupport: { supported: accountSupport, accountVerified: true } })
    }
    let state = applyStructuredAgentSessionOptions(
      createStructuredAgentSessionOptionState('claude'),
      seed,
      result
    )
    const fast = () =>
      structuredAgentSessionOptionSnapshot(state).find((item) => item.id === 'fastMode')
    expect(fast()).toMatchObject({
      settable: false,
      kind: { currentValue: false },
      valueSource: 'unknown',
      disabledReason: 'fast-mode-availability-unconfirmed'
    })
    expect(canSetStructuredAgentSessionOption(state, 'fastMode', true)).toBe(false)

    state = applyStructuredAgentSessionOptions(state, seed, {
      ...result,
      models: result.models.map((model) => ({ ...model, supportsFastMode: true })),
      fastModeSupport: { supported: true, accountVerified: true }
    })
    expect(fast()).toMatchObject({ settable: true, kind: { currentValue: true } })
    expect(canSetStructuredAgentSessionOption(state, 'fastMode', false)).toBe(true)

    state = applyStructuredAgentSessionOptions(state, seed, result)
    expect(fast()).toMatchObject({ settable: false, kind: { currentValue: false } })
    expect(canSetStructuredAgentSessionOption(state, 'fastMode', true)).toBe(false)
  }
)

it('keeps capability tied to the selected model through cached and live catalogs', () => {
  const seed = getAgentSessionOptionCatalog('claude')!
  const catalogModels = [
    { id: 'fable', label: 'Fable 5.1', isDefault: true, efforts: [] },
    {
      id: 'unsupported',
      label: 'Unsupported',
      isDefault: false,
      supportsFastMode: false,
      efforts: []
    },
    ...models
  ]
  let state = applyStructuredAgentSessionModelCatalog(
    createStructuredAgentSessionOptionState('claude', seed),
    seed,
    { origin: 'live-session', models: catalogModels, fetchedAt: 1 },
    { namesDefault: true }
  )
  const fast = () =>
    structuredAgentSessionOptionSnapshot(state).find((item) => item.id === 'fastMode')
  expect(fast()).toMatchObject({ settable: false })
  state = commitStructuredAgentSessionOption(state, 'model', 'unsupported')
  expect(fast()).toBeUndefined()
  state = commitStructuredAgentSessionOption(state, 'model', 'fable')
  expect(fast()).toMatchObject({ settable: false })
  state = applyStructuredAgentSessionOptions(state, seed, {
    models: catalogModels,
    current: { model: 'opus' },
    fastModeSupport: { supported: true, accountVerified: true }
  })
  expect(fast()).toMatchObject({ settable: true })
  state = commitStructuredAgentSessionOption(state, 'model', 'fable')
  expect(fast()).toMatchObject({ settable: false })
  state = commitStructuredAgentSessionOption(state, 'model', 'unsupported')
  expect(fast()).toBeUndefined()
})

it('does not add a Claude Fast control from a static seed alone', () => {
  const state = createStructuredAgentSessionOptionState(
    'claude',
    getAgentSessionOptionCatalog('claude')
  )
  expect(structuredAgentSessionOptionSnapshot(state).some((item) => item.id === 'fastMode')).toBe(
    false
  )
})
