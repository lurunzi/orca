// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'

const mocks = vi.hoisted(() => ({
  canMove: true,
  moveTab: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: object) => unknown) => selector({})
}))
vi.mock('@/components/tab-bar/tab-move-to-pane-column', () => ({
  canMoveTabToNewPaneColumnFromState: () => mocks.canMove,
  moveTabToNewPaneColumn: mocks.moveTab
}))

import { StructuredAgentSessionHeaderActions } from './StructuredAgentSessionHeaderActions'

function renderActions(groupId: string | null = 'group-1'): void {
  render(
    <TooltipProvider>
      <StructuredAgentSessionHeaderActions
        tabId="tab-1"
        groupId={groupId ?? undefined}
        handoffStatus={null}
        isWorking={false}
        onHandoffRequest={vi.fn()}
      />
    </TooltipProvider>
  )
}

afterEach(() => {
  cleanup()
  mocks.canMove = true
  mocks.moveTab.mockReset()
})

describe('StructuredAgentSessionHeaderActions', () => {
  it('moves the chat tab into a split on the right', () => {
    renderActions()

    fireEvent.click(screen.getByRole('button', { name: 'Move Tab to Split' }))

    expect(mocks.moveTab).toHaveBeenCalledWith({
      unifiedTabId: 'tab-1',
      groupId: 'group-1',
      direction: 'right'
    })
  })

  it('hides split when the tab cannot move or has no group', () => {
    mocks.canMove = false
    renderActions()
    expect(screen.queryByRole('button', { name: 'Move Tab to Split' })).toBeNull()
    cleanup()

    mocks.canMove = true
    renderActions(null)
    expect(screen.queryByRole('button', { name: 'Move Tab to Split' })).toBeNull()
  })
})
