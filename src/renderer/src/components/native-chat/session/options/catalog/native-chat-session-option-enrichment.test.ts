import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogModel } from '../../../../../../../shared/agent-session/options/agent-session-option-catalog-types'

import {
  clearNativeChatModelEnrichmentForTests,
  ensureNativeChatModelEnrichment,
  loadNativeChatEnrichedModels,
  readNativeChatEnrichedModels,
  subscribeNativeChatEnrichedModels
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

  it('keeps reads synchronous while one host-scoped probe is in flight', async () => {
    let resolveDiscovery: ((models: CatalogModel[]) => void) | undefined
    const discover = vi.fn(
      () =>
        new Promise<CatalogModel[]>((resolve) => {
          resolveDiscovery = resolve
        })
    )
    const listener = vi.fn()
    subscribeNativeChatEnrichedModels('cursor', 'ssh:one', listener)

    ensureNativeChatModelEnrichment({ agent: 'cursor', hostKey: 'ssh:one', discover })
    ensureNativeChatModelEnrichment({ agent: 'cursor', hostKey: 'ssh:one', discover })

    expect(readNativeChatEnrichedModels('cursor', 'ssh:one')).toBeNull()
    expect(discover).toHaveBeenCalledOnce()

    resolveDiscovery?.([
      { id: 'gpt-5.3-codex', label: 'GPT 5.3 live', options: [] },
      { id: 'account-model', label: 'Account model', options: [] }
    ])
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())

    const models = readNativeChatEnrichedModels('cursor', 'ssh:one')!
    expect(models.find((model) => model.id === 'gpt-5.3-codex')).toMatchObject({
      label: 'GPT 5.3 live',
      options: expect.arrayContaining([expect.objectContaining({ id: 'effort' })])
    })
    expect(models.at(-1)).toMatchObject({ id: 'account-model' })
    expect(readNativeChatEnrichedModels('cursor', 'ssh:two')).toBeNull()
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
