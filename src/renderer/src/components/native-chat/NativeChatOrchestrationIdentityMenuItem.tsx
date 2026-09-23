import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { DropdownMenuCheckboxItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import type { StructuredSessionOrchestrationIdentityStatus } from '../../../../shared/structured-session-orchestration-identity'

type NativeChatOrchestrationIdentityMenuItemProps = {
  sessionId: string
  target: RuntimeClientTarget
}

/** Mounted only while the context menu is open, so status loads lazily per open. */
export function NativeChatOrchestrationIdentityMenuItem({
  sessionId,
  target
}: NativeChatOrchestrationIdentityMenuItemProps): React.JSX.Element | null {
  const api = window.api.orchestrationIdentity
  // Why: structured identities are local-only; paired/remote runtimes cannot grant one.
  const offered = api !== undefined && target.kind === 'local'
  const [status, setStatus] = useState<StructuredSessionOrchestrationIdentityStatus | null>(null)
  const [pending, setPending] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!offered) {
      return
    }
    void api
      .get(sessionId)
      .then((next) => {
        if (mountedRef.current) {
          setStatus(next)
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setStatus({ state: 'unavailable', reason: 'missing' })
        }
      })
  }, [api, offered, sessionId])

  if (!offered || status?.state === 'worker') {
    return null
  }

  const onCheckedChange = (checked: boolean): void => {
    setPending(true)
    void api
      .set(sessionId, checked)
      .then((next) => {
        if (mountedRef.current) {
          setStatus(next)
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
      .finally(() => {
        if (mountedRef.current) {
          setPending(false)
        }
      })
  }

  const unavailableLabel =
    status?.state !== 'unavailable'
      ? null
      : status.reason === 'busy'
        ? translate(
            'components.native-chat.orchestrationIdentity.busy',
            'Busy — try after the turn'
          )
        : translate('components.native-chat.orchestrationIdentity.unavailable', 'Unavailable')

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        checked={status?.state === 'enabled'}
        disabled={pending || status === null || status.state === 'unavailable'}
        onCheckedChange={(checked) => onCheckedChange(checked === true)}
        // Why: keep the menu open so the settled state is visible after the provider restarts.
        onSelect={(event) => event.preventDefault()}
      >
        {translate('components.native-chat.orchestrationIdentity.label', 'Orchestration identity')}
        {unavailableLabel ? (
          <span className="ml-auto text-[11px] text-muted-foreground">{unavailableLabel}</span>
        ) : null}
      </DropdownMenuCheckboxItem>
    </>
  )
}
