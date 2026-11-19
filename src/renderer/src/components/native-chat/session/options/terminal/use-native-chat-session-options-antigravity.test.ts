// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { CatalogModel } from '../../../../../../../shared/agent-session/options/catalog-providers/agent-session-option-catalog-types'
import type { NativeChatSessionOptionDispatchCommand } from '../../../../../../../shared/native-chat/input/session-options/native-chat-session-option-dispatch'
import { clearNativeChatModelEnrichmentForTests } from '../catalog/native-chat-session-option-enrichment'
import { AGENT_MODEL_CATALOG_FRESH_MS } from '../../../../../../../shared/agent-model-catalog-refresh-policy'

const discoverModels = vi.fn<() => Promise<readonly CatalogModel[] | null>>()
const settingsRpc = vi.fn()

vi.mock('@/runtime/rpc/calls/runtime-rpc-call', () => ({
  callRuntimeRpc: (...args: unknown[]) => settingsRpc(...args)
}))

vi.mock('../catalog/native-chat-session-option-discovery', () => ({
  resolveNativeChatModelDiscoveryContext: () => ({ hostKey: 'host', runtime: null }),
  discoverNativeChatCatalogModels: () => discoverModels()
}))

const storeState: {
  settings: Record<string, unknown>
  updateSettings: () => Promise<undefined>
  agentStatusByPaneKey: Map<string, { model?: string; modelSwitchCommand?: 'orca-model' }> & {
    subscribe: () => () => void
  }
} = {
  settings: {},
  updateSettings: async () => undefined,
  agentStatusByPaneKey: Object.assign(new Map(), { subscribe: () => () => {} })
}

vi.mock('../../../../../store/index', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState }
  )
}))

import { useNativeChatSessionOptions } from './use-native-chat-session-options'

function modelDescriptor(snapshot: { id: string; kind: unknown }[]): {
  currentValue?: string
  choices: { value: string }[]
} {
  const model = snapshot.find((descriptor) => descriptor.id === 'model')
  return model?.kind as { currentValue?: string; choices: { value: string }[] }
}

beforeEach(() => {
  settingsRpc.mockReset()
  settingsRpc.mockResolvedValue(undefined)
  storeState.agentStatusByPaneKey = Object.assign(new Map(), { subscribe: () => () => {} })
})

it('updates an open Antigravity surface with new models without dispatching or changing its selection', async () => {
  clearNativeChatModelEnrichmentForTests()
  Object.defineProperty(window, 'api', { configurable: true, value: undefined })
  const initial = [{ id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', options: [] }]
  discoverModels.mockReset().mockResolvedValue(initial)
  const dispatchCommand = vi.fn<NativeChatSessionOptionDispatchCommand>(async () => undefined)
  const { result, unmount } = renderHook(() =>
    useNativeChatSessionOptions({
      agent: 'antigravity',
      terminalTabId: 'tab-agy-refresh',
      targetPtyId: 'pty-agy-refresh',
      dispatchCommand,
      readTerminalScreen: () => 'Antigravity CLI 1.4.0\nGemini 3.8 Flash (High)\n~/repo'
    })
  )
  await waitFor(() =>
    expect(modelDescriptor(result.current.snapshot).currentValue).toBe(initial[0].id)
  )
  await act(async () => result.current.surface?.demandModelCatalog?.())
  expect(discoverModels).toHaveBeenCalledOnce()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + AGENT_MODEL_CATALOG_FRESH_MS)
  try {
    discoverModels.mockResolvedValue([
      ...initial,
      { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)', options: [] }
    ])
    await act(async () => result.current.surface?.demandModelCatalog?.())
    await waitFor(() =>
      expect(modelDescriptor(result.current.snapshot).choices.map(({ value }) => value)).toEqual([
        'gemini-3.8-flash-high',
        'gemini-4-argon-high'
      ])
    )
    expect(modelDescriptor(result.current.snapshot).currentValue).toBe(initial[0].id)
    expect(dispatchCommand).not.toHaveBeenCalled()
    expect(discoverModels).toHaveBeenCalledTimes(2)
  } finally {
    clock.mockRestore()
    unmount()
  }
})

it('learns the Antigravity startup model after the picker mounts and preserves a later pick', async () => {
  clearNativeChatModelEnrichmentForTests()
  Object.defineProperty(window, 'api', { configurable: true, value: undefined })
  discoverModels.mockResolvedValue([
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', options: [] },
    { id: 'claude-opus', label: 'Claude Opus', options: [] }
  ])
  let screen: string | null = null
  const dispatchCommand = vi.fn<NativeChatSessionOptionDispatchCommand>(async () => undefined)
  const { result, rerender, unmount } = renderHook(() =>
    useNativeChatSessionOptions({
      agent: 'antigravity',
      terminalTabId: 'tab-agy-delayed',
      targetPtyId: 'pty-agy-delayed',
      dispatchCommand,
      readTerminalScreen: () => screen
    })
  )
  await waitFor(() => expect(modelDescriptor(result.current.snapshot).choices).toHaveLength(2))
  expect(modelDescriptor(result.current.snapshot).currentValue).toBeUndefined()
  screen = 'Antigravity CLI 1.2.14\nGemini 3.8 Flash (High)\n~/repo'
  await waitFor(
    () =>
      expect(modelDescriptor(result.current.snapshot).currentValue).toBe('gemini-3.8-flash-high'),
    { timeout: 2500 }
  )
  await result.current.surface?.setOption('model', 'claude-opus')
  rerender()
  await waitFor(() =>
    expect(modelDescriptor(result.current.snapshot).currentValue).toBe('claude-opus')
  )
  unmount()
})

it('shows the existing Antigravity model on first render without waiting for a host snapshot', async () => {
  clearNativeChatModelEnrichmentForTests()
  const getMainBufferSnapshot = vi.fn(() => new Promise(() => {}))
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { pty: { getMainBufferSnapshot } }
  })
  let resolveDiscovery: (models: CatalogModel[]) => void = () => {}
  discoverModels.mockReturnValue(
    new Promise((resolve) => {
      resolveDiscovery = resolve
    })
  )
  let screen: string | null = 'Antigravity CLI 1.3.2\nGemini 3.8 Flash (High)\n~/repo'
  const dispatchCommand = vi.fn<NativeChatSessionOptionDispatchCommand>(async () => undefined)
  const firstModels: (string | undefined)[] = []
  const { result, rerender, unmount } = renderHook(() => {
    const options = useNativeChatSessionOptions({
      agent: 'antigravity',
      terminalTabId: 'tab-agy-initial',
      targetPtyId: 'pty-agy-initial',
      dispatchCommand,
      readTerminalScreen: () => screen
    })
    firstModels.push(modelDescriptor(options.snapshot).currentValue)
    return options
  })
  expect(firstModels[0]).toBe('Gemini 3.8 Flash (High)')
  expect(getMainBufferSnapshot).not.toHaveBeenCalled()
  screen = null
  await act(async () =>
    resolveDiscovery([
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', options: [] },
      { id: 'claude-opus', label: 'Claude Opus', options: [] }
    ])
  )
  expect(modelDescriptor(result.current.snapshot).currentValue).toBe('gemini-3.8-flash-high')
  await act(async () => {
    await result.current.surface?.setOption('model', 'claude-opus')
  })
  screen = 'Antigravity CLI 1.3.2\nGemini 3.8 Flash (High)\n~/repo'
  rerender()
  expect(modelDescriptor(result.current.snapshot).currentValue).toBe('claude-opus')
  expect(dispatchCommand).toHaveBeenCalledExactlyOnceWith('/model claude-opus')
  unmount()
})
