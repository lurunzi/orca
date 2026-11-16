import { describe, expect, it } from 'vitest'
import { CODEX_SESSION_OPTION_CATALOG } from '../../../agent-session/options/catalog-providers/agent-session-option-catalog-claude-codex'
import { createNativeChatSessionOptionRecord } from './native-chat-session-option-state'
import { buildNativeChatSessionOptionSnapshot } from './native-chat-session-option-snapshot'

describe('model pill without discovered models', () => {
  it('keeps the Codex terminal model pill hidden like upstream', () => {
    expect(
      buildNativeChatSessionOptionSnapshot({
        catalog: CODEX_SESSION_OPTION_CATALOG,
        models: [],
        record: createNativeChatSessionOptionRecord('codex'),
        mode: 'live',
        modelLabel: 'Model',
        liveTransport: 'catalog'
      })
    ).toEqual([])
  })
})
