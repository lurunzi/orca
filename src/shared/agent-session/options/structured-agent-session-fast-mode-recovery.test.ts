import { describe, expect, it } from 'vitest'
import { CODEX_SESSION_OPTION_CATALOG } from './agent-session-option-catalog-claude-codex'
import {
  applyStructuredAgentSessionOptions,
  createStructuredAgentSessionOptionState
} from './structured-agent-session-options'
import {
  canSetStructuredAgentSessionOption,
  structuredAgentSessionOptionSnapshot
} from './structured-agent-session-option-snapshot'

describe('structured Fast mode availability recovery', () => {
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
        fastModeSupport: { supported: true, accountVerified: true },
        current: { ...options.current, fastModeState: 'cooldown' }
      })
      const recovered = structuredAgentSessionOptionSnapshot(state).find((d) => d.id === 'fastMode')
      expect(recovered).toMatchObject({ kind: { currentValue: true }, settable: true })
      expect(recovered?.disabledReason).toBeUndefined()
      expect(canSetStructuredAgentSessionOption(state, 'fastMode', false)).toBe(true)
    }
  )

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
    expect(absent.record.values.fastMode).toBeUndefined()
  })
})
