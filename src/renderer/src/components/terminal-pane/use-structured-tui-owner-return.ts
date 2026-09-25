// Lets the agent terminal that owns a structured Chat's session hand it back to that Chat,
// instead of opening a second, transcript-backed chat over the same terminal.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useAppStore } from '@/store'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { activateStructuredAgentSessionTab } from '@/lib/structured-agent-session-tab-activation'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { Tab } from '../../../../shared/tab-types'
import { isStructuredTab } from '../native-chat/structured-agent-session-tabs'
import { requestStructuredChatReturn } from '../native-chat/structured-chat-return-requests'
import {
  resolveStructuredTuiOwner,
  structuredTuiOwnerLeafMatches,
  type StructuredTuiOwnerBinding,
  type StructuredTuiOwnerCandidate
} from '../native-chat/structured-tui-owner-resolution'

/** The host publishes the owner a moment after the terminal is revealed; ask again until then. */
const SETTLING_RETRY_MS = 500
const SETTLING_RETRY_LIMIT = 20

function tryMakePaneKey(tabId: string, leafId: string): string | null {
  try {
    return makePaneKey(tabId, leafId)
  } catch {
    return null
  }
}

function structuredChatCandidates(
  unifiedTabsByWorktree: Readonly<Record<string, readonly Tab[]>>,
  worktreeId: string
): StructuredTuiOwnerCandidate[] {
  return (unifiedTabsByWorktree[worktreeId] ?? [])
    .filter((tab) => isStructuredTab(tab) && !tab.agentTranscript)
    .map((tab) => ({ chatTabId: tab.id, sessionId: tab.entityId }))
}

// Read on demand, not subscribed: every retained terminal tab mounts this, and each store
// listener costs a visit per publication (see terminal-pane-store-subscription-budget.test).
function readOwnerLookupInputs(worktreeId: string) {
  const state = useAppStore.getState()
  return {
    candidates: structuredChatCandidates(state.unifiedTabsByWorktree, worktreeId),
    target: getActiveRuntimeTarget({
      activeRuntimeEnvironmentId: getRuntimeEnvironmentIdForWorktree(state, worktreeId)
    })
  }
}

type OwnerPaneSource = { getPanes: () => readonly { id: number; leafId: string }[] }
type OwnerPtySource = { getPtyId: () => string | null }

export function useStructuredTuiOwnerReturn(args: {
  worktreeId: string
  tabId: string
  /** Resolve only while the pane's header or menu can be seen. */
  enabled: boolean
  paneCount: number
  managerRef: RefObject<OwnerPaneSource | null>
  paneTransportsRef: RefObject<ReadonlyMap<number, OwnerPtySource>>
}): {
  ownsLeaf: (leafId: string | null) => boolean
  /** Resolves false when the host no longer names this pane the owner. */
  returnLeafToChat: (leafId: string) => Promise<boolean>
} {
  const { enabled, managerRef, paneCount, paneTransportsRef, tabId, worktreeId } = args
  const [binding, setBinding] = useState<StructuredTuiOwnerBinding | null>(null)
  const [settling, setSettling] = useState(false)
  const [settleRetry, setSettleRetry] = useState(0)
  const settleAttemptsRef = useRef(0)

  const readLeafPtyId = useCallback(
    (leafId: string): string | null => {
      const pane = managerRef.current?.getPanes().find((candidate) => candidate.leafId === leafId)
      return pane ? (paneTransportsRef.current?.get(pane.id)?.getPtyId() ?? null) : null
    },
    [managerRef, paneTransportsRef]
  )
  const readTabPtyIds = useCallback((): string[] => {
    const ptyIds: string[] = []
    for (const pane of managerRef.current?.getPanes() ?? []) {
      const ptyId = paneTransportsRef.current?.get(pane.id)?.getPtyId()
      if (ptyId) {
        ptyIds.push(ptyId)
      }
    }
    return ptyIds
  }, [managerRef, paneTransportsRef])

  useEffect(() => {
    settleAttemptsRef.current = 0
  }, [enabled, paneCount, tabId, worktreeId])

  useEffect(() => {
    if (!enabled) {
      return
    }
    const { candidates, target } = readOwnerLookupInputs(worktreeId)
    if (candidates.length === 0) {
      setBinding(null)
      return
    }
    let cancelled = false
    void resolveStructuredTuiOwner({
      target,
      candidates,
      terminal: { tabId, ptyIds: readTabPtyIds() }
    })
      .catch(() => ({ kind: 'none' }) as const)
      .then((resolution) => {
        if (cancelled) {
          return
        }
        setBinding(resolution.kind === 'owner' ? resolution.binding : null)
        setSettling(
          resolution.kind === 'settling' && settleAttemptsRef.current < SETTLING_RETRY_LIMIT
        )
      })
    return () => {
      cancelled = true
    }
  }, [enabled, paneCount, readTabPtyIds, settleRetry, tabId, worktreeId])

  useEffect(() => {
    if (!settling) {
      return
    }
    const timer = setTimeout(() => {
      settleAttemptsRef.current += 1
      setSettling(false)
      setSettleRetry((retry) => retry + 1)
    }, SETTLING_RETRY_MS)
    return () => clearTimeout(timer)
  }, [settling])

  const ownsLeaf = useCallback(
    (leafId: string | null): boolean =>
      binding !== null &&
      leafId !== null &&
      structuredTuiOwnerLeafMatches(binding, {
        paneKey: tryMakePaneKey(tabId, leafId),
        ptyId: readLeafPtyId(leafId),
        paneCount: managerRef.current?.getPanes().length ?? paneCount
      }),
    [binding, managerRef, paneCount, readLeafPtyId, tabId]
  )

  const returnLeafToChat = useCallback(
    async (leafId: string): Promise<boolean> => {
      if (!binding || !ownsLeaf(leafId)) {
        return false
      }
      const ptyId = readLeafPtyId(leafId)
      // Re-ask the host: the owner read for the label may have exited or moved since.
      const current = await resolveStructuredTuiOwner({
        target: readOwnerLookupInputs(worktreeId).target,
        candidates: [{ chatTabId: binding.chatTabId, sessionId: binding.sessionId }],
        terminal: { tabId, ptyIds: ptyId ? [ptyId] : [] }
      }).catch(() => ({ kind: 'none' }) as const)
      if (current.kind !== 'owner') {
        setBinding(null)
        return false
      }
      // Activate first: a request left for a Chat tab that is gone would only expire.
      if (!activateStructuredAgentSessionTab({ worktreeId, tabId: current.binding.chatTabId })) {
        setBinding(null)
        return false
      }
      requestStructuredChatReturn(current.binding.sessionId, { terminalTabId: tabId, ptyId })
      return true
    },
    [binding, ownsLeaf, readLeafPtyId, tabId, worktreeId]
  )

  return { ownsLeaf, returnLeafToChat }
}
