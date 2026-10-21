import { describe, expect, it } from 'vitest'
import { launchPromptAsMessage, shouldPruneLaunchPrompt } from './native-chat-pending'
import { matchesCursorLaunchPromptEcho } from './cursor-launch-prompt-echo'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'

const prefix = 'Continue work from the prior Orca session using the context below.\n'.repeat(3)
const text = `${prefix}在两次查询之间，保留进程。\nInspect the current repository state.`
const damaged = text.replace('间', '\uFFFD\uFFFD\uFFFD')
const entry = { tabId: 'cursor-tab', agent: 'cursor' as const, text, createdAt: 2000 }

function cursorUser(content: string): NativeChatMessage {
  return {
    id: 'cursor-user',
    role: 'user',
    blocks: [{ type: 'text', text: content }],
    timestamp: null,
    source: 'transcript'
  }
}

const assistant: NativeChatMessage = {
  id: 'assistant',
  role: 'assistant',
  blocks: [{ type: 'text', text: 'Continuing.' }],
  timestamp: null,
  source: 'transcript'
}

describe('Cursor launch echo retirement', () => {
  it('hides the damaged first-turn echo, retires it after progress and preserves the real record', () => {
    const user = cursorUser(damaged)
    expect(launchPromptAsMessage(entry, [user])).toBeNull()
    expect(shouldPruneLaunchPrompt(entry, [user])).toBe(false)
    expect(shouldPruneLaunchPrompt(entry, [user, assistant])).toBe(true)
    expect(user.blocks).toEqual([{ type: 'text', text: damaged }])
  })

  it('does not infer delivery from another provider, older turn, or a later user message', () => {
    const user = cursorUser(damaged)
    for (const candidate of [
      [{ ...user, timestamp: 1000 }, assistant],
      [cursorUser('a different opening prompt'), user, assistant]
    ]) {
      expect(launchPromptAsMessage(entry, candidate)).not.toBeNull()
      expect(shouldPruneLaunchPrompt(entry, candidate)).toBe(false)
    }
    expect(launchPromptAsMessage({ ...entry, agent: 'claude' }, [user])).not.toBeNull()
  })

  it.each(['é', '间', '😀'])(
    'recognizes one byte-replaced %s in an otherwise exact long prompt',
    (character) => {
      const original = `${prefix}${character} unchanged suffix`
      const recorded = original.replace(
        character,
        '\uFFFD'.repeat(new TextEncoder().encode(character).length)
      )
      expect(matchesCursorLaunchPromptEcho(original, recorded)).toBe(true)
    }
  )

  it.each([
    [text, damaged.replace('Inspect', 'Delete')],
    [text, `${damaged} extra`],
    [text, text.replace('间', '\uFFFD\uFFFD')],
    [text, damaged.replace('保', '\uFFFD\uFFFD\uFFFD')],
    ['之间', '之\uFFFD\uFFFD\uFFFD'],
    [`${prefix}abc`, `${prefix}\uFFFD\uFFFD\uFFFD`]
  ])('refuses a non-identical, ambiguous, or short prompt', (original, recorded) => {
    expect(matchesCursorLaunchPromptEcho(original, recorded)).toBe(false)
  })
})
