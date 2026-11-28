import React from 'react'
import {
  PullPolicyRemoteActionNotice,
  isPullPolicyRemoteActionError
} from './pull-policy-error-notice'
import { SourceControlRecoveryNotice } from './recovery-notice'
import type { CommitNoticesProps } from './commit-area-types'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { useAppStore } from '@/store/index'
import { tryResolveGitOperationTarget } from '@/store/slices/editor/git/git-operation-target'
import { GitHubHostSignInButton } from '../../../integrations/source-control/github-host-sign-in-button'
import type { RuntimeClientTarget } from '../../../../../../shared/remote-runtime/host-catalog/runtime-client-target'

/** The host whose gh runs this workspace's git; none for direct SSH, where Orca runs no gh login. */
function useWorkspaceGitHostTarget(
  worktreeId: string | null,
  connectionId: string | null | undefined
): RuntimeClientTarget | null {
  const key = useAppStore((s) => {
    const target = worktreeId ? tryResolveGitOperationTarget(s, worktreeId) : null
    if (!target) {
      return null
    }
    return target.kind === 'environment' ? `env:${target.environmentId}` : 'local'
  })
  return React.useMemo(() => {
    if (!key || (key === 'local' && connectionId)) {
      return null
    }
    return key === 'local'
      ? { kind: 'local' }
      : { kind: 'environment', environmentId: key.slice(4) }
  }, [key, connectionId])
}

export function CommitNotices({
  worktreeId,
  groupId,
  connectionId,
  repoId,
  launchPlatform,
  commitError,
  commitFailureSummary,
  commitFailureKindLabel,
  hasCommitFailureDetails,
  commitFailureRecoveryPrompt,
  pushRecovery,
  remoteActionError,
  remoteActionNeedsGitHubSignIn,
  createPrIntentNotice,
  generateError,
  sourceControlAiActionsVisible,
  isFixingCommitFailureWithAI,
  isFixingPushFailureWithAI,
  fixCommitFailureRecipe,
  fixPushFailureRecipe,
  onSaveLaunchActionDefault,
  onOpenSourceControlAiSettings,
  onFixCommitFailureWithAI,
  onFixPushFailureWithAI
}: CommitNoticesProps): React.JSX.Element {
  const t = useTranslate()
  const gitHostTarget = useWorkspaceGitHostTarget(worktreeId, connectionId)
  return (
    <>
      {commitError && commitFailureSummary ? (
        <SourceControlRecoveryNotice
          id="commit-area-error"
          recoveryKind="commit"
          title={t('auto.components.right.sidebar.SourceControl.011f9713fc', 'Commit blocked')}
          detailsTitle={t(
            'auto.components.right.sidebar.SourceControl.a9bf7c171a',
            'Commit Failed'
          )}
          summary={commitFailureSummary}
          detailText={commitError}
          hasDetails={hasCommitFailureDetails}
          kindLabel={commitFailureKindLabel}
          prompt={commitFailureRecoveryPrompt}
          worktreeId={worktreeId}
          groupId={groupId}
          connectionId={connectionId}
          repoId={repoId}
          launchPlatform={launchPlatform}
          sourceControlAiActionsVisible={sourceControlAiActionsVisible}
          isLaunching={isFixingCommitFailureWithAI}
          recipe={fixCommitFailureRecipe}
          onSaveLaunchActionDefault={onSaveLaunchActionDefault}
          onOpenSourceControlAiSettings={onOpenSourceControlAiSettings}
          onFixWithAI={onFixCommitFailureWithAI}
        />
      ) : null}
      {pushRecovery ? (
        <SourceControlRecoveryNotice
          id="commit-area-push-error"
          recoveryKind="push"
          title={t(
            'auto.components.right.sidebar.SourceControl.pushRecovery.011f9713fc',
            'Push blocked'
          )}
          detailsTitle={t(
            'auto.components.right.sidebar.SourceControl.pushRecovery.a9bf7c171a',
            'Push Failed'
          )}
          summary={pushRecovery.summary}
          detailText={pushRecovery.detailText}
          hasDetails={pushRecovery.hasDetails}
          kindLabel={pushRecovery.kindLabel}
          prompt={pushRecovery.prompt}
          worktreeId={worktreeId}
          groupId={groupId}
          connectionId={connectionId}
          repoId={repoId}
          launchPlatform={launchPlatform}
          sourceControlAiActionsVisible={sourceControlAiActionsVisible}
          isLaunching={isFixingPushFailureWithAI}
          recipe={fixPushFailureRecipe}
          onSaveLaunchActionDefault={onSaveLaunchActionDefault}
          onOpenSourceControlAiSettings={onOpenSourceControlAiSettings}
          onFixWithAI={onFixPushFailureWithAI}
        />
      ) : null}
      {remoteActionError && isPullPolicyRemoteActionError(remoteActionError) ? (
        <PullPolicyRemoteActionNotice id="commit-area-remote-error" />
      ) : remoteActionError ? (
        <div className="mt-1 flex min-w-0 flex-col items-start gap-1 text-[11px]">
          <p
            id="commit-area-remote-error"
            role="alert"
            aria-live="polite"
            className="text-destructive"
          >
            {remoteActionError}
          </p>
          {remoteActionNeedsGitHubSignIn ? (
            <GitHubHostSignInButton target={gitHostTarget} variant="link" />
          ) : null}
        </div>
      ) : null}
      {createPrIntentNotice && (
        <div
          id="commit-area-create-pr-intent"
          role={createPrIntentNotice.tone === 'destructive' ? 'alert' : 'status'}
          aria-live="polite"
          className={cn(
            'mt-1 flex min-w-0 flex-col items-start gap-1 text-[11px]',
            createPrIntentNotice.tone === 'destructive'
              ? 'text-destructive'
              : 'text-muted-foreground'
          )}
        >
          {/* Wrap recovery guidance because truncation can hide the required action in narrow sidebars. */}
          <span className="min-w-0 self-stretch break-words leading-4 [overflow-wrap:anywhere]">
            {createPrIntentNotice.message}
          </span>
          {createPrIntentNotice.action === 'githubHostSignIn' ? (
            <GitHubHostSignInButton target={gitHostTarget} variant="link" />
          ) : null}
          {createPrIntentNotice.action === 'settings' && onOpenSourceControlAiSettings ? (
            <button
              type="button"
              className="text-left font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
              onClick={() => onOpenSourceControlAiSettings()}
            >
              {t(
                'auto.components.right.sidebar.SourceControl.473f18758e',
                'Source Control AI settings'
              )}
            </button>
          ) : null}
        </div>
      )}
      {generateError && (
        <p
          id="commit-area-generate-error"
          role="alert"
          aria-live="polite"
          className="mt-1 text-[11px] text-destructive"
        >
          {generateError}
        </p>
      )}
    </>
  )
}
