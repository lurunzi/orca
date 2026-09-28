import { Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { NativeChatOrchestrationIdentity } from './use-native-chat-orchestration-identity'

export function NativeChatOrchestrationIdentityToggle({
  identity
}: {
  identity: NativeChatOrchestrationIdentity
}): React.JSX.Element | null {
  const { offered, status, pending, toggle } = identity

  if (!offered || status?.state === 'worker') {
    return null
  }

  const isEnabled = status?.state === 'enabled'
  const isUnavailable = status?.state === 'unavailable'
  const isDisabled = pending || status === null || isUnavailable

  const unavailableLabel = !isUnavailable
    ? null
    : status.reason === 'busy'
      ? translate('components.native-chat.orchestrationIdentity.busy', 'Busy — try after the turn')
      : translate('components.native-chat.orchestrationIdentity.unavailable', 'Unavailable')

  const tooltipText = unavailableLabel
    ? `${translate('components.native-chat.orchestrationIdentity.label', 'Orchestration identity')}: ${unavailableLabel}`
    : isEnabled
      ? translate(
          'components.native-chat.orchestrationIdentity.disableTooltip',
          'Orchestration identity: Active — click to disable'
        )
      : translate(
          'components.native-chat.orchestrationIdentity.enableTooltip',
          'Orchestration identity: Disabled — click to enable'
        )

  const accessibleName = isEnabled
    ? translate(
        'components.native-chat.orchestrationIdentity.activeAccessibleName',
        'Orchestration identity active'
      )
    : translate(
        'components.native-chat.orchestrationIdentity.inactiveAccessibleName',
        'Orchestration identity disabled'
      )

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="xs"
          variant={isEnabled ? 'secondary' : 'ghost'}
          disabled={isDisabled}
          aria-label={accessibleName}
          aria-pressed={isEnabled}
          onClick={() => void toggle(!isEnabled)}
          className="max-w-36 select-none"
        >
          <Workflow className="size-3 shrink-0" />
          <span className="truncate">
            {translate('components.native-chat.orchestrationIdentity.toggleLabel', 'Coordinator')}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  )
}
