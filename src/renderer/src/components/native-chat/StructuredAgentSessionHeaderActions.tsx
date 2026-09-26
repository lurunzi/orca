import { MessageSquarePlus, SquareSplitVertical } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import {
  canMoveTabToNewPaneColumnFromState,
  moveTabToNewPaneColumn
} from '@/components/tab-bar/tab-move-to-pane-column'

type Props = {
  tabId: string
  groupId?: string
  /** Absent when there is no session context to continue from. */
  onContinueInNewSession?: () => void
}

/** Top-right cluster of a standalone structured Chat, mirroring the terminal pane header's
 *  [continue][split] order. */
export function StructuredAgentSessionHeaderActions({
  tabId,
  groupId,
  onContinueInNewSession
}: Props): React.JSX.Element {
  const canSplit = useAppStore((state) =>
    groupId ? canMoveTabToNewPaneColumnFromState(state, tabId, groupId) : false
  )
  const splitLabel = translate(
    'auto.components.tab.bar.TabWorkspaceLayoutMenuSection.moveToPaneColumn',
    'Move Tab to Split'
  )
  const continueLabel = translate(
    'components.agentSessionContinuation.continueInNewSession',
    'Continue in New Session…'
  )
  return (
    <div className="absolute right-1 top-1 z-20 flex items-center">
      {onContinueInNewSession ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={continueLabel}
              onClick={onContinueInNewSession}
              className="pointer-coarse:size-11"
            >
              <MessageSquarePlus className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {continueLabel}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {canSplit && groupId ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={splitLabel}
              onClick={() => {
                moveTabToNewPaneColumn({ unifiedTabId: tabId, groupId, direction: 'right' })
              }}
              className="pointer-coarse:size-11"
            >
              <SquareSplitVertical className="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {splitLabel}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
