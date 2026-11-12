import { isAntigravityReferenceSession } from '../../../../../../shared/antigravity-session-origin'

import type React from 'react'
import {
  FileJson,
  Folder,
  FolderGit2,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  Play,
  SquareTerminal
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  isAiVaultSessionResumableContent,
  type AiVaultScope,
  type AiVaultSession
} from '../../../../../../shared/ai-vault/contracts/ai-vault-types'
import { useTranslate } from '@/i18n/use-translate'
import { AiVaultOpenTranscriptButton, FirstPromptCard } from './ai-vault-first-prompt-card'
import { ConversationTurnCard } from './AiVaultConversationTurnCard'
import { ResumeInNewCliTooltipText } from '../session-actions/ai-vault-session-cli-fork-copy'
import {
  sessionDetailConversationTurns,
  sessionPromptPreview
} from '../../../../../../shared/ai-vault/session-display/ai-vault-session-display'
import {
  type AiVaultSubagentResumeActions,
  SessionSubagentsSection
} from './AiVaultSessionSubagents'
import { SessionUnsavedConversationNotice } from './AiVaultSessionUnsavedNotice'
import { useAiVaultSessionAccount } from '../accounts/ai-vault-session-account'
import { SessionAccountSection } from '../accounts/AiVaultSessionAccount'
import { SessionReceiptSection } from './AiVaultSessionReceiptSection'
import './ai-vault-session-worktree'
import {
  aiVaultResumeInSessionWorkspaceLabel,
  aiVaultSessionWorkspaceHeading,
  isAiVaultFolderWorkspaceId,
  aiVaultWorktreeStatusLabel,
  shouldShowAiVaultWorktreeStatusBadge,
  shouldShowAiVaultSessionWorktreeLine
} from './ai-vault-session-worktree-affordances'
import {
  aiVaultWorktreeCompactPath,
  type AiVaultSessionWorktreeInfo
} from '../../../../../../shared/ai-vault/session-display/ai-vault-session-worktree'

