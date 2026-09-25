import { SquareTerminal } from 'lucide-react'
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

/** Composer toolbar entry for moving a chat-owned session into its agent terminal. */
export function StructuredAgentSessionHandoffButton({
  status,
  isWorking,
  onRequest
}: Props): React.JSX.Element | null {
  if (status?.owner !== 'native' || status.phase !== 'idle') {
    return null
  }
  const label = translate('components.native-chat.handoff.openAgentTui', 'Open agent TUI')
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      // A submitted turn can reach the host before isWorking updates; after-turn is immediate when idle.
      onClick={isWorking ? undefined : () => onRequest('to-tui', 'after-turn')}
      className="pointer-coarse:size-11"
    >
      <SquareTerminal className="size-4" />
    </Button>
  )
  if (!isWorking) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{trigger}</TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
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
