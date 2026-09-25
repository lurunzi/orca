import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionHandoffStatus } from '../../../../shared/agent-session-wire'
import {
  resolveStructuredTuiOwner,
  structuredTuiOwnerLeafMatches,
  type StructuredTuiOwnerStatusReader
} from './structured-tui-owner-resolution'

vi.mock('@/runtime/structured-agent-session-client', () => ({
  callStructuredAgentSession: vi.fn()
}))
vi.mock('@/runtime/structured-agent-session-host-capability', () => ({
  supportsStructuredAgentSessionHandoffControls: vi.fn()
}))

const TUI_OWNER: AgentSessionHandoffStatus = {
  owner: 'tui',
  direction: null,
  phase: 'idle',
  stage: null,
  operationId: null,
  terminal: { handle: 'term_1', tabId: 'tui-tab', paneKey: 'tui-tab:leaf', ptyId: 'pty-1' }
}
const NATIVE_OWNER: AgentSessionHandoffStatus = {
  owner: 'native',
  direction: null,
  phase: 'idle',
  stage: null,
  operationId: null
}
const CANDIDATES = [
  { chatTabId: 'chat-a', sessionId: 'session-a' },
  { chatTabId: 'chat-b', sessionId: 'session-b' }
]

function reader(bySession: Record<string, AgentSessionHandoffStatus | Error>) {
  return vi.fn<StructuredTuiOwnerStatusReader>(async (_target, sessionId) => {
    const value = bySession[sessionId]
    if (value instanceof Error || value === undefined) {
      throw value ?? new Error('unknown session')
    }
    return value
  })
}

function resolve(
  readStatus: StructuredTuiOwnerStatusReader,
  terminal = { tabId: 'tui-tab', ptyIds: ['pty-1'] },
  supported = true
) {
  return resolveStructuredTuiOwner({
    target: { kind: 'local' },
    candidates: CANDIDATES,
    terminal,
    readStatus,
    supportsHandoff: async () => supported
  })
}

describe('resolveStructuredTuiOwner', () => {
  it('names the session whose host status says this terminal is the idle owner', async () => {
    const result = await resolve(reader({ 'session-a': NATIVE_OWNER, 'session-b': TUI_OWNER }))

    expect(result).toEqual({
      kind: 'owner',
      binding: {
        sessionId: 'session-b',
        chatTabId: 'chat-b',
        paneKey: 'tui-tab:leaf',
        ptyId: 'pty-1'
      }
    })
  })

  it('matches by bound PTY when the host names a different tab id', async () => {
    const result = await resolve(reader({ 'session-a': TUI_OWNER, 'session-b': NATIVE_OWNER }), {
      tabId: 'client-tab',
      ptyIds: ['pty-1']
    })

    expect(result.kind === 'owner' && result.binding.sessionId).toBe('session-a')
  })

  it('does not claim a terminal the host names as another owner', async () => {
    const result = await resolve(reader({ 'session-a': TUI_OWNER, 'session-b': NATIVE_OWNER }), {
      tabId: 'other-tab',
      ptyIds: ['pty-9']
    })

    expect(result).toEqual({ kind: 'none' })
  })

  it('asks again while a candidate is still switching to its terminal', async () => {
    const result = await resolve(
      reader({
        'session-a': { ...NATIVE_OWNER, phase: 'switching', direction: 'to-tui' },
        'session-b': NATIVE_OWNER
      })
    )

    expect(result).toEqual({ kind: 'settling' })
  })

  it('treats an unanswered status as no owner rather than guessing', async () => {
    const result = await resolve(
      reader({ 'session-a': new Error('unreachable'), 'session-b': NATIVE_OWNER })
    )

    expect(result).toEqual({ kind: 'none' })
  })

  it('never asks an older host that has no handoff controls', async () => {
    const readStatus = reader({ 'session-a': TUI_OWNER })

    const result = await resolve(readStatus, undefined, false)

    expect(result).toEqual({ kind: 'none' })
    expect(readStatus).not.toHaveBeenCalled()
  })
})

describe('structuredTuiOwnerLeafMatches', () => {
  const binding = { sessionId: 's', chatTabId: 'c', paneKey: 'tab:leaf-1', ptyId: 'pty-1' }

  it('prefers the bound PTY over the pane key', () => {
    expect(
      structuredTuiOwnerLeafMatches(binding, {
        paneKey: 'tab:leaf-2',
        ptyId: 'pty-1',
        paneCount: 2
      })
    ).toBe(true)
    expect(
      structuredTuiOwnerLeafMatches(binding, {
        paneKey: 'tab:leaf-1',
        ptyId: 'pty-2',
        paneCount: 2
      })
    ).toBe(false)
  })

  it('falls back to the pane key, then to a single-pane tab', () => {
    expect(
      structuredTuiOwnerLeafMatches(binding, { paneKey: 'tab:leaf-1', ptyId: null, paneCount: 2 })
    ).toBe(true)
    expect(
      structuredTuiOwnerLeafMatches(binding, { paneKey: 'tab:leaf-2', ptyId: null, paneCount: 2 })
    ).toBe(false)
    expect(
      structuredTuiOwnerLeafMatches(binding, { paneKey: 'tab:leaf-2', ptyId: null, paneCount: 1 })
    ).toBe(true)
  })
})