export function SessionInlineDetails({
  id,
  session,
  worktreeInfo,
  vaultScope,
  resumeActions,
  onResumeInWorktree,
  onResumeInNewTab,
  subagentResume,
  onContinueInNewSession,
  onResumeInNewChat,
  onResumeInNewCli,
  onOpenLog,
  actionsHidden = false
}: {
  id: string
  session: AiVaultSession
  worktreeInfo: AiVaultSessionWorktreeInfo | null
  vaultScope: AiVaultScope
  resumeActions: {
    worktree: { worktreeId: string | null; disabled: boolean }
    newTab: { worktreeId: string | null; disabled: boolean }
  }
  onResumeInWorktree: () => void
  onResumeInNewTab: () => void
  subagentResume?: AiVaultSubagentResumeActions | null
  onContinueInNewSession?: () => void
  onResumeInNewChat?: () => void
  onResumeInNewCli?: () => void
  onOpenLog?: () => void
  /** Hides the action bar; the details stay. */
  actionsHidden?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  // Zero-turn sessions cannot resume meaningful content; show not-saved status instead.
  const referenceSession = isAntigravityReferenceSession(session)
  const hasResumableContent = isAiVaultSessionResumableContent(session)
  const showResumeInWorktree = hasResumableContent && Boolean(resumeActions.worktree.worktreeId)
  const showResumeInNewTab =
    hasResumableContent &&
    (!resumeActions.worktree.worktreeId || Boolean(resumeActions.newTab.worktreeId))
  const promptPreview = sessionPromptPreview(session)
  const detailTurns = sessionDetailConversationTurns(session, 3)
  const accountLabel = useAiVaultSessionAccount(session)

  return (
    <div
      id={id}
      className="mt-2 overflow-hidden rounded-lg border border-sidebar-border/80 bg-background/50 shadow-xs"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      {!actionsHidden &&
      (showResumeInWorktree ||
        showResumeInNewTab ||
        onContinueInNewSession ||
        onResumeInNewChat ||
        onResumeInNewCli ||
        onOpenLog) ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-sidebar-border/80 bg-sidebar-accent/15 px-3 py-2">
          <AiVaultOpenTranscriptButton session={session} worktreeId={worktreeInfo?.worktreeId} />
          {showResumeInWorktree ? (
            <Button
              type="button"
              variant="default"
              size="xs"
              disabled={resumeActions.worktree.disabled}
              draggable={false}
              onClick={(event) => {
                event.stopPropagation()
                onResumeInWorktree()
              }}
              className="h-7 shrink-0 px-2.5 text-[11px]"
            >
              <Play className="size-3.5" />
              {referenceSession
                ? t('aiVault.continueInCli', 'Continue in CLI')
                : aiVaultResumeInSessionWorkspaceLabel(resumeActions.worktree.worktreeId, t)}
            </Button>
          ) : null}
          {showResumeInNewTab ? (
            <Button
              type="button"
              variant={showResumeInWorktree ? 'secondary' : 'default'}
              size="xs"
              disabled={resumeActions.newTab.disabled}
              draggable={false}
              onClick={(event) => {
                event.stopPropagation()
                onResumeInNewTab()
              }}
              className="h-7 shrink-0 px-2.5 text-[11px]"
            >
              <Play className="size-3.5" />
              {referenceSession
                ? t('aiVault.continueInCliNewTab', 'Continue in CLI in New Tab')
                : t(
                    'auto.components.right.sidebar.AiVaultSessionRow.resumeInNewTab',
                    'Resume in New Tab'
                  )}
            </Button>
          ) : null}
          {onResumeInNewChat ? (
            <Button
              type="button"
              variant="secondary"
              size="xs"
              draggable={false}
              onClick={(event) => {
                event.stopPropagation()
                onResumeInNewChat()
              }}
              className="h-7 shrink-0 px-2.5 text-[11px]"
            >
              <MessagesSquare className="size-3.5" />
              {t(
                'auto.components.right.sidebar.AiVaultSessionRow.resumeInNewNativeChat',
                'Resume in New Chat'
              )}
            </Button>
          ) : null}
          {onResumeInNewCli ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  draggable={false}
                  onClick={(event) => {
                    event.stopPropagation()
                    onResumeInNewCli()
                  }}
                  className="h-7 shrink-0 px-2.5 text-[11px]"
                >
                  <SquareTerminal className="size-3.5" />
                  {t(
                    'auto.components.right.sidebar.AiVaultSessionRow.resumeInNewCli',
                    'Resume in New Terminal'
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                <ResumeInNewCliTooltipText />
              </TooltipContent>
            </Tooltip>
          ) : null}
          {onContinueInNewSession ? (
            <Button
              type="button"
              variant="secondary"
              size="xs"
              draggable={false}
              onClick={(event) => {
                event.stopPropagation()
                onContinueInNewSession()
              }}
              className="h-7 shrink-0 px-2.5 text-[11px]"
            >
              <MessageSquarePlus className="size-3.5" />
              {t(
                'components.agentSessionContinuation.handOffToAnotherAgent',
                'Hand Off to Another Agent'
              )}
            </Button>
          ) : null}
          {onOpenLog ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              draggable={false}
              onClick={(event) => {
                event.stopPropagation()
                onOpenLog()
              }}
              className="h-7 shrink-0 px-2.5 text-[11px] text-muted-foreground"
            >
              <FileJson className="size-3.5" />
              {t('auto.components.right.sidebar.AiVaultSessionDetails.viewLog', 'View Log')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3 p-3">
        {hasResumableContent ? (
          <>
            <FirstPromptCard
              key={session.id}
              session={session}
              preview={promptPreview}
              copyHidden={actionsHidden}
            />
            <SessionReceiptSection
              icon={<MessageSquare className="size-3" />}
              label={t(
                'auto.components.right.sidebar.AiVaultSessionDetails.latestTurns',
                'Latest turns'
              )}
            >
              {detailTurns.length > 0 ? (
                <div className="space-y-1.5">
                  {detailTurns.map((turn) => (
                    <ConversationTurnCard
                      key={`${turn.role}:${turn.timestamp ?? ''}:${turn.text}`}
                      role={turn.role}
                      text={turn.text}
                    />
                  ))}
                </div>
              ) : (
                <SessionDetailEmptyState
                  message={t(
                    'auto.components.right.sidebar.AiVaultSessionDetails.noPreviewAvailable',
                    'No conversation preview available'
                  )}
                />
              )}
            </SessionReceiptSection>
          </>
        ) : (
          // Replace unsaved previews with one notice instead of a second empty state.
          <SessionUnsavedConversationNotice session={session} logAvailable={Boolean(onOpenLog)} />
        )}

        <SessionSubagentsSection session={session} resume={subagentResume} />

        {shouldShowAiVaultSessionWorktreeLine(worktreeInfo, { vaultScope }) ? (
          <SessionReceiptSection
            icon={
              isAiVaultFolderWorkspaceId(worktreeInfo.worktreeId) ? (
                <Folder className="size-3" />
              ) : (
                <FolderGit2 className="size-3" />
              )
            }
            label={aiVaultSessionWorkspaceHeading(worktreeInfo.worktreeId, t)}
          >
            <WorktreeMetadataLines worktreeInfo={worktreeInfo} vaultScope={vaultScope} />
          </SessionReceiptSection>
        ) : null}
        <SessionAccountSection accountLabel={accountLabel} />
      </div>
    </div>
  )
}

function WorktreeMetadataLines({
  worktreeInfo,
  vaultScope
}: {
  worktreeInfo: AiVaultSessionWorktreeInfo
  vaultScope: AiVaultScope
}): React.JSX.Element {
  const t = useTranslate()
  const compactPath = aiVaultWorktreeCompactPath(worktreeInfo.path)
  const pathLine =
    compactPath && compactPath !== worktreeInfo.label ? compactPath : worktreeInfo.path
  const showPathLine = Boolean(pathLine) && pathLine !== worktreeInfo.label

  return (
    <div className="grid min-w-0 gap-1 text-[11px] leading-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {shouldShowAiVaultWorktreeStatusBadge(worktreeInfo.status, {
          vaultScope
        }) ? (
          <>
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
              {aiVaultWorktreeStatusLabel(worktreeInfo.status, worktreeInfo.worktreeId, t)}
            </span>
            <span className="shrink-0 text-muted-foreground/45">·</span>
          </>
        ) : null}
        <span className="min-w-0 text-[12px] font-medium leading-4 text-foreground">
          {worktreeInfo.label}
        </span>
      </div>
      {showPathLine ? (
        <WorktreePathHint compactPath={pathLine} fullPath={worktreeInfo.path} />
      ) : null}
    </div>
  )
}

function WorktreePathHint({
  compactPath,
  fullPath
}: {
  compactPath: string
  fullPath: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="min-w-0 truncate font-mono text-[11px] leading-4 text-muted-foreground">
          {compactPath}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4} className="max-w-sm break-all font-mono text-xs">
        {fullPath}
      </TooltipContent>
    </Tooltip>
  )
}

function SessionDetailEmptyState({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="rounded-md border border-dashed border-sidebar-border/80 px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
      {message}
    </div>
  )
}
