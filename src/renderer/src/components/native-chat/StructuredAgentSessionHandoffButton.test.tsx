// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionHandoffStatus } from '../../../../shared/agent-session-wire'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StructuredAgentSessionHandoffButton } from './StructuredAgentSessionHandoffButton'

const IDLE_NATIVE: AgentSessionHandoffStatus = {
  owner: 'native',
  direction: null,
  phase: 'idle',
  stage: null,
  operationId: null
}

function renderButton(status: AgentSessionHandoffStatus | null, isWorking = false) {
  const onRequest = vi.fn()
  render(
    <TooltipProvider>
      <StructuredAgentSessionHandoffButton
        status={status}
        isWorking={isWorking}
        onRequest={onRequest}
      />
    </TooltipProvider>
  )
  return onRequest
}

afterEach(cleanup)

describe('StructuredAgentSessionHandoffButton', () => {
  it('uses queued-safe admission when the native view still appears idle', () => {
    const onRequest = renderButton(IDLE_NATIVE)

    fireEvent.click(screen.getByRole('button', { name: 'Open agent TUI' }))

    expect(onRequest).toHaveBeenCalledWith('to-tui', 'after-turn')
  })

  it('does not switch on a bare click while a turn runs', () => {
    const onRequest = renderButton(IDLE_NATIVE, true)

    fireEvent.click(screen.getByRole('button', { name: 'Open agent TUI' }))

    expect(onRequest).not.toHaveBeenCalled()
  })

  it.each([
    null,
    { ...IDLE_NATIVE, owner: 'tui' as const },
    { ...IDLE_NATIVE, phase: 'queued' as const, direction: 'to-tui' as const },
    { ...IDLE_NATIVE, owner: 'none' as const }
  ])('stays hidden unless chat owns an idle session (%j)', (status) => {
    renderButton(status)

    expect(screen.queryByRole('button', { name: 'Open agent TUI' })).toBeNull()
  })
})
