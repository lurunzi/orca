import { LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { useRuntimeEnvironmentCapability } from '@/runtime/rpc/compatibility/use-runtime-environment-capability'
import { openGitHubHostSignIn } from '@/runtime/source-control/github/github-host-sign-in'
import { GITHUB_HOST_AUTH_RUNTIME_CAPABILITY } from '../../../../../shared/source-control/runtime/source-control-runtime-capabilities'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'

/** "Sign in on this host": signs the host's gh in through GitHub's device page; hidden on older hosts. */
export function GitHubHostSignInButton({
  target,
  onSignedIn,
  variant = 'outline'
}: {
  target: RuntimeClientTarget | null
  onSignedIn?: () => void
  variant?: 'outline' | 'link'
}): React.JSX.Element | null {
  const t = useTranslate()
  const environmentId = target?.kind === 'environment' ? target.environmentId : null
  const remoteSupported = useRuntimeEnvironmentCapability(
    environmentId,
    GITHUB_HOST_AUTH_RUNTIME_CAPABILITY
  )
  // This window's own runtime is this build, so it always has the methods.
  if (!target || (target.kind === 'environment' && !remoteSupported)) {
    return null
  }
  const label = t('sourceControl.githubHostSignIn.action', 'Sign in on this host')
  const open = (): void => openGitHubHostSignIn(target, { onSignedIn })
  return variant === 'link' ? (
    <button
      type="button"
      className="text-left font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
      onClick={open}
    >
      {label}
    </button>
  ) : (
    <Button variant="outline" size="sm" onClick={open}>
      <LogIn className="size-3.5 mr-1.5" />
      {label}
    </Button>
  )
}
