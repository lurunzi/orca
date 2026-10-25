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
  /** The session inbox button, for agents that have one. */
  inbox?: React.ReactNode
}

/** The session's own actions, [inbox][continue], placed first in whichever header shows them. */
export function StructuredAgentSessionTitleActions({
  onContinueInNewSession,
  inbox,
  variant = 'ghost'
}: Pick<Props, 'onContinueInNewSession' | 'inbox'> & {
  variant?: 'ghost' | 'pane-title'
}): React.JSX.Element {
  const continueLabel = translate(
    'components.agentSessionContinuation.continueInNewSession',
    'Continue in New Session…'
  )
  return (
    <>
      {inbox}
      {onContinueInNewSession ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={variant}
              size="icon-xs"
              aria-label={continueLabel}
              onClick={(event) => {
                event.stopPropagation()
                onContinueInNewSession()
              }}
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
    </>
  )
}

/** Top-right cluster of a structured Chat without a pane header, mirroring the terminal pane
 *  header's [continue][split] order, with the session inbox first. */
export function StructuredAgentSessionHeaderActions({
  tabId,
  groupId,
  onContinueInNewSession,
  inbox
}: Props): React.JSX.Element {
  const canSplit = useAppStore((state) =>
    groupId ? canMoveTabToNewPaneColumnFromState(state, tabId, groupId) : false
  )
  const splitLabel = translate(
    'auto.components.tab.bar.TabWorkspaceLayoutMenuSection.moveToPaneColumn',
    'Move Tab to Split'
  )
  return (
    <div className="absolute right-1 top-1 z-20 flex items-center">
      <StructuredAgentSessionTitleActions
        onContinueInNewSession={onContinueInNewSession}
        inbox={inbox}
      />
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
