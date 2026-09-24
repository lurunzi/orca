import { useRef, useState } from 'react'
import { Network } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentType } from '../../../../shared/agent-status-types'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { useAppStore } from '@/store'
import { findRenamableUnifiedTab } from '@/store/terminals/renamable-unified-tab'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function NativeChatCoordinatorLaunchButton({
  agent,
  terminalTabId
}: {
  agent: AgentType
  terminalTabId: string
}): React.JSX.Element {
  const [starting, setStarting] = useState(false)
  const lastLaunchAt = useRef(0)
  const label = translate('components.native-chat.coordinator.new', 'New coordinator session')

  const start = (): void => {
    if (starting || Date.now() - lastLaunchAt.current < 1000) {
      return
    }
    lastLaunchAt.current = Date.now()
    const state = useAppStore.getState()
    const sourceTab = findRenamableUnifiedTab(state.unifiedTabsByWorktree ?? {}, terminalTabId)
    const worktreeId =
      sourceTab?.worktreeId ??
      Object.entries(state.tabsByWorktree ?? {}).find(([, tabs]) =>
        tabs.some((tab) => tab.id === terminalTabId)
      )?.[0]
    if (!isTuiAgent(agent) || !worktreeId) {
      toast.error(
        translate(
          'components.native-chat.coordinator.launchFailed',
          'Could not start coordinator session'
        )
      )
      return
    }

    setStarting(true)
    try {
      const result = launchAgentInNewTab({
        agent,
        worktreeId,
        groupId: sourceTab?.groupId,
        prompt: translate(
          'components.native-chat.coordinator.prompt',
          'Use Orca orchestration to coordinate: '
        ),
        promptDelivery: 'draft'
      })
      if (!result) {
        throw new Error('No agent launch plan was available.')
      }
      if (result.surface.kind !== 'local-agent-session') {
        setStarting(false)
        return
      }
      const identity = window.api.orchestrationIdentity
      if (!identity || !result.structuredSettlement) {
        toast.error(
          translate(
            'components.native-chat.coordinator.identityFailed',
            'Session opened without coordinator access'
          )
        )
        setStarting(false)
        return
      }
      void result.structuredSettlement
        .then(async (settlement) => {
          if (settlement.kind === 'cancelled') {
            return
          }
          if (settlement.kind === 'visibility-unknown') {
            toast.error(
              translate(
                'components.native-chat.coordinator.visibilityUnknown',
                'Could not verify coordinator session'
              )
            )
            return
          }
          if (settlement.kind === 'failed') {
            toast.error(
              translate(
                'components.native-chat.coordinator.launchFailed',
                'Could not start coordinator session'
              ),
              {
                description:
                  settlement.error instanceof Error
                    ? settlement.error.message
                    : String(settlement.error)
              }
            )
            return
          }
          try {
            const status = await identity.set(settlement.sessionId, true)
            if (status.state !== 'enabled') {
              throw new Error(
                status.state === 'unavailable'
                  ? status.reason
                  : 'Coordinator identity was not granted.'
              )
            }
          } catch (error) {
            toast.error(
              translate(
                'components.native-chat.coordinator.identityFailed',
                'Session opened without coordinator access'
              ),
              { description: error instanceof Error ? error.message : String(error) }
            )
          }
        })
        .catch((error: unknown) => {
          toast.error(
            translate(
              'components.native-chat.coordinator.launchFailed',
              'Could not start coordinator session'
            ),
            { description: error instanceof Error ? error.message : String(error) }
          )
        })
        .finally(() => setStarting(false))
    } catch (error) {
      setStarting(false)
      toast.error(
        translate(
          'components.native-chat.coordinator.launchFailed',
          'Could not start coordinator session'
        ),
        { description: error instanceof Error ? error.message : String(error) }
      )
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={starting}
          onClick={start}
          className="pointer-coarse:size-11"
        >
          <Network className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
