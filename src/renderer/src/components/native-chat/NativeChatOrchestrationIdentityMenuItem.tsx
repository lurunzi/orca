import { DropdownMenuCheckboxItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import {
  useNativeChatOrchestrationIdentity,
  type NativeChatOrchestrationIdentity
} from './use-native-chat-orchestration-identity'

export type NativeChatOrchestrationIdentityMenuItemProps = {
  sessionId: string
  target: RuntimeClientTarget
  identity?: NativeChatOrchestrationIdentity
}

/** Mounted only while the context menu is open, or passed an existing session identity. */
export function NativeChatOrchestrationIdentityMenuItem({
  sessionId,
  target,
  identity: externalIdentity
}: NativeChatOrchestrationIdentityMenuItemProps): React.JSX.Element | null {
  const localIdentity = useNativeChatOrchestrationIdentity({
    sessionId,
    target,
    enabled: externalIdentity === undefined
  })
  const identity = externalIdentity ?? localIdentity
  const { offered, status, pending, toggle } = identity

  if (!offered || status?.state === 'worker') {
    return null
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
        onCheckedChange={(checked) => void toggle(checked === true)}
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
