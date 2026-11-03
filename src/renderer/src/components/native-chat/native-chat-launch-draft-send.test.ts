import { describe, expect, it } from 'vitest'
import {
  agentComposerPainted,
  resolveNativeChatLaunchDraftSend
} from './native-chat-launch-draft-send'

const SEEDED = 'Linked Linear issue: ABC-123\nhttps://linear.app/x/issue/ABC-123'

/** Claude's frame: the input line and its continuation rows sit last. */
const screenHoldingDraft = [
  '  ▘▘ ▝▝    ~/repo',
  '────────────────────────────────────────',
  '❯ Linked Linear issue: ABC-123',
  '  https://linear.app/x/issue/ABC-123',
  '────────────────────────────────────────'
].join('\n')

const screenPlaceholder = [
  '  ▘▘ ▝▝    ~/repo',
  '────────────────────────────────────────',
  '❯ Try "create a util logging.py that..."',
  '────────────────────────────────────────'
].join('\n')

describe('agentComposerPainted', () => {
  it('waits for the composer frame to close the prompt row', () => {
    expect(agentComposerPainted(screenHoldingDraft)).toBe(true)
    expect(agentComposerPainted(screenPlaceholder)).toBe(true)
    expect(
      agentComposerPainted(
        ['────────────', '❯ Linked Linear issue: ABC-123', '  https://lin'].join('\n')
      )
    ).toBe(false)
  })

  it('does not mistake the launching shell for the composer', () => {
    const shell = ["❯ claude --prefill 'Linked Linear issue: ABC-123", "> https://linear.app/x'"]
    expect(agentComposerPainted(shell.join('\n'))).toBe(false)
    expect(agentComposerPainted(null)).toBe(false)
  })

  it('accepts a Codex prompt closed by its footer', () => {
    expect(
      agentComposerPainted(['› Linked Linear issue', '', '  gpt-5 high · 100% left'].join('\n'))
    ).toBe(true)
  })
})

describe('resolveNativeChatLaunchDraftSend composer readiness', () => {
  const resolve = (screen: string | null) =>
    resolveNativeChatLaunchDraftSend({
      launchDraft: { agent: 'claude', text: SEEDED },
      launchDraftResolved: false,
      agent: 'claude',
      readInputLine: () => '',
      readScreen: () => screen
    }).sendOptions?.composerReady()

  it('holds a draft replacement until the composer is painted', () => {
    expect(resolve('$ claude --prefill ...')).toBe(false)
    expect(resolve(screenHoldingDraft)).toBe(true)
  })

  it('does not hold a send it cannot observe', () => {
    expect(resolve(null)).toBe(true)
  })
})
