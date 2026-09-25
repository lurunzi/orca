import type {
  AgentSessionHandoffDirection,
  AgentSessionHandoffMode,
  AgentSessionHandoffStatus
} from '../../../../shared/agent-session-wire'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { StructuredAgentSessionReleaseButton } from './StructuredAgentSessionReleaseButton'

type Props = {
  status: AgentSessionHandoffStatus | null
  isWorking: boolean
  onRequest: (
    direction: AgentSessionHandoffDirection,
    mode: AgentSessionHandoffMode,
    action?: 'start' | 'cancel-queued' | 'retry' | 'recover'
  ) => void
  /** Present where the host serves the user release of an ownerless reservation. */
  onRelease?: () => Promise<string | null>
}

// Same column as the composer and the status line beside it, so no row shifts the transcript.
const ROW = 'mx-auto flex w-full max-w-4xl items-center gap-2 px-4 py-1 text-xs'

function handoffStageCopy(status: AgentSessionHandoffStatus): string {
  if (status.stage === 'preparing') {
    return status.direction === 'to-tui'
      ? translate('components.native-chat.handoff.stage.finishingChat', 'Finishing chat session…')
      : translate(
          'components.native-chat.handoff.stage.finishingTerminal',
          'Finishing agent terminal…'
        )
  }
  if (status.stage === 'old-owner-stopped') {
    return status.direction === 'to-tui'
      ? translate('components.native-chat.handoff.stage.openingTerminal', 'Opening agent terminal…')
      : translate('components.native-chat.handoff.stage.resumingChat', 'Resuming chat session…')
  }
  if (status.stage === 'new-owner-proving') {
    return status.direction === 'to-tui'
      ? translate(
          'components.native-chat.handoff.stage.verifyingTerminal',
          'Verifying agent terminal…'
        )
      : translate('components.native-chat.handoff.stage.verifyingChat', 'Verifying chat session…')
  }
  if (status.stage === 'recovering') {
    return translate('components.native-chat.handoff.stage.recovering', 'Recovering agent session…')
  }
  if (status.stage === 'manual-recovery') {
    return translate(
      'components.native-chat.handoff.stage.manualRecovery',
      'Agent session needs recovery'
    )
  }
  return translate('components.native-chat.handoff.switchingOwner', 'Switching session owner…')
}

/** One status row for a session that is not plainly chat-owned; the chat-owned entry lives in
 *  the composer toolbar so an idle chat carries no extra row. */
export function StructuredAgentSessionHandoffChrome({
  status,
  isWorking,
  onRequest,
  onRelease
}: Props): React.JSX.Element | null {
  if (!status) {
    return null
  }
  const { phase } = status
  if (phase === 'queued' && status.direction) {
    const direction = status.direction
    return (
      <div className={cn(ROW, 'text-muted-foreground')}>
        <span>
          {direction === 'to-tui'
            ? translate(
                'components.native-chat.handoff.switchingAfterTurn',
                'Switching after this turn'
              )
            : translate(
                'components.native-chat.handoff.returningAfterTurn',
                'Returning after this turn'
              )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto"
          onClick={() => onRequest(direction, 'after-turn', 'cancel-queued')}
        >
          {translate('components.native-chat.handoff.cancel', 'Cancel')}
        </Button>
      </div>
    )
  }
  if (status.owner === 'tui' && phase === 'idle') {
    return (
      <div className={ROW}>
        <span className="text-muted-foreground">
          {status.hostLabel
            ? translate(
                'components.native-chat.handoff.agentOpenOnHost',
                'Agent is open in terminal on {{value0}}.',
                { value0: status.hostLabel }
              )
            : translate('components.native-chat.handoff.agentOpen', 'Agent is open in terminal.')}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto"
          onClick={() => onRequest('to-native', 'after-turn')}
        >
          {isWorking
            ? translate('components.native-chat.handoff.returnAfterTurn', 'Return after this turn')
            : translate('components.native-chat.handoff.returnToChat', 'Return to chat')}
        </Button>
      </div>
    )
  }
  if (phase === 'switching' || phase === 'waiting-for-exit') {
    return (
      <div className={cn(ROW, 'text-muted-foreground')} role="status">
        {phase === 'waiting-for-exit'
          ? translate(
              'components.native-chat.handoff.exitTerminal',
              'Exit the agent terminal to continue in chat.'
            )
          : handoffStageCopy(status)}
      </div>
    )
  }
  if (phase !== 'failed' || !status.error) {
    return null
  }
  const { error } = status
  const direction = status.direction
  return (
    <div className={cn(ROW, 'flex-wrap text-destructive')} role="alert">
      <span>{error.message}</span>
      <div className="ml-auto flex items-center gap-1.5">
        {direction && error.canRetryProof ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onRequest(direction, 'now', 'recover')}
          >
            {translate('components.native-chat.handoff.retryProof', 'Retry proof')}
          </Button>
        ) : direction && error.recoverableOwner !== 'none' ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onRequest(direction, 'now', 'retry')}
          >
            {translate('components.native-chat.handoff.retry', 'Retry')}
          </Button>
        ) : null}
        {error.releaseFence !== undefined && onRelease ? (
          <StructuredAgentSessionReleaseButton onRelease={onRelease} />
        ) : null}
      </div>
      {error.details ? (
        <details className="w-full text-muted-foreground">
          <summary>{translate('components.native-chat.handoff.details', 'Details')}</summary>
          <p className="mt-1">{error.details}</p>
        </details>
      ) : null}
    </div>
  )
}
