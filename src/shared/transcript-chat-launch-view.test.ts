import { expect, it } from 'vitest'
import { initialTranscriptChatView } from './transcript-chat-launch-view'

const local = {
  agent: 'antigravity',
  settings: { agentDefaultSurface: 'chat' as const },
  connectionId: null
}

it.each([null, 'runtime-ssh-env-1'])(
  'opens readable Antigravity transcripts in chat (%s)',
  (connectionId) => {
    expect(initialTranscriptChatView({ ...local, connectionId })).toBe('chat')
  }
)

it('keeps unsupported hosts, disabled chat and other providers on their existing path', () => {
  expect(initialTranscriptChatView({ ...local, connectionId: 'ssh-target-1' })).toBeUndefined()
  expect(initialTranscriptChatView({ ...local, connectionId: undefined })).toBeUndefined()
  expect(
    initialTranscriptChatView({
      ...local,
      settings: { agentDefaultSurface: 'terminal' as const }
    })
  ).toBeUndefined()
  expect(initialTranscriptChatView({ ...local, agent: 'codex' })).toBeUndefined()
})

it('only opens a draft in chat when the composer can safely mirror it', () => {
  expect(initialTranscriptChatView({ ...local, draft: 'Please inspect this' })).toBe('chat')
  expect(initialTranscriptChatView({ ...local, draft: 'a\u2028b' })).toBeUndefined()
})

it('follows the per-agent chat switch under Chat UI', () => {
  const settings = (antigravity: boolean) => ({
    agentDefaultSurface: 'chat' as const,
    nativeChatProviders: { antigravity }
  })
  expect(initialTranscriptChatView({ ...local, settings: settings(false) })).toBeUndefined()
  expect(initialTranscriptChatView({ ...local, settings: settings(true) })).toBe('chat')
})

it.each(['cursor', 'antigravity'])('honours the explicit CLI choice for %s', (agent) => {
  expect(initialTranscriptChatView({ ...local, agent })).toBe('chat')
  expect(
    initialTranscriptChatView({ ...local, agent, requestedSurface: 'terminal' })
  ).toBeUndefined()
  expect(
    initialTranscriptChatView({
      ...local,
      agent,
      settings: {
        agentDefaultSurface: 'chat' as const,
        nativeChatProviders: { [agent]: false }
      }
    })
  ).toBeUndefined()
})
