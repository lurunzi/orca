import { Loader2, RefreshCw } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../../../ui/button'
import { ButtonGroup } from '../../../ui/button-group'
import { UnavailableEntryLabel, UnavailableEntryReason } from '../../../unavailable-entry'
import { canOfferClaudeSignInLink, ClaudeSignInLinkMenu } from './claude-sign-in-link-menu'

/** Sign in again for a saved Claude account, struck out when sign-in cannot run on this computer. */
export function ClaudeSignInAgainControls({
  runtime,
  busy,
  reauthing,
  unavailableReason,
  onReauthenticate
}: {
  runtime: 'host' | 'wsl' | undefined
  busy: boolean
  reauthing: boolean
  unavailableReason: string | undefined
  onReauthenticate: (copyLink: boolean) => void
}): React.JSX.Element {
  const t = useTranslate()
  const unavailable = unavailableReason !== undefined
  return (
    <>
      {unavailable ? <UnavailableEntryReason>{unavailableReason}</UnavailableEntryReason> : null}
      <ButtonGroup>
        <Button
          variant="ghost"
          size="xs"
          onClick={(event) => {
            event.stopPropagation()
            onReauthenticate(false)
          }}
          disabled={unavailable || busy}
          aria-disabled={unavailable || undefined}
          className="h-6 px-2 text-muted-foreground hover:text-foreground"
        >
          {reauthing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          <UnavailableEntryLabel unavailable={unavailable}>
            {t('accounts.claude.signInAgain', 'Sign in again')}
          </UnavailableEntryLabel>
        </Button>
        {canOfferClaudeSignInLink(runtime) ? (
          <ClaudeSignInLinkMenu
            variant="ghost"
            disabled={unavailable || busy}
            unavailableReason={unavailableReason}
            onCopyLink={() => onReauthenticate(true)}
          />
        ) : null}
      </ButtonGroup>
    </>
  )
}
