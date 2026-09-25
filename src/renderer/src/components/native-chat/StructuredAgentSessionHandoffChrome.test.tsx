// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionHandoffStatus } from '../../../../shared/agent-session-wire'
import { StructuredAgentSessionHandoffChrome } from './StructuredAgentSessionHandoffChrome'

const IDLE_NATIVE: AgentSessionHandoffStatus = {
  owner: 'native',
  direction: null,
  phase: 'idle',
  stage: null,
  operationId: null
}

afterEach(cleanup)

describe('StructuredAgentSessionHandoffChrome', () => {
  it('leaves a chat-owned idle session to the composer toolbar entry', () => {
    const { container } = render(
      <StructuredAgentSessionHandoffChrome status={IDLE_NATIVE} onRequest={vi.fn()} />
    )

    expect(container.childElementCount).toBe(0)
  })

  it('keeps the terminal-owned row as text; the top-right toggle carries the return', () => {
    render(
      <StructuredAgentSessionHandoffChrome
        status={{ ...IDLE_NATIVE, owner: 'tui', hostLabel: 'workstation' }}
        onRequest={vi.fn()}
      />
    )

    expect(screen.getByText('Agent is open in terminal on workstation.')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('cancels a queued switch in the direction it was queued', () => {
    const onRequest = vi.fn()
    render(
      <StructuredAgentSessionHandoffChrome
        status={{ ...IDLE_NATIVE, direction: 'to-tui', phase: 'queued' }}
        onRequest={onRequest}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onRequest).toHaveBeenCalledWith('to-tui', 'after-turn', 'cancel-queued')
  })

  it('offers one Retry action for a recoverable dead TUI owner', () => {
    const onRequest = vi.fn()
    render(
      <StructuredAgentSessionHandoffChrome
        status={{
          owner: 'tui',
          direction: 'to-native',
          phase: 'failed',
          stage: 'old-owner-stopped',
          operationId: '1800000000000-00000000000000000000000000000001',
          error: {
            message: "Couldn't resume chat — the agent terminal still owns this session",
            recoverableOwner: 'tui'
          }
        }}
        onRequest={onRequest}
      />
    )

    expect(screen.queryByRole('button', { name: 'Return to chat' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRequest).toHaveBeenCalledWith('to-native', 'now', 'retry')
  })
})
