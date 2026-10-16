import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  AGENT_MODEL_CATALOG_FAILURE_TTL_MS,
  AGENT_MODEL_CATALOG_FRESH_MS
} from '../../../../shared/agent-model-catalog-refresh-policy'
import type { CatalogModel } from '../../../../shared/agent-session-option-catalog'
import { parseAntigravityModels } from '../../../../shared/commit-message-model-parsers'
import { buildModelPickerRows } from './native-chat-model-tier-groups'
import {
  clearNativeChatModelEnrichmentForTests,
  ensureNativeChatModelEnrichment,
  readNativeChatEnrichedModels,
  subscribeNativeChatEnrichedModels
} from './native-chat-session-option-enrichment'

const initial: CatalogModel[] = [
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', options: [] }
]
let now = 1_000

beforeEach(() => {
  now = 1_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  clearNativeChatModelEnrichmentForTests()
})
afterEach(() => vi.restoreAllMocks())

it('refreshes an aged list once per host and publishes new model families and tiers', async () => {
  const discover = vi.fn<() => Promise<CatalogModel[]>>().mockResolvedValue(initial)
  const request = { agent: 'antigravity' as const, hostKey: 'local', discover }
  const listener = vi.fn()
  subscribeNativeChatEnrichedModels('antigravity', 'local', listener)
  ensureNativeChatModelEnrichment(request)
  await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
  now += AGENT_MODEL_CATALOG_FRESH_MS - 1
  ensureNativeChatModelEnrichment(request)
  expect(discover).toHaveBeenCalledOnce()

  let finish: (models: CatalogModel[]) => void = () => {}
  discover.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  now += 1
  ensureNativeChatModelEnrichment(request)
  ensureNativeChatModelEnrichment(request)
  expect(discover).toHaveBeenCalledTimes(2)
  expect(readNativeChatEnrichedModels('antigravity', 'local')).toEqual(initial)

  const discovered = parseAntigravityModels(
    [
      'gemini-4-argon-high\tGemini 4 Argon (High)',
      'gemini-4-argon-low\tGemini 4 Argon (Low)',
      'future-provider-model-medium\tFuture Provider Model (Medium)',
      'future-provider-model-high\tFuture Provider Model (High)'
    ].join('\n')
  ).map((model) => ({ ...model, options: [] }))
  finish(discovered)
  await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2))
  const models = readNativeChatEnrichedModels('antigravity', 'local')!
  expect(models).toEqual(discovered)
  expect(buildModelPickerRows(models.map(({ id, label }) => ({ value: id, label })))).toMatchObject(
    [
      { kind: 'tiered', baseLabel: 'Gemini 4 Argon' },
      { kind: 'tiered', baseLabel: 'Future Provider Model' }
    ]
  )
})

it.each(['rejected', 'empty', 'null'] as const)(
  'retains the last success after a %s refresh and retries after the failure backoff',
  async (failure) => {
    const discover = vi.fn<() => Promise<CatalogModel[] | null>>().mockResolvedValue(initial)
    const request = { agent: 'antigravity' as const, hostKey: 'local', discover }
    const listener = vi.fn()
    subscribeNativeChatEnrichedModels('antigravity', 'local', listener)
    ensureNativeChatModelEnrichment(request)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
    now += AGENT_MODEL_CATALOG_FRESH_MS
    if (failure === 'rejected') {
      discover.mockRejectedValue(new Error('offline'))
    } else {
      discover.mockResolvedValue(failure === 'empty' ? [] : null)
    }
    ensureNativeChatModelEnrichment(request)
    await Promise.resolve()
    await Promise.resolve()
    expect(readNativeChatEnrichedModels('antigravity', 'local')).toEqual(initial)
    expect(listener).toHaveBeenCalledOnce()
    now += AGENT_MODEL_CATALOG_FAILURE_TTL_MS - 1
    ensureNativeChatModelEnrichment(request)
    expect(discover).toHaveBeenCalledTimes(2)
    now += 1
    discover.mockResolvedValue([{ id: 'new-model', label: 'New model', options: [] }])
    ensureNativeChatModelEnrichment(request)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2))
    expect(discover).toHaveBeenCalledTimes(3)
  }
)

it('retries a failed initial discovery without remounting or replacing another host list', async () => {
  const discover = vi.fn<() => Promise<CatalogModel[]>>().mockRejectedValue(new Error('offline'))
  const request = { agent: 'antigravity' as const, hostKey: 'ssh:host', discover }
  ensureNativeChatModelEnrichment(request)
  await Promise.resolve()
  await Promise.resolve()
  const local = vi.fn().mockResolvedValue(initial)
  ensureNativeChatModelEnrichment({ ...request, hostKey: 'local', discover: local })
  await Promise.resolve()
  expect(readNativeChatEnrichedModels('antigravity', 'ssh:host')).toBeNull()
  expect(readNativeChatEnrichedModels('antigravity', 'local')).toEqual(initial)
  now += AGENT_MODEL_CATALOG_FAILURE_TTL_MS
  discover.mockResolvedValue([{ id: 'ssh-model', label: 'SSH model', options: [] }])
  ensureNativeChatModelEnrichment(request)
  ensureNativeChatModelEnrichment({ ...request, hostKey: 'local', discover: local })
  await Promise.resolve()
  expect(discover).toHaveBeenCalledTimes(2)
  expect(local).toHaveBeenCalledOnce()
  expect(readNativeChatEnrichedModels('antigravity', 'local')).toEqual(initial)
  expect(readNativeChatEnrichedModels('antigravity', 'ssh:host')?.map(({ id }) => id)).toEqual([
    'ssh-model'
  ])
})
