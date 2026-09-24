import { useEffect, useState } from 'react'
import type {
  SessionOptionDescriptor,
  SessionOptionValue
} from '../../../../shared/native-chat-session-options'

export type QueuedSessionOptions = ReadonlyMap<string, SessionOptionValue>

/** Shows a pick queued mid-turn as the descriptor's value until the turn ends and it is applied. */
export function withQueuedSessionOption(
  descriptor: SessionOptionDescriptor,
  queued: QueuedSessionOptions
): SessionOptionDescriptor {
  const value = queued.get(descriptor.id)
  if (value === undefined) {
    return descriptor
  }
  const kind =
    descriptor.kind.type === 'boolean'
      ? { ...descriptor.kind, currentValue: value === true }
      : { ...descriptor.kind, currentValue: String(value) }
  return { ...descriptor, kind, valueSource: 'applied' }
}

/**
 * Picks made while the agent is working are held and flushed in order once it goes idle,
 * so a model chosen mid-turn is a pre-selection for the next turn instead of a blocked control.
 */
export function useQueuedSessionOptions(args: {
  isWorking: boolean
  flush: (entries: [string, SessionOptionValue][]) => void
}): {
  queued: QueuedSessionOptions
  queue: (id: string, value: SessionOptionValue) => void
} {
  const { isWorking, flush } = args
  const [queued, setQueued] = useState<QueuedSessionOptions>(() => new Map())

  useEffect(() => {
    if (isWorking || queued.size === 0) {
      return
    }
    setQueued(new Map())
    flush([...queued])
  }, [flush, isWorking, queued])

  const queue = (id: string, value: SessionOptionValue): void => {
    setQueued((previous) => new Map(previous).set(id, value))
  }
  return { queued, queue }
}
