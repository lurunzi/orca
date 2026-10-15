// @vitest-environment happy-dom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogModel } from '../../../../shared/agent-session-option-catalog'
import { clearNativeChatModelEnrichmentForTests } from './native-chat-session-option-enrichment'
import { clearNativeChatSessionOptionCacheForTests } from './native-chat-session-option-cache'
import { useNativeChatSessionOptions } from './use-native-chat-session-options'

const discoverModels = vi.fn<() => Promise<readonly CatalogModel[] | null>>()

vi.mock('./native-chat-session-option-discovery', () => ({
  resolveNativeChatModelDiscoveryContext: () => ({ hostKey: 'host', runtime: null }),
  discoverNativeChatCatalogModels: () => discoverModels()
}))

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: { agentStatusByPaneKey: Record<string, never> }) => unknown) =>
    selector({ agentStatusByPaneKey: {} })
}))

vi.mock('./native-chat-session-option-settings-write', () => ({
  enqueueSessionOptionSettingsWrite: vi.fn(async () => {})
}))

const providers = [
  {
    agent: 'claude',
    screen:
      'Claude Code v2.1.220\r\nOpus 5 (1M context) with high effort · API Usage Billing\r\n~/repo',
    initial: 'opus',
    resolved: 'opus[1m]',
    pick: 'haiku',
    models: [
      { id: 'opus[1m]', label: 'Opus (1M context)', options: [] },
      { id: 'haiku', label: 'Haiku', options: [] }
    ]
  },
  {
    agent: 'antigravity',
    screen: 'Antigravity CLI 1.3.2\nGemini 3.8 Flash (High)\n~/repo',
    initial: 'Gemini 3.8 Flash (High)',
    resolved: 'gemini-3.8-flash-high',
    pick: 'claude-opus',
    models: [
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', options: [] },
      { id: 'claude-opus', label: 'Claude Opus', options: [] }
    ]
  }
] as const

describe.each(providers)('$agent startup model reports', (provider) => {
  let resolveDiscovery: (models: readonly CatalogModel[]) => void

  beforeEach(() => {
    clearNativeChatSessionOptionCacheForTests()
    clearNativeChatModelEnrichmentForTests()
    discoverModels.mockReset()
    discoverModels.mockReturnValue(new Promise((resolve) => (resolveDiscovery = resolve)))
    Object.defineProperty(window, 'api', { configurable: true, value: undefined })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  const models = (): CatalogModel[] => provider.models.map((model) => ({ ...model, options: [] }))

  it('keeps a picked model when discovery re-resolves the startup frame', async () => {
    const dispatchCommand = vi.fn(async () => undefined)
    const readTerminalScreen = () => provider.screen
    const { result } = renderHook(() =>
      useNativeChatSessionOptions({
        agent: provider.agent,
        terminalTabId: 'tab-discovery',
        targetPtyId: 'pty-discovery',
        dispatchCommand,
        readTerminalScreen
      })
    )
    expect(result.current.snapshot[0]?.kind.currentValue).toBe(provider.initial)
    await act(async () => {
      await result.current.surface?.setOption('model', provider.pick)
    })
    expect(result.current.snapshot[0]?.kind.currentValue).toBe(provider.pick)
    await act(async () => resolveDiscovery(models()))
    expect(result.current.snapshot[0]).toMatchObject({
      valueSource: 'dispatched',
      kind: { currentValue: provider.pick }
    })
    expect(dispatchCommand.mock.calls).toEqual([
      expect.arrayContaining([`/model ${provider.pick}`])
    ])
  })

  it('keeps a picked model when an earlier host snapshot arrives', async () => {
    let resolveSnapshot: (value: { data: string; alternateScreen: false }) => void = () => {}
    const getMainBufferSnapshot = vi.fn(() => new Promise((resolve) => (resolveSnapshot = resolve)))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { pty: { getMainBufferSnapshot } }
    })
    const dispatchCommand = vi.fn(async () => undefined)
    const readTerminalScreen = () => null
    const { result } = renderHook(() =>
      useNativeChatSessionOptions({
        agent: provider.agent,
        terminalTabId: 'tab-snapshot',
        targetPtyId: 'pty-snapshot',
        dispatchCommand,
        readTerminalScreen
      })
    )
    await act(async () => resolveDiscovery(models()))
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(1)
    await act(async () => {
      await result.current.surface?.setOption('model', provider.pick)
    })
    await act(async () => resolveSnapshot({ data: provider.screen, alternateScreen: false }))
    expect(result.current.snapshot[0]).toMatchObject({
      valueSource: 'dispatched',
      kind: { currentValue: provider.pick }
    })
  })

  it('keeps a picked model when reopening the GUI over the unchanged startup frame', async () => {
    const dispatchCommand = vi.fn(async () => undefined)
    const readTerminalScreen = () => provider.screen
    const useReopenedOptions = () =>
      useNativeChatSessionOptions({
        agent: provider.agent,
        terminalTabId: 'tab-reopen',
        targetPtyId: 'pty-reopen',
        dispatchCommand,
        readTerminalScreen
      })
    const first = renderHook(useReopenedOptions)
    await act(async () => resolveDiscovery(models()))
    await act(async () => {
      await first.result.current.surface?.setOption('model', provider.pick)
    })
    first.unmount()
    const reopened = renderHook(useReopenedOptions)
    expect(reopened.result.current.snapshot[0]).toMatchObject({
      valueSource: 'dispatched',
      kind: { currentValue: provider.pick }
    })
  })

  it('remembers the mounted frame for discovery while the host snapshot is pending', async () => {
    const getMainBufferSnapshot = vi.fn(() => new Promise(() => {}))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { pty: { getMainBufferSnapshot } }
    })
    let screen: string | null = provider.screen
    const readTerminalScreen = () => screen
    const dispatchCommand = vi.fn()
    const firstValues: (string | boolean | undefined)[] = []
    const { result } = renderHook(() => {
      const options = useNativeChatSessionOptions({
        agent: provider.agent,
        terminalTabId: 'tab-mounted',
        targetPtyId: 'pty-mounted',
        dispatchCommand,
        readTerminalScreen
      })
      firstValues.push(options.snapshot[0]?.kind.currentValue)
      return options
    })
    expect(firstValues[0]).toBe(provider.initial)
    screen = null
    await act(async () => resolveDiscovery(models()))
    await waitFor(() =>
      expect(result.current.snapshot[0]?.kind.currentValue).toBe(provider.resolved)
    )
    expect(dispatchCommand).not.toHaveBeenCalled()
  })

  it('learns a newly mounted frame while an earlier host read is still pending', async () => {
    vi.useFakeTimers()
    const getMainBufferSnapshot = vi.fn(() => new Promise(() => {}))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { pty: { getMainBufferSnapshot } }
    })
    let screen: string | null = null
    const readTerminalScreen = () => screen
    const dispatchCommand = vi.fn()
    const { result } = renderHook(() =>
      useNativeChatSessionOptions({
        agent: provider.agent,
        terminalTabId: 'tab-delayed-frame',
        targetPtyId: 'pty-delayed-frame',
        dispatchCommand,
        readTerminalScreen
      })
    )
    await act(async () => resolveDiscovery(models()))
    expect(result.current.snapshot[0]?.kind.currentValue).toBeUndefined()
    screen = provider.screen
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(result.current.snapshot[0]?.kind.currentValue).toBe(provider.resolved)
    expect(getMainBufferSnapshot).toHaveBeenCalledTimes(1)
    expect(dispatchCommand).not.toHaveBeenCalled()
  })
})
