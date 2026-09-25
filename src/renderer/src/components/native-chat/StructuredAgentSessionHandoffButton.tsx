import { MessageSquare, SquareTerminal } from 'lucide-react'
import type {
  AgentSessionHandoffDirection,
  AgentSessionHandoffMode,
  AgentSessionHandoffStatus
} from '../../../../shared/agent-session-wire'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

type Props = {
  status: AgentSessionHandoffStatus | null
  isWorking: boolean
  onRequest: (direction: AgentSessionHandoffDirection, mode: AgentSessionHandoffMode) => void
}

/** Top-right chat/agent-terminal toggle, matching the terminal-backed chat's pane-header toggle:
 *  pressed while chat owns the session, and a way back while the agent terminal owns it. */
export function StructuredAgentSessionHandoffButton({
  status,
  isWorking,
  onRequest
}: Props): React.JSX.Element | null {
  if (status?.phase !== 'idle') {
    return null
  }
  if (status.owner === 'tui') {
    const label = isWorking
      ? translate('components.native-chat.handoff.returnAfterTurn', 'Return after this turn')
      : translate('components.native-chat.handoff.returnToChat', 'Return to chat')
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-pressed={false}
            onClick={() => onRequest('to-native', 'after-turn')}
            className="pointer-coarse:size-11"
          >
            <MessageSquare className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
    )
  }
  if (status.owner !== 'native') {
    return null
  }
  const label = translate('components.native-chat.handoff.openAgentTui', 'Open agent TUI')
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      aria-pressed
      // A submitted turn can reach the host before isWorking updates; after-turn is immediate when idle.
      onClick={isWorking ? undefined : () => onRequest('to-tui', 'after-turn')}
      className="pointer-coarse:size-11"
    >
      <SquareTerminal className="size-3" />
    </Button>
  )
  if (!isWorking) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end">
        <DropdownMenuItem onSelect={() => onRequest('to-tui', 'after-turn')}>
          {translate('components.native-chat.handoff.switchAfterTurn', 'Switch after this turn')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onRequest('to-tui', 'stop-turn')}>
          {translate('components.native-chat.handoff.stopTurnAndSwitch', 'Stop turn and switch')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
