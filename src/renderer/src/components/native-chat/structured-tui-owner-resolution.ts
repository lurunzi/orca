// Which structured Chat session, if any, a terminal tab is the live agent-TUI owner of.
//
// The execution host is the only authority: it publishes the owning terminal on the session's
// handoff status. This reads that status for the Chat tabs the renderer already shows in the same
// workspace; anything short of a positive host answer resolves to `none`, so the caller keeps its
// ordinary terminal behavior.

import type { AgentSessionHandoffStatus } from '../../../../shared/agent-session-wire'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import { supportsStructuredAgentSessionHandoffControls } from '@/runtime/structured-agent-session-host-capability'

export type StructuredTuiOwnerCandidate = { chatTabId: string; sessionId: string }

export type StructuredTuiOwnerTerminal = { tabId: string; ptyIds: readonly string[] }

export type StructuredTuiOwnerBinding = {
  sessionId: string
  chatTabId: string
  paneKey: string
  ptyId: string | null
}

export type StructuredTuiOwnerResolution =
  | { kind: 'owner'; binding: StructuredTuiOwnerBinding }
  /** A candidate is still moving toward its terminal; its final owner is not published yet. */
  | { kind: 'settling' }
  | { kind: 'none' }

export type StructuredTuiOwnerStatusReader = (
  target: RuntimeClientTarget,
  sessionId: string
) => Promise<AgentSessionHandoffStatus>

export const readStructuredAgentSessionHandoffStatus: StructuredTuiOwnerStatusReader = (
  target,
  sessionId
) =>
  callStructuredAgentSession<AgentSessionHandoffStatus>(target, 'agentSession.handoffStatus', {
    sessionId
  })

/** The host names this terminal as the idle owner: by tab id, or by the PTY it bound. */
export function structuredTuiOwnerTerminalMatches(
  status: AgentSessionHandoffStatus | null | undefined,
  terminal: StructuredTuiOwnerTerminal
): status is AgentSessionHandoffStatus & {
  terminal: NonNullable<AgentSessionHandoffStatus['terminal']>
} {
  if (status?.owner !== 'tui' || status.phase !== 'idle' || !status.terminal) {
    return false
  }
  const { ptyId, tabId } = status.terminal
  return tabId === terminal.tabId || (ptyId !== undefined && terminal.ptyIds.includes(ptyId))
}

/** Whether one pane of the owning terminal tab is the owner, not a sibling split. */
export function structuredTuiOwnerLeafMatches(
  binding: StructuredTuiOwnerBinding,
  leaf: { paneKey: string | null; ptyId: string | null; paneCount: number }
): boolean {
  if (binding.ptyId !== null && leaf.ptyId !== null) {
    return binding.ptyId === leaf.ptyId
  }
  return binding.paneKey === leaf.paneKey || leaf.paneCount === 1
}

export async function resolveStructuredTuiOwner(args: {
  target: RuntimeClientTarget
  candidates: readonly StructuredTuiOwnerCandidate[]
  terminal: StructuredTuiOwnerTerminal
  readStatus?: StructuredTuiOwnerStatusReader
  supportsHandoff?: (target: RuntimeClientTarget) => Promise<boolean>
}): Promise<StructuredTuiOwnerResolution> {
  const {
    candidates,
    readStatus = readStructuredAgentSessionHandoffStatus,
    supportsHandoff = supportsStructuredAgentSessionHandoffControls,
    target,
    terminal
  } = args
  // An older host has no handoff status to read; the terminal keeps its ordinary toggle.
  if (candidates.length === 0 || !(await supportsHandoff(target))) {
    return { kind: 'none' }
  }
  const statuses = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        return { candidate, status: await readStatus(target, candidate.sessionId) }
      } catch {
        // Unanswered is unverifiable, never "not the owner" evidence; either way no return is offered.
        return { candidate, status: null }
      }
    })
  )
  for (const { candidate, status } of statuses) {
    if (structuredTuiOwnerTerminalMatches(status, terminal)) {
      return {
        kind: 'owner',
        binding: {
          sessionId: candidate.sessionId,
          chatTabId: candidate.chatTabId,
          paneKey: status.terminal.paneKey,
          ptyId: status.terminal.ptyId ?? null
        }
      }
    }
  }
  const settling = statuses.some(
    ({ status }) =>
      status?.direction === 'to-tui' && (status.phase === 'switching' || status.phase === 'queued')
  )
  return settling ? { kind: 'settling' } : { kind: 'none' }
}
