import { Check, Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { DialogError } from '@/components/ui/dialog-parts'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'
import { useClipboardTextCopyFeedback } from '@/hooks/clipboard/use-clipboard-text-copy-feedback'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import {
  cancelGitHubHostSignIn,
  closeGitHubHostSignIn,
  restartGitHubHostSignIn,
  useGitHubHostSignInDialog,
  type GitHubHostSignInView
} from '@/runtime/source-control/github/github-host-sign-in'
import {
  GITHUB_DEVICE_LOGIN_URL,
  type GitHubHostAuthFailureCode
} from '../../../../../shared/github/accounts/github-host-auth'

function failureCopy(code: GitHubHostAuthFailureCode, t: Translate): string {
  switch (code) {
    case 'notInstalled':
      return t(
        'sourceControl.githubHostSignIn.failure.notInstalled',
        'The GitHub CLI (gh) is not installed on this host.'
      )
    case 'noCode':
      return t(
        'sourceControl.githubHostSignIn.failure.noCode',
        'The GitHub CLI did not show a sign-in code. Update gh on this host and try again.'
      )
    case 'promptTimeout':
      return t(
        'sourceControl.githubHostSignIn.failure.promptTimeout',
        'The GitHub CLI did not show a sign-in code within 30 seconds. Try again.'
      )
    case 'expired':
      return t(
        'sourceControl.githubHostSignIn.failure.expired',
        'The sign-in code expired before it was approved. Start again.'
      )
    case 'denied':
      return t(
        'sourceControl.githubHostSignIn.failure.denied',
        'The sign-in was not approved on GitHub.'
      )
    case 'envToken':
      return t(
        'sourceControl.githubHostSignIn.failure.envToken',
        'This host signs gh in with GH_TOKEN or GITHUB_TOKEN. Change that variable on the host instead.'
      )
    case 'ownerSilent':
      return t(
        'sourceControl.githubHostSignIn.failure.ownerSilent',
        'The device that started this sign-in stopped answering.'
      )
  }
}

function CopyCodeButton({ code }: { code: string }): React.JSX.Element {
  const t = useTranslate()
  const { copyText, status } = useClipboardTextCopyFeedback(code)
  return (
    <Button variant="outline" size="sm" onClick={() => void copyText()}>
      {status === 'copied' ? <Check /> : <Copy />}
      {status === 'copied'
        ? t('sourceControl.githubHostSignIn.copied', 'Copied')
        : status === 'failed'
          ? t('sourceControl.githubHostSignIn.copyFailed', 'Could not copy')
          : t('sourceControl.githubHostSignIn.copyCode', 'Copy code')}
    </Button>
  )
}

export type GitHubHostSignInDialogViewProps = {
  open: boolean
  view: GitHubHostSignInView
  onOpenPage: (event: React.MouseEvent) => void
  onCancel: () => void
  onClose: () => void
  onRestart: (replace: boolean) => void
}

/** The host's one-time code and its state; the token is written by gh on the host only. */
export function GitHubHostSignInDialogView({
  open,
  view,
  onOpenPage,
  onCancel,
  onClose,
  onRestart
}: GitHubHostSignInDialogViewProps): React.JSX.Element {
  const t = useTranslate()
  const running = view.phase === 'starting' || view.phase === 'waiting'
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent size="confirm" phoneSheet>
        <DialogHeader>
          <DialogTitle>
            {t('sourceControl.githubHostSignIn.title', 'Sign in to GitHub on this host')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'sourceControl.githubHostSignIn.description',
              'The GitHub CLI on this host signs in. Enter the code on GitHub to approve it; the token stays on the host.'
            )}
          </DialogDescription>
        </DialogHeader>
        {view.phase === 'starting' ? (
          <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <LoadingSpinner className="size-3.5" />
            {t('sourceControl.githubHostSignIn.starting', 'Starting gh on this host…')}
          </p>
        ) : null}
        {view.phase === 'waiting' ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {t('sourceControl.githubHostSignIn.codeLabel', 'One-time code')}
              </span>
              <div className="flex items-center gap-2">
                <span
                  className="rounded-md border border-border bg-muted px-3 py-1.5 font-mono text-lg tracking-widest text-foreground select-all"
                  aria-live="polite"
                >
                  {view.prompt.userCode}
                </span>
                <CopyCodeButton code={view.prompt.userCode} />
              </div>
            </div>
            <Button variant="default" size="sm" className="self-start" onClick={onOpenPage}>
              <ExternalLink />
              {t('sourceControl.githubHostSignIn.openPage', 'Open github.com/login/device')}
            </Button>
            <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <LoadingSpinner className="size-3.5" />
              {t('sourceControl.githubHostSignIn.waiting', 'Waiting for approval on GitHub…')}
            </p>
          </div>
        ) : null}
        {view.phase === 'signedIn' ? (
          <p role="status" className="flex items-center gap-2 text-[13px] text-foreground">
            <Check className="size-4 text-status-success" />
            {view.login
              ? t(
                  'sourceControl.githubHostSignIn.signedIn',
                  'Signed in as {{login}}. Try the action again.',
                  {
                    login: view.login
                  }
                )
              : t(
                  'sourceControl.githubHostSignIn.signedInNoLogin',
                  'Signed in. Try the action again.'
                )}
          </p>
        ) : null}
        {view.phase === 'cancelled' ? (
          <p role="status" className="text-[13px] text-muted-foreground">
            {t('sourceControl.githubHostSignIn.cancelled', 'Sign-in cancelled.')}
          </p>
        ) : null}
        {view.phase === 'updateRequired' ? (
          <DialogError>
            {t(
              'sourceControl.githubHostSignIn.updateRequired',
              'Signing in from here requires a newer Orca server. Update the server and try again.'
            )}
          </DialogError>
        ) : null}
        {view.phase === 'failed' ? (
          view.busy ? (
            <DialogError
              onRetry={() => onRestart(true)}
              retryLabel={t('sourceControl.githubHostSignIn.replace', 'Replace it')}
            >
              {t(
                'sourceControl.githubHostSignIn.busy',
                'Another device is already signing this host in.'
              )}
            </DialogError>
          ) : (
            <DialogError
              onRetry={() => onRestart(false)}
              retryLabel={t('sourceControl.githubHostSignIn.retry', 'Start again')}
            >
              {view.errorCode ? failureCopy(view.errorCode, t) : view.error}
            </DialogError>
          )
        ) : null}
        <DialogFooter>
          {running ? (
            <Button variant="outline" size="sm" onClick={onCancel}>
              {t('sourceControl.githubHostSignIn.cancel', 'Cancel')}
            </Button>
          ) : (
            <Button
              variant={view.phase === 'signedIn' ? 'default' : 'outline'}
              size="sm"
              onClick={onClose}
            >
              {view.phase === 'signedIn'
                ? t('sourceControl.githubHostSignIn.done', 'Done')
                : t('sourceControl.githubHostSignIn.close', 'Close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Mounted once; any surface opens it with openGitHubHostSignIn(target). */
export function GitHubHostSignInDialog(): React.JSX.Element | null {
  const dialog = useGitHubHostSignInDialog()
  if (!dialog) {
    return null
  }
  return (
    <GitHubHostSignInDialogView
      open
      view={dialog.view}
      onOpenPage={(event) => openAppHttpLink(GITHUB_DEVICE_LOGIN_URL, { event })}
      onCancel={cancelGitHubHostSignIn}
      onClose={closeGitHubHostSignIn}
      onRestart={restartGitHubHostSignIn}
    />
  )
}
