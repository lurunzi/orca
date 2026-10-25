import { expect, it } from 'vitest'
import { buildNewTabAgentMenuRows } from './new-tab-agent-menu-rows'

const input = {
  detectedOnHost: ['claude', 'antigravity', 'gemini'] as const,
  chatAgents: ['claude', 'antigravity'] as const,
  chatProgram: () => 'available' as const,
  hostChatAnswer: (agent: string): 'not-on-host' | 'yes' =>
    agent === 'antigravity' ? 'not-on-host' : 'yes'
}

it('lists Antigravity with the chats when its terminal opens the transcript chat', () => {
  expect(
    buildNewTabAgentMenuRows({ ...input, settings: { experimentalNativeChat: true } })
  ).toEqual([
    { kind: 'chat', agent: 'claude' },
    { kind: 'cli', agent: 'antigravity', opensTranscriptChat: true },
    { kind: 'cli', agent: 'gemini' }
  ])
})

it('keeps Antigravity a CLI row once its own chat switch is off', () => {
  expect(
    buildNewTabAgentMenuRows({
      ...input,
      settings: { experimentalNativeChat: true, nativeChatProviders: { antigravity: false } }
    })
  ).toEqual([
    { kind: 'chat', agent: 'claude' },
    { kind: 'cli', agent: 'gemini' },
    { kind: 'cli', agent: 'antigravity' }
  ])
})

it('lists installed Cursor with chats even without a structured Cursor adapter', () => {
  expect(
    buildNewTabAgentMenuRows({
      settings: { experimentalNativeChat: true },
      detectedOnHost: ['cursor'],
      chatAgents: [],
      hostChatAnswer: () => 'not-on-host',
      chatProgram: () => 'available'
    })
  ).toEqual([{ kind: 'cli', agent: 'cursor', opensTranscriptChat: true }])
})

it.each(['ssh', 'wsl'] as const)('keeps transcript agents as CLI on %s', (host) => {
  expect(
    buildNewTabAgentMenuRows({
      settings: { experimentalNativeChat: true },
      detectedOnHost: ['cursor'],
      chatAgents: [],
      hostChatAnswer: () => host,
      chatProgram: () => 'available'
    })
  ).toEqual([{ kind: 'cli', agent: 'cursor' }])
})
