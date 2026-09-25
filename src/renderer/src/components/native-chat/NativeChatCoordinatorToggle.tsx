import { useCallback, useEffect, useState } from 'react'
import { Network } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { StructuredSessionOrchestrationIdentityStatus } from '../../../../shared/structured-session-orchestration-identity'
import { useQueuedSessionOptions } from './native-chat-queued-session-options'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'

const COORDINATOR_KEY = 'coordinator'

/** Why a chat cannot coordinate, known before any identity read. */
export type CoordinatorUnavailableReason = 'terminal-agent' | 'remote'

export function coordinatorTargetFor(
  transport: NativeChatStructuredComposerTransport | undefined
): { sessionId: string | null; unavailableReason?: CoordinatorUnavailableReason } {
  if (transport?.runtime === 'local') {
    return { sessionId: transport.sessionId }
  }
  return { sessionId: null, unavailableReason: transport ? 'remote' : 'terminal-agent' }
}

function unavailableReasonLabel(
  reason: CoordinatorUnavailableReason | undefined,
  status: StructuredSessionOrchestrationIdentityStatus | null
): string | null {
  if (reason === 'terminal-agent') {
    return translate(
      'components.native-chat.coordinator.terminalAgent',
      'Only Claude and Codex chats can coordinate'
    )
  }
  if (reason === 'remote' || (status?.state === 'unavailable' && status.reason === 'not-local')) {
    return translate(
      'components.native-chat.coordinator.remote',
      'Only chats on this computer can coordinate'
    )
  }
  if (status?.state === 'worker') {
    return translate(
      'components.native-chat.coordinator.worker',
      'A dispatched worker cannot coordinate'
    )
  }
  if (status === null || (status.state === 'unavailable' && status.reason !== 'busy')) {
    return translate('components.native-chat.orchestrationIdentity.unavailable', 'Unavailable')
  }
  return null
}

/**
 * One-click coordinator identity for the current structured session. Nothing is written into
 * the draft; a click during a turn is held and applied once the turn ends.
 */
export function NativeChatCoordinatorToggle({
  sessionId,
  unavailableReason,
  isWorking
}: {
  sessionId: string | null
  unavailableReason?: CoordinatorUnavailableReason
  isWorking: boolean
}): React.JSX.Element | null {
  const api = window.api.orchestrationIdentity
  const [status, setStatus] = useState<StructuredSessionOrchestrationIdentityStatus | null>(null)
  const [pending, setPending] = useState(false)
  const [readRequest, setReadRequest] = useState(0)

  // Why re-read on turn edges and hover: `missing` is transient (the durable record or host
  // may not exist yet when the composer mounts), so one mount-time read can go stale.
  useEffect(() => {
    if (!api || !sessionId) {
      return
    }
    let live = true
    void api
      .get(sessionId)
      .then((next) => live && setStatus(next))
      .catch(() => live && setStatus({ state: 'unavailable', reason: 'missing' }))
    return () => {
      live = false
    }
  }, [api, sessionId, isWorking, readRequest])

  const apply = useCallback(
    (enabled: boolean): void => {
      if (!api || !sessionId) {
        return
      }
      setPending(true)
      void api
        .set(sessionId, enabled)
        .then((next) => {
          setStatus(next)
          if (next.state === 'unavailable') {
            throw new Error(
              next.reason === 'busy'
                ? translate(
                    'components.native-chat.orchestrationIdentity.busy',
                    'Busy — try after the turn'
                  )
                : next.reason
            )
          }
        })
        .catch((error: unknown) => {
          toast.error(
            translate(
              'components.native-chat.orchestrationIdentity.updateFailed',
              'Could not change orchestration identity'
            ),
            { description: error instanceof Error ? error.message : String(error) }
          )
        })
        .finally(() => setPending(false))
    },
    [api, sessionId]
  )

  const flush = useCallback(
    (entries: [string, unknown][]) => {
      const wanted = entries.find(([key]) => key === COORDINATOR_KEY)?.[1]
      if (typeof wanted === 'boolean' && wanted !== (status?.state === 'enabled')) {
        apply(wanted)
      }
    },
    [apply, status]
  )
  const { queued, queue } = useQueuedSessionOptions({ isWorking, flush })
  const queuedValue = queued.get(COORDINATOR_KEY)

  if (!api) {
    return null
  }
  // Why disabled, not hidden: a missing button reads as a bug; the tooltip says why.
  const reason = unavailableReasonLabel(unavailableReason, status)
  const ready = reason === null
  const enabled = typeof queuedValue === 'boolean' ? queuedValue : status?.state === 'enabled'
  const label = translate('components.native-chat.coordinator.toggle', 'Coordinator mode')
  const onPressedChange = (next: boolean): void => {
    if (isWorking) {
      queue(COORDINATOR_KEY, next)
      return
    }
    apply(next)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Why a wrapper: a disabled toggle drops pointer events, and hovering is the re-read cue. */}
        <span
          className="inline-flex"
          onPointerEnter={ready ? undefined : () => setReadRequest((count) => count + 1)}
        >
          <Toggle
            size="sm"
            aria-label={label}
            pressed={enabled}
            disabled={pending || !ready}
            onPressedChange={onPressedChange}
            className="pointer-coarse:size-11"
          >
            <Network className="size-4" />
          </Toggle>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        <div>{label}</div>
        {reason ? <div>{reason}</div> : null}
        {queuedValue !== undefined && queuedValue !== (status?.state === 'enabled') ? (
          <div>
            {translate(
              'components.native-chat.composer.appliesNextTurn',
              'Applies after this turn'
            )}
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}
