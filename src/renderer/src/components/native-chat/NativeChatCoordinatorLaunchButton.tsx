import { useState } from 'react'
import { Network } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function coordinatorPrompt(): string {
  return translate(
    'components.native-chat.coordinator.prompt',
    'Use Orca orchestration to coordinate: '
  )
}

/** Prefixes the coordinator prompt onto the current draft; a repeat click leaves it as is. */
export function withCoordinatorPrompt(draft: string, prompt: string): string {
  return draft.trimStart().startsWith(prompt.trim()) ? draft : `${prompt}${draft.trimStart()}`
}

export function NativeChatCoordinatorLaunchButton({
  onInsert,
  identitySessionId
}: {
  onInsert: () => void
  /** Local structured session to grant coordinator identity; PTY agents already reach the CLI. */
  identitySessionId?: string
}): React.JSX.Element {
  const [granting, setGranting] = useState(false)
  const label = translate('components.native-chat.coordinator.insert', 'Coordinate with Orca')

  const grantIdentity = async (sessionId: string): Promise<void> => {
    const identity = window.api.orchestrationIdentity
    if (!identity) {
      throw new Error('Orchestration identity is not available.')
    }
    let status = await identity.get(sessionId)
    if (status.state === 'disabled') {
      status = await identity.set(sessionId, true)
    }
    if (status.state === 'unavailable') {
      throw new Error(
        status.reason === 'busy'
          ? translate(
              'components.native-chat.orchestrationIdentity.busy',
              'Busy — try after the turn'
            )
          : status.reason
      )
    }
  }

  const insert = (): void => {
    onInsert()
    if (!identitySessionId || granting) {
      return
    }
    setGranting(true)
    grantIdentity(identitySessionId)
      .catch((error: unknown) => {
        toast.error(
          translate(
            'components.native-chat.coordinator.identityFailed',
            'Coordinator access not granted'
          ),
          { description: error instanceof Error ? error.message : String(error) }
        )
      })
      .finally(() => setGranting(false))
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={insert}
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
