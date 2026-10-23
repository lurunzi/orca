// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  prepare: vi.fn(),
  build: vi.fn(),
  launch: vi.fn(),
  deliver: vi.fn(),
  find: vi.fn(),
  host: 'local',
  path: '/work/project'
}))
const state = create(() => ({ settings: {}, unifiedTabsByWorktree: {}, setTabViewMode: vi.fn() }))
vi.mock('@/store', () => ({
  useAppStore: Object.assign((...args: Parameters<typeof state>) => state(...args), {
    getState: () => state.getState()
  })
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getKnownExecutionHostIdForWorktree: () => mocks.host
}))
vi.mock('../right-sidebar/ai-vault-session-launch-target', () => ({
  resolveAiVaultTargetWorkspacePath: () => mocks.path
}))
vi.mock('@/lib/ai-vault-session-resume-preparation', () => ({
  prepareAiVaultSessionForTerminalResume: mocks.prepare
}))
vi.mock('@/lib/ai-vault-resume-command', () => ({
  buildAiVaultResumeStartupForWorktree: mocks.build
}))
vi.mock('@/lib/launch-ai-vault-session', () => ({ launchAiVaultSessionInNewTab: mocks.launch }))
vi.mock('@/lib/launch-agent-tab-prompt-paste', () => ({
  pasteAgentLaunchPromptOnceReady: mocks.deliver
}))
vi.mock('@/lib/cursor-transcript-terminal', () => ({ findCursorTranscriptTerminal: mocks.find }))
import { useCursorTranscriptResume } from './use-cursor-transcript-resume'

const session: AiVaultSession = {
  id: 'cursor:external',
  agent: 'cursor',
  sessionId: 'external',
  executionHostId: 'local',
  cwd: '/work/project',
  filePath: '/cursor/external.jsonl',
  title: 'Other worker',
  branch: null,
  model: null,
  codexHome: null,
  createdAt: null,
  updatedAt: null,
  modifiedAt: '',
  messageCount: 2,
  totalTokens: 0,
  previewMessages: [],
  queuedMessageCount: 0,
  subagentTranscriptCount: 0,
  resumeCommand: 'cursor-agent --resume external',
  subagent: null
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.host = 'local'
  mocks.path = '/work/project'
  mocks.list.mockResolvedValue({ sessions: [{ ...session, modifiedAt: new Date().toISOString() }] })
  mocks.prepare.mockResolvedValue(session)
  mocks.build.mockReturnValue({ command: session.resumeCommand })
  mocks.launch.mockReturnValue({ tabId: 'resumed-tab' })
  mocks.deliver.mockResolvedValue({ delivered: true })
  mocks.find.mockReturnValue(null)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { aiVault: { listSessions: mocks.list } }
  })
})
afterEach(cleanup)
const options = { worktreeId: 'wt', sessionId: 'external', enabled: true }

it('can resume a recently written external conversation and waits for confirmed delivery', async () => {
  const { result } = renderHook(() => useCursorTranscriptResume(options))
  await waitFor(() => expect(result.current.resumable).toBe(true))
  await expect(result.current.resume('continue')).resolves.toBe(true)
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'external' }))
  expect(mocks.launch).toHaveBeenCalledExactlyOnceWith({
    agent: 'cursor',
    worktreeId: 'wt',
    command: session.resumeCommand
  })
  expect(mocks.deliver).toHaveBeenCalledWith(
    expect.objectContaining({ tabId: 'resumed-tab', content: 'continue', submit: true })
  )
})

it('reuses an exact managed pane and refuses a disconnected split', async () => {
  const { result } = renderHook(() => useCursorTranscriptResume(options))
  await waitFor(() => expect(result.current.resumable).toBe(true))
  mocks.find.mockReturnValue({ tabId: 'existing', paneKey: 'exact', ptyId: 'exact-pty' })
  await result.current.resume('continue')
  expect(mocks.launch).not.toHaveBeenCalled()
  const request = mocks.deliver.mock.calls[0][0]
  await expect(request.launchPty).resolves.toBe('exact-pty')
  mocks.find.mockReturnValue({ tabId: 'existing', paneKey: 'exact', ptyId: null })
  await expect(result.current.resume('later')).rejects.toThrow('draft has been kept')
  expect(mocks.deliver).toHaveBeenCalledOnce()
})

it('does not launch on a changed host or failed ownership check', async () => {
  const { result } = renderHook(() => useCursorTranscriptResume(options))
  await waitFor(() => expect(result.current.resumable).toBe(true))
  mocks.prepare.mockImplementation(async () => {
    mocks.host = 'runtime:another'
    return session
  })
  await expect(result.current.resume('continue')).resolves.toBe(false)
  expect(mocks.launch).not.toHaveBeenCalled()
  mocks.host = 'local'
  mocks.prepare.mockRejectedValue(new Error('Already owned'))
  await expect(result.current.resume('continue')).rejects.toThrow('Already owned')
  expect(mocks.launch).not.toHaveBeenCalled()
})

it('keeps the resolved session across hide/reveal and reports unconfirmed sends', async () => {
  const { result, rerender } = renderHook(
    (enabled) => useCursorTranscriptResume({ ...options, enabled }),
    { initialProps: true }
  )
  await waitFor(() => expect(result.current.resumable).toBe(true))
  rerender(false)
  expect(result.current.resumable).toBe(true)
  await act(async () => rerender(true))
  mocks.deliver.mockResolvedValue({ delivered: false })
  await expect(result.current.resume('continue')).rejects.toThrow('not confirmed')
})
