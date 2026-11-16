import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearNativeChatModelEnrichmentForTests,
  ensureNativeChatModelEnrichment,
  loadNativeChatEnrichedModels,
  readNativeChatEnrichedModels
} from './native-chat-session-option-enrichment'

const mocks = vi.hoisted(() => ({
  discoverRuntimeCommitMessageModels: vi.fn(),
  callStructuredAgentSession: vi.fn()
}))

vi.mock('@/runtime/source-control/git/runtime-git-generation-client', () => ({
  discoverRuntimeCommitMessageModels: mocks.discoverRuntimeCommitMessageModels
}))
vi.mock('@/runtime/source-control/git/runtime-git-client-context', () => ({
  getRuntimeGitScope: vi.fn()
}))

vi.mock('../../../../../runtime/native-chat/requests/structured-agent-session-call', () => ({
  callStructuredAgentSession: mocks.callStructuredAgentSession
}))

describe('native chat session option enrichment', () => {
  beforeEach(() => {
    clearNativeChatModelEnrichmentForTests()
    mocks.discoverRuntimeCommitMessageModels.mockReset()
    mocks.callStructuredAgentSession.mockReset().mockResolvedValue({
      origin: 'live-session',
      models: [{ id: 'gpt-host', label: 'GPT Host', isDefault: true, efforts: [] }],
      fetchedAt: 1
    })
  })

  it('keeps the seed during the backoff after a failed probe', async () => {
    const discover = vi.fn().mockRejectedValue(new Error('offline'))
    ensureNativeChatModelEnrichment({ agent: 'cursor', hostKey: 'local', discover })
    await vi.waitFor(() => expect(discover).toHaveBeenCalledOnce())
    await Promise.resolve()

    ensureNativeChatModelEnrichment({ agent: 'cursor', hostKey: 'local', discover })
    expect(discover).toHaveBeenCalledOnce()
    expect(readNativeChatEnrichedModels('cursor', 'local')).toBeNull()
  })

  it('lets a launch menu await the listing, or learn there is none', async () => {
    const listed = await loadNativeChatEnrichedModels({
      agent: 'cursor',
      hostKey: 'local',
      discover: async () => [{ id: 'composer-2.5', label: 'Composer 2.5', options: [] }]
    })
    expect(listed?.map((model) => model.id)).toContain('composer-2.5')

    await expect(
      loadNativeChatEnrichedModels({
        agent: 'antigravity',
        hostKey: 'local',
        discover: async () => {
          throw new Error('offline')
        }
      })
    ).resolves.toBeNull()
  })
})
