import { describe, expect, it, vi } from 'vitest'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import { claudeAndCodexRouter } from './structured-agent-session-adapter-router-test-support'
import {
  claudeProviderHandle,
  codexProviderHandle
} from '../../../shared/agent-session-provider-handle-encoding'

function harness(agent: 'claude' | 'codex') {
  let suggestion: string | null = 'Inspect the changes'
  const handle =
    agent === 'claude' ? claudeProviderHandle('thread', null) : codexProviderHandle('thread')
  const adapter: StructuredAgentSessionAdapter = {
    acquire: vi.fn<StructuredAgentSessionAdapter['acquire']>(async ({ fence, spawnToken }) => ({
      process: { hostId: 'local', pid: 1, processStartTimeMs: 1, spawnToken },
      acquisitionGeneration: `generation-${fence}`,
      link: {
        linkId: `link-${fence}`,
        handle,
        origin: 'created',
        mintedAtFence: fence,
        observedAt: 1
      }
    })),
    open: vi.fn(async () => ({ reportedOptions: {} })),
    dispatch: vi.fn(),
    cancelTurn: vi.fn(),
    answerPrompt: vi.fn(),
    setOption: vi.fn(),
    readPromptSuggestion: () => suggestion,
    forceCloseSession: vi.fn(async () => {
      suggestion = null
      return true
    })
  }
  const router = claudeAndCodexRouter({ claude: adapter, codex: adapter }, async () => {})
  const identity = {
    sessionId: 'chat',
    workspaceId: 'folder',
    hostId: 'local',
    agent,
    providerHandle: handle
  }
  return {
    router,
    adapter,
    identity,
    clear: () => {
      suggestion = null
    }
  }
}

describe.each(['claude', 'codex'] as const)('%s coordinator restart suggestion', (agent) => {
  it('keeps the suggestion through provider teardown and route release, until the next acquisition', async () => {
    const { router, adapter, identity, clear } = harness(agent)
    await router.acquire({ identity, fence: 1, spawnToken: 'first' })
    adapter.forceCloseSession = async () => {
      clear()
      expect(router.readPromptSuggestion('chat')).toBe('Inspect the changes')
      return true
    }
    expect(await router.forceCloseSession('chat')).toBe(true)
    router.acknowledgeSessionRelease('chat')
    expect(router.readPromptSuggestion('chat')).toBe('Inspect the changes')
    expect(router.readPromptSuggestion('another-chat')).toBeNull()
    await router.acquire({ identity, fence: 2, spawnToken: 'second' })
    expect(router.readPromptSuggestion('chat')).toBeNull()
  })

  it.each(['refused', 'throws'] as const)(
    'does not retain a suggestion after a %s stop',
    async (outcome) => {
      const { router, adapter, identity, clear } = harness(agent)
      await router.acquire({ identity, fence: 1, spawnToken: 'first' })
      adapter.forceCloseSession = async () => {
        clear()
        if (outcome === 'throws') {
          throw new Error('stop failed')
        }
        return false
      }
      if (outcome === 'throws') {
        await expect(router.forceCloseSession('chat')).rejects.toThrow('stop failed')
      } else {
        expect(await router.forceCloseSession('chat')).toBe(false)
      }
      expect(router.readPromptSuggestion('chat')).toBeNull()
    }
  )

  it('drops a retained suggestion when the conversation is disposed', async () => {
    const { router, identity } = harness(agent)
    await router.acquire({ identity, fence: 1, spawnToken: 'first' })
    await router.forceCloseSession('chat')
    await router.disposeSession('chat')
    expect(router.readPromptSuggestion('chat')).toBeNull()
  })
})
