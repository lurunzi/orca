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

  it('marks the chat-owned toggle pressed, like the pane header in chat view', () => {
    renderButton(IDLE_NATIVE)

    expect(
      screen.getByRole('button', { name: 'Open agent TUI' }).getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('returns a terminal-owned idle session to chat', () => {
    const onRequest = renderButton({ ...IDLE_NATIVE, owner: 'tui' })

    const toggle = screen.getByRole('button', { name: 'Return to chat' })
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Open agent TUI' })).toBeNull()
    fireEvent.click(toggle)

    expect(onRequest).toHaveBeenCalledWith('to-native', 'after-turn')
  })

  it('queues the return behind a running terminal turn', () => {
    const onRequest = renderButton({ ...IDLE_NATIVE, owner: 'tui' }, true)

    fireEvent.click(screen.getByRole('button', { name: 'Return after this turn' }))

    expect(onRequest).toHaveBeenCalledWith('to-native', 'after-turn')
  })

  it.each([
    null,
    { ...IDLE_NATIVE, phase: 'queued' as const, direction: 'to-tui' as const },
    { ...IDLE_NATIVE, owner: 'tui' as const, phase: 'switching' as const },
    { ...IDLE_NATIVE, owner: 'none' as const }
  ])('stays hidden unless an owner holds an idle session (%j)', (status) => {
    renderButton(status)

    expect(screen.queryByRole('button')).toBeNull()
  })
})
