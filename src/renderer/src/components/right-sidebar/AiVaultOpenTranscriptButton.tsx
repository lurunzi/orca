import { MessagesSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { openCursorTranscriptTab } from '@/lib/cursor-transcript-tab'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { parseExecutionHostId } from '../../../../shared/execution-host'

/** The workspace a Cursor session's read-only transcript tab opens in; SSH transcripts stay remote. */
export function cursorTranscriptWorktreeId(
  session: AiVaultSession,
  worktreeId: string | null | undefined
): string | null {
  return session.agent === 'cursor' && parseExecutionHostId(session.executionHostId)?.kind !== 'ssh'
    ? (worktreeId ?? null)
    : null
}

/** Opens a Cursor session's transcript as a read-only tab; absent where none can open. */
export function AiVaultOpenTranscriptButton({
  session,
  worktreeId: candidateWorktreeId
}: {
  session: AiVaultSession
  worktreeId: string | null | undefined
}): React.JSX.Element | null {
  const worktreeId = cursorTranscriptWorktreeId(session, candidateWorktreeId)
  if (!worktreeId) {
    return null
  }
  return (
    <Button
      variant="secondary"
      size="xs"
      onClick={() => {
        if (openCursorTranscriptTab(session, worktreeId)) {
          activateAndRevealWorktree(worktreeId)
        }
      }}
    >
      <MessagesSquare className="size-3.5" />
      {translate('components.native-chat.openTranscript', 'Open conversation')}
    </Button>
  )
}
