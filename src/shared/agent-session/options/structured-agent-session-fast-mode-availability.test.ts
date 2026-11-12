import { expect, it } from 'vitest'
import { getAgentSessionOptionCatalog } from './agent-session-option-catalog'
import {
  applyStructuredAgentSessionModelCatalog,
  applyStructuredAgentSessionOptions,
  createStructuredAgentSessionOptionState
} from './structured-agent-session-options'
import {
  canSetStructuredAgentSessionOption,
  structuredAgentSessionOptionSnapshot
} from './structured-agent-session-option-snapshot'

const models = [{ id: 'opus', label: 'Opus', isDefault: true, supportsFastMode: true, efforts: [] }]
const current = { model: 'opus', fastMode: false, confirmed: ['fastMode'] }
const unconfirmed = { supported: false, reason: 'availability-unconfirmed' }

it('shows Claude Fast disabled from a saved catalog until an answer verifies the account', () => {
  const seed = getAgentSessionOptionCatalog('claude')!
  const launch = { newLaunch: true, coherentCatalog: true }
  let state = applyStructuredAgentSessionModelCatalog(
    createStructuredAgentSessionOptionState('claude', seed),
    seed,
    {
      origin: 'live-session',
      models,
      fetchedAt: 1,
      listingNamesConfiguredModel: true,
      fastModeSupport: unconfirmed
    },
    launch
  )
  const fast = () =>
    structuredAgentSessionOptionSnapshot(state).find((item) => item.id === 'fastMode')
  expect(fast()).toMatchObject({ settable: false })
  expect(canSetStructuredAgentSessionOption(state, 'fastMode', true)).toBe(false)

  state = applyStructuredAgentSessionOptions(
    state,
    seed,
    { models, current, fastModeSupport: unconfirmed },
    launch
  )
  expect(fast()).toMatchObject({ settable: false })

  state = applyStructuredAgentSessionOptions(
    state,
    seed,
    { models, current, fastModeSupport: { supported: true } },
    launch
  )
  expect(fast()).toMatchObject({ settable: true })
  expect(canSetStructuredAgentSessionOption(state, 'fastMode', true)).toBe(true)
})

it('keeps Fast visible but disabled for a Claude model with unknown capability', () => {
  const seed = getAgentSessionOptionCatalog('claude')!
  const result = {
    models: [{ id: 'fable', label: 'Fable 5.1', isDefault: true, efforts: [] }],
    current: { model: 'fable' },
    fastModeSupport: { supported: true }
  }
  let state = applyStructuredAgentSessionOptions(
    createStructuredAgentSessionOptionState('claude'),
    seed,
    result
  )
  const fast = () =>
    structuredAgentSessionOptionSnapshot(state).find((item) => item.id === 'fastMode')
  expect(fast()).toMatchObject({ settable: false, kind: { currentValue: false } })
  expect(canSetStructuredAgentSessionOption(state, 'fastMode', true)).toBe(false)

  state = applyStructuredAgentSessionOptions(state, seed, {
    ...result,
    models: result.models.map((model) => ({ ...model, supportsFastMode: true }))
  })
  expect(fast()).toMatchObject({ settable: true })
  expect(canSetStructuredAgentSessionOption(state, 'fastMode', true)).toBe(true)
})
