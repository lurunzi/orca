import { useCallback, useEffect, useState } from 'react'
import { Network } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { StructuredSessionOrchestrationIdentityStatus } from '../../../../shared/structured-session-orchestration-identity'
import { useQueuedSessionOptions } from './native-chat-queued-session-options'

const COORDINATOR_KEY = 'coordinator'

/**
 * One-click coordinator identity for the current structured session. Nothing is written into
 * the draft; a click during a turn is held and applied once the turn ends.
 */
export function NativeChatCoordinatorToggle({
  sessionId,
  isWorking
}: {
  sessionId: string
  isWorking: boolean
}): React.JSX.Element | null {
  const api = window.api.orchestrationIdentity
  const [status, setStatus] = useState<StructuredSessionOrchestrationIdentityStatus | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!api) {
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
  }, [api, sessionId])

  const apply = useCallback(
    (enabled: boolean): void => {
      if (!api) {
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

  // Why: remote/SSH sessions and dispatched workers cannot hold a user-granted identity.
  if (
    !api ||
    status === null ||
    status.state === 'worker' ||
    (status.state === 'unavailable' && status.reason !== 'busy')
  ) {
    return null
  }

  const enabled = typeof queuedValue === 'boolean' ? queuedValue : status.state === 'enabled'
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
        <Toggle
          size="sm"
          aria-label={label}
          pressed={enabled}
          disabled={pending}
          onPressedChange={onPressedChange}
          className="pointer-coarse:size-11"
        >
          <Network className="size-4" />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        <div>{label}</div>
        {queuedValue !== undefined && queuedValue !== (status.state === 'enabled') ? (
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
