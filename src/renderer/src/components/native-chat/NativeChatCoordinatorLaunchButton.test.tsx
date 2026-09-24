// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  toastError: vi.fn(),
  getState: vi.fn()
}))

vi.mock('@/lib/launch-agent-in-new-tab', () => ({ launchAgentInNewTab: mocks.launch }))
vi.mock('@/store', () => ({ useAppStore: { getState: mocks.getState } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>
}))

import { NativeChatCoordinatorLaunchButton } from './NativeChatCoordinatorLaunchButton'

afterEach(() => cleanup())

beforeEach(() => {
  mocks.launch.mockReset()
  mocks.toastError.mockReset()
  mocks.getState.mockReturnValue({
    tabsByWorktree: { workspace: [{ id: 'tab-1' }] }
  })
})

describe('NativeChatCoordinatorLaunchButton', () => {
  it('starts a same-agent draft in the current workspace once per double click', () => {
    mocks.launch.mockReturnValue({ surface: { kind: 'local-terminal', tabId: 'tab-2' } })
    render(<NativeChatCoordinatorLaunchButton agent="antigravity" terminalTabId="tab-1" />)

    const button = screen.getByRole('button', { name: 'New coordinator session' })
    fireEvent.click(button)
    fireEvent.click(button)

    expect(mocks.launch).toHaveBeenCalledExactlyOnceWith({
      agent: 'antigravity',
      worktreeId: 'workspace',
      groupId: undefined,
      prompt: 'Use Orca orchestration to coordinate: ',
      promptDelivery: 'draft'
    })
  })

  it('grants identity after a structured session is created', async () => {
    mocks.getState.mockReturnValue({
      tabsByWorktree: { unrelated: [{ id: 'terminal-elsewhere' }] },
      unifiedTabsByWorktree: {
        'folder:project': [
          {
            id: 'tab-1',
            contentType: 'agent-session',
            entityId: 'existing-session',
            worktreeId: 'folder:project',
            groupId: 'source-split'
          }
        ]
      }
    })
    const set = vi.fn().mockResolvedValue({ state: 'enabled' })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { orchestrationIdentity: { set } }
    })
    mocks.launch.mockReturnValue({
      surface: { kind: 'local-agent-session', tabId: 'tab-2', sessionId: 'new-session' },
      structuredSettlement: Promise.resolve({ kind: 'structured', sessionId: 'new-session' })
    })
    render(<NativeChatCoordinatorLaunchButton agent="codex" terminalTabId="tab-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'New coordinator session' }))

    await waitFor(() => expect(set).toHaveBeenCalledExactlyOnceWith('new-session', true))
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'folder:project', groupId: 'source-split' })
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('keeps a terminal-backed launch in its source split group', () => {
    mocks.getState.mockReturnValue({
      tabsByWorktree: { workspace: [{ id: 'tab-1' }] },
      unifiedTabsByWorktree: {
        workspace: [
          {
            id: 'unified-tab-1',
            entityId: 'tab-1',
            contentType: 'terminal',
            worktreeId: 'workspace',
            groupId: 'source-split'
          }
        ]
      }
    })
    mocks.launch.mockReturnValue({ surface: { kind: 'local-terminal', tabId: 'tab-2' } })
    render(<NativeChatCoordinatorLaunchButton agent="cursor" terminalTabId="tab-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'New coordinator session' }))
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'workspace', groupId: 'source-split' })
    )
  })

  it('refuses to guess a workspace for a closed source tab', () => {
    mocks.getState.mockReturnValue({ tabsByWorktree: {}, unifiedTabsByWorktree: {} })
    render(<NativeChatCoordinatorLaunchButton agent="claude" terminalTabId="closed" />)
    fireEvent.click(screen.getByRole('button', { name: 'New coordinator session' }))
    expect(mocks.launch).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('Could not start coordinator session')
  })

  it('reports a session whose identity could not be granted', async () => {
    const set = vi.fn().mockResolvedValue({ state: 'unavailable', reason: 'busy' })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { orchestrationIdentity: { set } }
    })
    mocks.launch.mockReturnValue({
      surface: { kind: 'local-agent-session', tabId: 'tab-2', sessionId: 'new-session' },
      structuredSettlement: Promise.resolve({ kind: 'structured', sessionId: 'new-session' })
    })
    render(<NativeChatCoordinatorLaunchButton agent="codex" terminalTabId="tab-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'New coordinator session' }))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Session opened without coordinator access',
        expect.objectContaining({ description: 'busy' })
      )
    )
  })
})
