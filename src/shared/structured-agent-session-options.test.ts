import { describe, expect, it } from 'vitest'
import { CODEX_SESSION_OPTION_CATALOG } from './agent-session-option-catalog-claude-codex'
import { buildNativeChatSessionOptionSnapshot } from './native-chat-session-option-snapshot'
import { createNativeChatSessionOptionRecord } from './native-chat-session-option-state'
import {
  applyStructuredAgentSessionOptions,
  canSetStructuredAgentSessionOption,
  createStructuredAgentSessionOptionState,
  structuredAgentSessionOptionSnapshot,
  structuredAgentSessionOptionView
} from './structured-agent-session-options'

function viewModel(...args: Parameters<typeof structuredAgentSessionOptionView>) {
  const model = structuredAgentSessionOptionSnapshot(
    structuredAgentSessionOptionView(...args)
  ).find((descriptor) => descriptor.id === 'model')
  return model?.kind.type === 'select' ? model.kind.currentValue : undefined
}

describe('structured agent session options', () => {
  it.each(['extra_usage_disabled', 'rate_limit', 'insufficient_credits', 'future_limit'])(
    'shows Fast off during %s and follows the provider on recovery',
    (reason) => {
      const options = {
        models: [
          { id: 'opus', label: 'Opus', isDefault: true, efforts: [], supportsFastMode: true }
        ],
        current: { model: 'opus', fastMode: true, confirmed: ['fastMode'] }
      }
      let state = applyStructuredAgentSessionOptions(
        createStructuredAgentSessionOptionState('claude'),
        CODEX_SESSION_OPTION_CATALOG,
        options
      )
      state = applyStructuredAgentSessionOptions(state, CODEX_SESSION_OPTION_CATALOG, {
        ...options,
        fastModeSupport: { supported: false, reason },
        current: { ...options.current, fastModeState: 'cooldown' }
      })
      expect(structuredAgentSessionOptionSnapshot(state)).toContainEqual(
        expect.objectContaining({
          id: 'fastMode',
          kind: { type: 'boolean', currentValue: false },
          settable: false,
          disabledReason:
            reason === 'extra_usage_disabled'
              ? 'fast-mode-extra-usage-required'
              : 'fast-mode-unavailable'
        })
      )
      expect(canSetStructuredAgentSessionOption(state, 'fastMode', true)).toBe(false)
      state = applyStructuredAgentSessionOptions(state, CODEX_SESSION_OPTION_CATALOG, {
        ...options,
        fastModeSupport: { supported: true },
        current: { ...options.current, fastModeState: 'cooldown' }
      })
      const recovered = structuredAgentSessionOptionSnapshot(state).find((d) => d.id === 'fastMode')
      expect(recovered).toMatchObject({ kind: { currentValue: true }, settable: true })
      expect(recovered?.disabledReason).toBeUndefined()
      expect(canSetStructuredAgentSessionOption(state, 'fastMode', false)).toBe(true)
    }
  )

  it('projects native Codex selects while bridge Codex keeps its agent picker', () => {
    const state = applyStructuredAgentSessionOptions(
      createStructuredAgentSessionOptionState('codex'),
      CODEX_SESSION_OPTION_CATALOG,
      {
        models: [
          {
            id: 'account-model',
            label: 'Account Model',
            isDefault: true,
            defaultEffort: 'medium',
            efforts: [
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' }
            ]
          }
        ],
        current: { model: 'account-model', effort: 'medium' }
      }
    )

    const structured = structuredAgentSessionOptionSnapshot(state)
    expect(structured.map((descriptor) => descriptor.id)).toEqual(['model', 'effort'])
    expect(structured[0]).toMatchObject({
      settable: true,
      kind: { type: 'select', currentValue: 'account-model' }
    })
    expect(structured[0]).not.toHaveProperty('action')
    expect(structured[1]).toMatchObject({
      settable: true,
      kind: { type: 'select', currentValue: 'medium' }
    })

    const bridgeRecord = createNativeChatSessionOptionRecord('codex')
    bridgeRecord.model = { value: 'gpt-5.6-sol', source: 'reported' }
    const bridge = buildNativeChatSessionOptionSnapshot({
      catalog: CODEX_SESSION_OPTION_CATALOG,
      models: CODEX_SESSION_OPTION_CATALOG.models,
      record: bridgeRecord,
      mode: 'live',
      modelLabel: 'Model',
      liveTransport: 'catalog'
    })
    // Same catalog, same `dispatched` vocabulary — only the transport separates them.
    expect(structured.every((descriptor) => descriptor.transport === 'agent-session')).toBe(true)
    expect(bridge.every((descriptor) => descriptor.transport === 'catalog')).toBe(true)
    expect(bridge[0]).toMatchObject({ action: { type: 'agent-picker' } })
    expect(bridge.find((descriptor) => descriptor.id === 'effort')).toMatchObject({
      action: { type: 'agent-picker' }
    })
  })

  it('uses provider-scoped models and retains the current unknown id', () => {
    const state = applyStructuredAgentSessionOptions(
      createStructuredAgentSessionOptionState('codex'),
      CODEX_SESSION_OPTION_CATALOG,
      {
        models: [
          {
            id: 'account-model',
            label: 'Account Model',
            isDefault: false,
            efforts: []
          }
        ],
        current: { model: 'persisted-unknown' }
      }
    )
    const model = structuredAgentSessionOptionSnapshot(state)[0]
    expect(
      model.kind.type === 'select' ? model.kind.choices.map((choice) => choice.value) : []
    ).toEqual(['account-model', 'persisted-unknown'])
    expect(model.kind.type === 'select' ? model.kind.currentValue : null).toBe('persisted-unknown')
  })

  it('projects live options as directly settable descriptors', () => {
    const state = applyStructuredAgentSessionOptions(
      createStructuredAgentSessionOptionState('codex'),
      CODEX_SESSION_OPTION_CATALOG,
      {
        models: [
          {
            id: 'account-model',
            label: 'Account Model',
            isDefault: true,
            defaultEffort: 'medium',
            efforts: [
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' }
            ]
          }
        ],
        current: { model: 'account-model', effort: 'medium' }
      }
    )

    const snapshot = structuredAgentSessionOptionSnapshot(state)
    expect(snapshot.map((descriptor) => descriptor.id)).toEqual(['model', 'effort'])
    expect(snapshot.every((descriptor) => descriptor.settable)).toBe(true)
    expect(snapshot.every((descriptor) => descriptor.action === undefined)).toBe(true)
  })

  it('keeps advertised Fast mode when session support is temporarily unknown', () => {
    const supported = applyStructuredAgentSessionOptions(
      createStructuredAgentSessionOptionState('codex'),
      CODEX_SESSION_OPTION_CATALOG,
      {
        models: [
          {
            id: 'account-model',
            label: 'Account Model',
            isDefault: true,
            efforts: [],
            supportsFastMode: true
          }
        ],
        fastModeSupport: { supported: true },
        current: { model: 'account-model', fastMode: false, confirmed: ['fastMode'] }
      }
    )
    expect(structuredAgentSessionOptionSnapshot(supported)).toContainEqual(
      expect.objectContaining({
        id: 'fastMode',
        kind: { type: 'boolean', currentValue: false },
        valueSource: 'reported',
        settable: true
      })
    )

    const absent = applyStructuredAgentSessionOptions(supported, CODEX_SESSION_OPTION_CATALOG, {
      models: [
        {
          id: 'account-model',
          label: 'Account Model',
          isDefault: true,
          efforts: [],
          supportsFastMode: true
        }
      ],
      current: { model: 'account-model' }
    })
    expect(structuredAgentSessionOptionSnapshot(absent)).toContainEqual(
      expect.objectContaining({ id: 'fastMode', valueSource: 'unknown', settable: true })
    )
    expect(absent.record.valuesByModel['account-model']?.fastMode).toBeUndefined()
  })

  it.each([
    { modelSupport: false, sessionSupport: true },
    { modelSupport: undefined, sessionSupport: true },
    { modelSupport: undefined, sessionSupport: undefined }
  ])(
    'does not invent Fast support for $modelSupport / $sessionSupport',
    ({ modelSupport, sessionSupport }) => {
      const state = applyStructuredAgentSessionOptions(
        createStructuredAgentSessionOptionState('codex'),
        CODEX_SESSION_OPTION_CATALOG,
        {
          models: [
            {
              id: 'account-model',
              label: 'Account Model',
              isDefault: true,
              efforts: [],
              ...(modelSupport === undefined ? {} : { supportsFastMode: modelSupport })
            }
          ],
          ...(sessionSupport === undefined
            ? {}
            : { fastModeSupport: { supported: sessionSupport } }),
          current: { model: 'account-model' }
        }
      )
      expect(structuredAgentSessionOptionSnapshot(state).some(({ id }) => id === 'fastMode')).toBe(
        false
      )
    }
  )

  it('renders Fast off but marked unreported when support is known and no value is', () => {
    const state = applyStructuredAgentSessionOptions(
      createStructuredAgentSessionOptionState('codex'),
      CODEX_SESSION_OPTION_CATALOG,
      {
        models: [
          {
            id: 'account-model',
            label: 'Account Model',
            isDefault: true,
            efforts: [],
            supportsFastMode: true
          }
        ],
        fastModeSupport: { supported: true },
        current: { model: 'account-model' }
      }
    )

    // The switch has no third position, so the value resolves to the catalog's
    // own `false`. `unknown` is what stops any surface calling that a default:
    // `default` is unreachable in this lane (it is hardcoded `mode: 'live'`), and
    // nothing here has reported the tier the thread is actually routing.
    expect(structuredAgentSessionOptionSnapshot(state)).toContainEqual(
      expect.objectContaining({
        id: 'fastMode',
        kind: { type: 'boolean', currentValue: false },
        valueSource: 'unknown'
      })
    )
  })

  it('shows the launch seed until the record names a model, and held picks over both', () => {
    const seeded = createStructuredAgentSessionOptionState('codex', CODEX_SESSION_OPTION_CATALOG)
    const seed = { model: 'gpt-5.5' }
    expect(viewModel(seeded, seed, {})).toBe('gpt-5.5')
    // A model outside the static list still gets a labelled row.
    expect(viewModel(seeded, { model: 'gpt-next' }, {})).toBe('gpt-next')
    // Derived only: the record itself never takes the seed.
    expect(seeded.record.model).toBeUndefined()
    const live = applyStructuredAgentSessionOptions(seeded, CODEX_SESSION_OPTION_CATALOG, {
      models: [{ id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', isDefault: true, efforts: [] }],
      current: { model: 'gpt-5.6-luna', confirmed: ['model'] }
    })
    expect(viewModel(live, seed, {})).toBe('gpt-5.6-luna')
    expect(viewModel(live, seed, { model: 'gpt-5.5' })).toBe('gpt-5.5')
    expect(live.record.model?.value).toBe('gpt-5.6-luna')
  })
})
