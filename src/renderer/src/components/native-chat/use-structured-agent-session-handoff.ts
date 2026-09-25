// Chat ↔ agent-terminal switching for one structured session, plus the user release of a
// reservation stuck in manual recovery. Status comes from the subscription the chat already
// reads, so nothing here polls.

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AgentSessionHandoffAction,
  AgentSessionHandoffDirection,
  AgentSessionHandoffMode,
  AgentSessionHandoffResult,
  AgentSessionHandoffStatus,
  AgentSessionReservationReleaseResult
} from '../../../../shared/agent-session-wire'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { callStructuredAgentSession } from '@/runtime/structured-agent-session-client'
import { supportsStructuredAgentSessionHandoffControls } from '@/runtime/structured-agent-session-host-capability'
import type { StructuredAgentSessionMutate } from './use-structured-agent-session-mutate'
import { useStructuredChatReturnRequest } from './structured-chat-return-requests'

export type StructuredAgentSessionHandoffControls = {
  /** Null when the host has not negotiated handoff controls or has published no status. */
  status: AgentSessionHandoffStatus | null
  request: (
    direction: AgentSessionHandoffDirection,
    mode: AgentSessionHandoffMode,
    action?: AgentSessionHandoffAction
  ) => void
  /** Resolves to an error message, or null once the host released the reservation. */
  release: () => Promise<string | null>
}

function useHandoffControlsSupported(target: RuntimeClientTarget, enabled: boolean): boolean {
  const targetKey = target.kind === 'local' ? 'local' : `environment:${target.environmentId}`
  const [supported, setSupported] = useState<{ key: string; value: boolean } | null>(null)
  // Keyed by value, not identity: callers build the target inline.
  const targetRef = useRef(target)
  useEffect(() => {
    targetRef.current = target
  }, [target])
  useEffect(() => {
    if (!enabled) {
      return
    }
    let current = true
    void supportsStructuredAgentSessionHandoffControls(targetRef.current).then((value) => {
      if (current) {
        setSupported({ key: targetKey, value })
      }
    })
    return () => {
      current = false
    }
  }, [enabled, targetKey])
  return enabled && supported?.key === targetKey && supported.value
}

export function useStructuredAgentSessionHandoff(args: {
  sessionId: string
  target: RuntimeClientTarget
  enabled: boolean
  handoff: AgentSessionHandoffStatus | null
  mutate: StructuredAgentSessionMutate
}): StructuredAgentSessionHandoffControls {
  const { enabled, handoff, mutate, sessionId, target } = args
  const supported = useHandoffControlsSupported(target, enabled)
  const request = useCallback(
    (
      direction: AgentSessionHandoffDirection,
      mode: AgentSessionHandoffMode,
      action: AgentSessionHandoffAction = 'start'
    ) => {
      // The host fingerprints the defaulted action, so it is always sent explicitly.
      void mutate<AgentSessionHandoffResult>(
        'agentSession.requestHandoff',
        'agentSession.requestHandoff',
        { direction, mode, action }
      )
    },
    [mutate]
  )
  const releaseFence = handoff?.error?.releaseFence
  const release = useCallback(async (): Promise<string | null> => {
    if (releaseFence === undefined) {
      return null
    }
    try {
      const result = await callStructuredAgentSession<AgentSessionReservationReleaseResult>(
        target,
        'agentSession.releaseReservation',
        { sessionId, expectedRuntimeFence: releaseFence }
      )
      return result.ok ? null : result.refusal.message
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }, [releaseFence, sessionId, target])
  const status = supported ? handoff : null
  useStructuredChatReturnRequest({ sessionId, status, request })
  return { status, request, release }
}
