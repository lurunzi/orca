// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { AiVaultSession } from '../../../../../../shared/ai-vault/contracts/ai-vault-types'
import type { AiVaultSessionWorktreeInfo } from '../../../../../../shared/ai-vault/session-display/ai-vault-session-worktree'
import type { AiVaultSearchHit } from '../../../../../../shared/ai-vault/search/ai-vault-search-types'
import type { AiVaultSubagentResumeActions } from './AiVaultSessionSubagents'

import { VaultSessionRow } from './AiVaultSessionRow'

import type { AgentDotState } from '@/components/AgentStateDot'

const transcriptActions = vi.hoisted(() => ({ open: vi.fn(() => true), reveal: vi.fn() }))
vi.mock('@/lib/cursor-transcript-tab', () => ({ openCursorTranscriptTab: transcriptActions.open }))
vi.mock('@/lib/workspace/activation/worktree-activation', () => ({
  activateAndRevealWorktree: transcriptActions.reveal
}))

const session = {
  id: 'local:gemini:sess-1:/home/a/.gemini/s.json',
  executionHostId: 'local',
  agent: 'gemini',
  sessionId: 'sess-1',
  title: 'A session',
  cwd: null,
  branch: null,
  model: null,
  filePath: '/home/a/.gemini/s.json',
  codexHome: null,
  createdAt: null,
  updatedAt: null,
  modifiedAt: 0,
  messageCount: 2,
  totalTokens: 0,
  previewMessages: [{ role: 'assistant', text: 'Ready when you are' }],
  queuedMessageCount: 0,
  subagentTranscriptCount: 0,
  resumeCommand: 'gemini --resume sess-1',
  subagent: null
} as unknown as AiVaultSession

beforeEach(() => {
  // Expanded details read first-prompt/subagent APIs during render/mount.
  ;(window as unknown as { api: unknown }).api = {
    aiVault: {
      getFirstUserPrompt: vi.fn().mockResolvedValue({ prompt: null }),
      listSubagentSessions: vi.fn().mockResolvedValue({ sessions: [] })
    }
  }
})

afterEach(() => {
  // Without Vitest globals, Testing Library cannot auto-clean up; retained rows would duplicate queries.
  cleanup()
  vi.clearAllMocks()
  delete (window as unknown as { api?: unknown }).api
})

function renderRow(
  overrides: {
    liveState?: AgentDotState | null
    searchHit?: AiVaultSearchHit
    session?: AiVaultSession
    subagentResume?: AiVaultSubagentResumeActions
    detailsExpanded?: boolean
    worktreeInfo?: AiVaultSessionWorktreeInfo | null
    onToggleDetails?: () => void
    onJumpToOriginalPane?: () => void
    onResume?: () => void
    resumeHidden?: boolean
    onRequestDelete?: () => void
    onPick?: () => void
  } = {}
) {
  return render(
    <TooltipProvider>
      <VaultSessionRow
        session={overrides.session ?? session}
        searchHit={overrides.searchHit}
        subagentResume={overrides.subagentResume}
        liveState={overrides.liveState ?? null}
        resumeStartup={{ command: 'gemini --resume sess-1' }}
        realHomeResumeStartup={{ command: 'gemini --resume sess-1' }}
        worktreeInfo={overrides.worktreeInfo ?? null}
        vaultScope="all"
        detailsExpanded={overrides.detailsExpanded ?? false}
        resumeDisabled={false}
        resumeHidden={overrides.resumeHidden}
        onToggleDetails={overrides.onToggleDetails ?? vi.fn()}
        onJumpToOriginalPane={overrides.onJumpToOriginalPane}
        showJumpToWorktree={false}
        onResume={overrides.onResume ?? vi.fn()}
        resumeLabel="Resume in New Tab"
        resumeActions={{
          worktree: { worktreeId: null, disabled: true },
          newTab: { worktreeId: null, disabled: true }
        }}
        onResumeInWorktree={vi.fn()}
        onResumeInNewTab={vi.fn()}
        onCopyId={vi.fn()}
        onCopyPath={vi.fn()}
        onRequestDelete={overrides.onRequestDelete ?? vi.fn()}
        onPick={overrides.onPick}
      />
    </TooltipProvider>
  )
}

describe('VaultSessionRow Cursor conversations', () => {
  it('opens a Cursor conversation without invoking its resume action', () => {
    const cursor = { ...session, agent: 'cursor' as const, cwd: '/work/worker' }
    const onResume = vi.fn()
    renderRow({
      session: cursor,
      detailsExpanded: true,
      onResume,
      worktreeInfo: {
        status: 'active',
        label: 'worker',
        worktreeId: 'worker',
        path: '/work/worker'
      }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
    expect(transcriptActions.open).toHaveBeenCalledWith(cursor, 'worker')
    expect(transcriptActions.reveal).toHaveBeenCalledWith('worker')
    expect(onResume).not.toHaveBeenCalled()
  })
})
