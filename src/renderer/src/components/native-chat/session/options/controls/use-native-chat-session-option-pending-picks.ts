import { useCallback, useState } from 'react'
import type {
  SessionOptionDescriptor,
  SessionOptionsSurface,
  SessionOptionValue
} from '../../../../../../../shared/native-chat/input/native-chat-session-options'
import { runSessionOptionSurfaceCall } from './native-chat-session-option-surface-call'
import {
  useQueuedSessionOptions,
  type QueuedSessionOptions
} from '../../../native-chat-queued-session-options'

/** A descriptor write in flight; its value shows until it settles. */
type PendingPick = { id: string; value?: SessionOptionValue }

// Show pending picks in place while open; refusal restores the host snapshot.
export function withPendingValue(
  descriptor: SessionOptionDescriptor,
  pending: PendingPick | null
): SessionOptionDescriptor {
  if (pending?.id !== descriptor.id) {
    return descriptor
  }
  const { kind } = descriptor
  if (kind.type === 'select' && typeof pending.value === 'string') {
    return {
      ...descriptor,
      valueSource: 'dispatched',
      kind: { ...kind, currentValue: pending.value }
    }
  }
  if (kind.type === 'boolean' && typeof pending.value === 'boolean') {
    return {
      ...descriptor,
      valueSource: 'dispatched',
      kind: { ...kind, currentValue: pending.value }
    }
  }
  return descriptor
}

/** Writes in flight per descriptor, plus the fork's choices held until a deferring agent's turn ends. */
export function useNativeChatSessionOptionPendingPicks(
  surface: SessionOptionsSurface | null,
  isWorking: boolean
): {
  pending: ReadonlyMap<string, PendingPick>
  markPending: (id: string) => (pick: PendingPick | null) => void
  queued: QueuedSessionOptions
  queue: ReturnType<typeof useQueuedSessionOptions>['queue']
} {
  const [pending, setPending] = useState<ReadonlyMap<string, PendingPick>>(() => new Map())
  const markPending = useCallback(
    (id: string) => (pick: PendingPick | null) => {
      setPending((current) => {
        const next = new Map(current)
        if (pick === null) {
          next.delete(id)
        } else {
          next.set(id, pick)
        }
        return next
      })
    },
    []
  )
  const flush = useCallback(
    (entries: [string, SessionOptionValue][]) => {
      const last = entries.at(-1)
      if (!surface || !last) {
        return
      }
      const [id, value] = last
      runSessionOptionSurfaceCall({ id, value }, markPending(id), async () => {
        for (const [optionId, selection] of entries) {
          await surface.setOption(optionId, selection)
        }
      })
    },
    [surface, markPending]
  )
  const { queued, queue } = useQueuedSessionOptions({ isWorking, flush })
  return { pending, markPending, queued, queue }
}
