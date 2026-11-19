import { MessagesSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { openCursorTranscriptTab } from '@/lib/cursor-transcript-tab'
import { activateAndRevealWorktree } from '@/lib/workspace/activation/worktree-activation'
import type { AiVaultSession } from '../../../../shared/ai-vault/contracts/ai-vault-types'
import { parseExecutionHostId } from '../../../../shared/execution-host/execution-host'

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
  const t = useTranslate()
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
      {t('components.native-chat.openTranscript', 'Open conversation')}
    </Button>
  )
}
