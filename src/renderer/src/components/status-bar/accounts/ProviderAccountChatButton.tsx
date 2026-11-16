import type { ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { UnavailableEntryLabel, UnavailableEntryReason } from '@/components/unavailable-entry'
import { useAppStore } from '@/store/index'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'

export type ChatAccountAction = { target: RuntimeClientTarget; canSwitch: () => Promise<boolean> }

export function ProviderAccountChatButton({
  provider,
  add = false,
  disabled,
  target,
  signInUnavailable = false,
  ...buttonProps
}: ComponentProps<typeof Button> & {
  provider: 'claude' | 'codex'
  target: RuntimeClientTarget
  add?: boolean
  disabled: boolean
  /** The chat's host cannot run this computer's sign-in. */
  signInUnavailable?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const button = (
    <Button
      {...buttonProps}
      type="button"
      variant="outline"
      size="xs"
      className="w-full"
      disabled={disabled || signInUnavailable}
      aria-disabled={signInUnavailable ? true : buttonProps['aria-disabled']}
      onClick={
        add
          ? () => {
              openSettingsTarget({
                pane: 'accounts',
                repoId: null,
                sectionId: `accounts-${provider}`,
                hostScope: target,
                intent: 'native-accounts'
              })
              openSettingsPage()
            }
          : buttonProps.onClick
      }
    >
      <UnavailableEntryLabel unavailable={signInUnavailable}>
        {add
          ? t('components.native-chat.usageLimitActions.addAccount', 'Add Account…')
          : t('components.native-chat.usageLimitActions.switchAccount', 'Switch Account')}
      </UnavailableEntryLabel>
    </Button>
  )
  if (!signInUnavailable) {
    return button
  }
  return (
    <div className="flex w-full flex-col gap-1">
      {button}
      <UnavailableEntryReason>{signInRunsOnThisComputerLabel(t)}</UnavailableEntryReason>
    </div>
  )
}

export function signInRunsOnThisComputerLabel(t: Translate): string {
  return t('settings.remoteUnavailable.signInRunsOnThisComputer', 'Sign-in runs on this computer')
}

export function providerChatAccountControl(
  provider: 'claude' | 'codex',
  action: ChatAccountAction | undefined,
  loaded: boolean,
  signedInCount: number,
  busy: boolean
): { add: boolean; button: React.JSX.Element } | undefined {
  if (!action) {
    return undefined
  }
  const add = loaded && signedInCount <= 1
  return {
    add,
    button: (
      <ProviderAccountChatButton
        provider={provider}
        add={add}
        target={action.target}
        disabled={!loaded || busy}
        signInUnavailable={add && action.target.kind !== 'local'}
      />
    )
  }
}
