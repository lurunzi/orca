import { expect, it } from 'vitest'
import { initialAntigravityChatView } from './antigravity-chat-launch-view'

const local = {
  agent: 'antigravity',
  settings: { experimentalNativeChat: true },
  connectionId: null
}

it.each([null, 'runtime-ssh-env-1'])(
  'opens readable Antigravity transcripts in chat (%s)',
  (connectionId) => {
    expect(initialAntigravityChatView({ ...local, connectionId })).toBe('chat')
  }
)

it('keeps unsupported hosts, disabled chat and other providers on their existing path', () => {
  expect(initialAntigravityChatView({ ...local, connectionId: 'ssh-target-1' })).toBeUndefined()
  expect(initialAntigravityChatView({ ...local, connectionId: undefined })).toBeUndefined()
  expect(
    initialAntigravityChatView({ ...local, settings: { experimentalNativeChat: false } })
  ).toBeUndefined()
  expect(initialAntigravityChatView({ ...local, agent: 'codex' })).toBeUndefined()
})

it('only opens a draft in chat when the composer can safely mirror it', () => {
  expect(initialAntigravityChatView({ ...local, draft: 'Please inspect this' })).toBe('chat')
  expect(initialAntigravityChatView({ ...local, draft: 'a\u2028b' })).toBeUndefined()
})

it('follows the per-agent chat switch under Chat UI', () => {
  const settings = (antigravity: boolean) => ({
    experimentalNativeChat: true,
    nativeChatProviders: { antigravity }
  })
  expect(initialAntigravityChatView({ ...local, settings: settings(false) })).toBeUndefined()
  expect(initialAntigravityChatView({ ...local, settings: settings(true) })).toBe('chat')
})
