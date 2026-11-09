// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'
import type { RepoIcon } from '../../../../shared/repo-icon'
import { i18n } from '@/i18n/i18n'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AgentKanbanCard } from './AgentKanbanCard'

const agentIconRender = vi.fn()
const agentStateDotRender = vi.fn()

vi.mock('@/lib/agent-catalog', () => ({
  AgentIcon: () => {
    agentIconRender()
    return <span data-testid="agent-icon" />
  }
}))

vi.mock('@/components/AgentStateDot', () => ({
  AgentStateDot: ({ state }: { state: string }) => {
    agentStateDotRender(state)
    return <span data-testid="state-dot" />
  }
}))

function card(overrides: Partial<DashboardCard> = {}): DashboardCard {
  return {
    paneKey: 'tab:leaf',
    ptyId: 'pty-1',
    agentType: 'claude',
    bucket: 'working',
    dotState: 'working',
    task: 'Review the change',
    repoId: 'repo-1',
    worktreeId: 'worktree-1',
    tabId: 'tab',
    leafId: 'leaf',
    repoName: 'Orca',
    worktreeName: 'dashboard-review',
    startedAt: 1_000,
    finishedAt: null,
    stateChangedAt: 1_000,
    unseen: false,
    ...overrides
  }
}

function renderCard(props: {
  card: DashboardCard
  now: number
  repoIcon?: RepoIcon | null
  onOpenTerminal?: () => void
}): ReturnType<typeof render> {
  return render(
    <TooltipProvider>
      <AgentKanbanCard
        card={props.card}
        repoIcon={props.repoIcon}
        now={props.now}
        onOpenTerminal={props.onOpenTerminal ?? vi.fn()}
      />
    </TooltipProvider>
  )
}

describe('AgentKanbanCard', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows the project name beside its icon without requiring hover', () => {
    renderCard({
      card: card(),
      now: 2_000,
      repoIcon: { type: 'emoji', emoji: '🐳' }
    })

    expect(screen.getByText('Orca')).toBeVisible()
    expect(screen.getByText('🐳')).toBeInTheDocument()
  })

  it('shows the project group and folder name for a remote folder card', () => {
    renderCard({
      card: card({
        repoName: 'Documentation',
        worktreeName: 'Docs workspace',
        conversationName: 'Review docs',
        workspaceKind: 'folder',
        hostKind: 'ssh'
      }),
      now: 2_000
    })

    expect(screen.getByText('Documentation / Docs workspace')).toBeVisible()
    expect(screen.getByText('Review docs')).toBeVisible()
  })

  it('does not repeat matching project and workspace names in the footer', () => {
    renderCard({
      card: card({ repoName: 'Orca', worktreeName: 'Orca', conversationName: 'Review' }),
      now: 2_000
    })

    expect(screen.getByText('Orca')).toBeVisible()
    expect(screen.queryByText('Orca / Orca')).not.toBeInTheDocument()
  })
})
