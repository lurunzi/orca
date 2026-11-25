import React, { useMemo } from 'react'
import { CodexResetCredits, CodexResetConfirmation } from './CodexResetCredits'
import { DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu'
import type { ProviderRateLimits } from '../../../../../shared/agent-usage/rate-limits/rate-limit-types'
import { useTranslate } from '@/i18n/use-translate'
import {
  AccountRuntimeToggle,
  CodexRestartStatusPrompt
} from '../composition/StatusBarAccountControls'
import { AccountUsageGauge } from './AccountUsageGauge'
import {
  InlineUsageSignInAction,
  InlineUsageSkeleton,
  isUnavailableInactiveUsage
} from '../usage/InlineProviderUsage'
import { ProviderDetailsMenu } from '../usage/ProviderDetailsMenu'
import { AccountSwitchSection } from './AccountSwitchList'
import { AccountSwitchRowItem } from './AccountSwitchRowItem'
import { useCodexSwitcherController } from './use-codex-switcher-controller'
import { providerChatAccountControl, type ChatAccountAction } from './ProviderAccountChatButton'
import { scopeCodexAuthFailure, signedInCodexAccountCount } from './status-bar-codex-accounts'
import {
  useAccountOwnerUsage,
  type OwnerUsageRateLimits
} from '../usage/use-owner-usage-rate-limits'
import { useAppStore } from '../../../store/index'
import { isCodexUsageSignInRequired } from '../../../../../shared/agent-accounts/codex/codex-auth-errors'
import { getCodexStatusRuntimeKey } from './status-bar-runtime-targets'
import type { AccountOwner } from '@/runtime/provider-accounts/ownership/wsl-host-account-owner'
import { getAccountOwnerKey } from './owner-account-rows'

type CodexSwitcherProps = {
  codex: ProviderRateLimits | null
  iconOnly?: boolean
  asSubmenu?: boolean
  triggerContent?: React.ReactNode
} & (
  | { ownerUsage: OwnerUsageRateLimits; chatAction?: never }
  /** Fork: switch the account one chat's next start uses; see `use-codex-switcher-controller.ts`. */
  | { chatAction: ChatAccountAction; ownerUsage?: never }
)

// Fork: a chat's switcher before its host has read Codex usage.
const PENDING_CODEX: ProviderRateLimits = {
  provider: 'codex',
  session: null,
  weekly: null,
  updatedAt: 0,
  error: null,
  status: 'idle'
}

export function CodexSwitcherMenu(props: CodexSwitcherProps): React.JSX.Element | null {
  const t = useTranslate()
  if (props.chatAction) {
    return <ChatCodexSwitcherMenu {...props} chatAction={props.chatAction} />
  }
  const owner = props.ownerUsage.owner
  if (!owner) {
    return (
      <ProviderDetailsMenu
        provider={props.codex}
        iconOnly={props.iconOnly}
        asSubmenu={props.asSubmenu}
        triggerContent={props.triggerContent}
        ariaLabel={t(
          'auto.components.status.bar.StatusBar.ba55303942',
          'Open Codex details and account switcher'
        )}
      />
    )
  }
  return (
    <CodexSwitcherForOwner
      {...props}
      codex={props.codex ?? PENDING_CODEX}
      ownerUsage={props.ownerUsage}
      owner={owner}
      key={getAccountOwnerKey(owner)}
    />
  )
}

/** Fork: a chat's rows belong to the chat's host, read through the same owner observation as the bar. */
function ChatCodexSwitcherMenu(
  props: CodexSwitcherProps & { chatAction: ChatAccountAction }
): React.JSX.Element | null {
  const target = props.chatAction.target
  const owner = useMemo<AccountOwner>(() => ({ target, wslHostDistro: null }), [target])
  const ownerUsage = useAccountOwnerUsage(
    owner,
    useAppStore((s) => s.rateLimits)
  )
  return (
    <CodexSwitcherForOwner
      {...props}
      codex={props.codex ?? ownerUsage.rateLimits.codex ?? PENDING_CODEX}
      ownerUsage={ownerUsage}
      owner={owner}
      key={getAccountOwnerKey(owner)}
    />
  )
}

function CodexSwitcherForOwner({
  codex,
  ownerUsage,
  iconOnly,
  asSubmenu = false,
  triggerContent,
  chatAction,
  owner
}: {
  codex: ProviderRateLimits
  ownerUsage: OwnerUsageRateLimits
  iconOnly?: boolean
  asSubmenu?: boolean
  triggerContent?: React.ReactNode
  chatAction?: ChatAccountAction
  owner: AccountOwner
}): React.JSX.Element | null {
  const t = useTranslate()
  const {
    accountsLoaded,
    activeTarget,
    canRedeemReset,
    confirmedResetAccountId,
    handleConfirmReset,
    handleOpenChange,
    handleResetMenuSelect,
    handleSelectAccount,
    handleSelectRuntime,
    handleSignInAccount,
    hasActiveRuntimeEnvironment,
    inactiveCodexAccounts,
    isRedeemingReset,
    isSwitching,
    open,
    openSettingsPage,
    openSettingsTarget,
    providerAccountHostLabel,
    reauthenticatingAccountId,
    resetConfirmOpen,
    roster,
    rosterKnown,
    resetCreditCount,
    resetCreditExpiry,
    selectedGroup,
    selectedRuntimeKey,
    setResetConfirmOpen,
    setSkipFutureResetConfirm,
    skipFutureResetConfirm,
    switchGroups
  } = useCodexSwitcherController(codex, ownerUsage, owner, chatAction)

  const isBusy = isSwitching || reauthenticatingAccountId !== null
  // Why: a chat's local list loads on its own; a remote roster rides the owner's stream.
  const rosterLoaded = ownerUsage.remoteOwner ? rosterKnown : accountsLoaded
  const accountControl = providerChatAccountControl(
    'codex',
    chatAction,
    rosterLoaded,
    signedInCodexAccountCount(roster),
    isBusy
  )
  if (accountControl?.add) {
    return accountControl.button
  }
  const signInRequired = codex.status === 'error' && isCodexUsageSignInRequired(codex)
  const authFailureAccount = codex.usageMetadata?.authFailureAccount
  const authFailureMatchesActive =
    authFailureAccount !== undefined &&
    activeTarget !== undefined &&
    authFailureAccount.accountId === activeTarget.id &&
    getCodexStatusRuntimeKey(authFailureAccount) ===
      getCodexStatusRuntimeKey(activeTarget.runtimeTarget)
  const displayedCodex = scopeCodexAuthFailure(
    codex,
    authFailureMatchesActive ? authFailureAccount.accountId : null
  )
  const activeSignInRequired = signInRequired && displayedCodex === codex
  const canSignInLocally = !hasActiveRuntimeEnvironment && authFailureMatchesActive
  const rows = (selectedGroup?.targets ?? []).map((target) => {
    const inactiveUsage = target.id
      ? inactiveCodexAccounts.find((a) => a.accountId === target.id)
      : null
    const limits = inactiveUsage?.rateLimits
    const inactiveSignedOut =
      !target.active &&
      target.id !== null &&
      (isUnavailableInactiveUsage(limits) ||
        (limits?.status === 'error' && isCodexUsageSignInRequired(limits)))
    // Why: sign-in spawns a local `codex login`, so a remote-owned account can't be re-authed from this desktop.
    const showSignInAction =
      !hasActiveRuntimeEnvironment &&
      target.id !== null &&
      (target.active ? activeSignInRequired && canSignInLocally : inactiveSignedOut)
    // Fork: a remote host's signed-out account shows its Sign in struck out instead of no action.
    const signInUnavailable = hasActiveRuntimeEnvironment && inactiveSignedOut
    return { target, inactiveUsage, showSignInAction, signInUnavailable }
  })
  // The active row stays in place; only inactive rows move under "Usage unavailable".
  const isUnavailableUsageRow = (row: (typeof rows)[number]): boolean =>
    (row.showSignInAction || row.signInUnavailable) && !row.target.active
  const unavailableUsageRows = rows.filter(isUnavailableUsageRow)
  const renderRow = ({
    target,
    inactiveUsage,
    showSignInAction,
    signInUnavailable
  }: (typeof rows)[number]): React.JSX.Element => (
    <AccountSwitchRowItem
      label={target.name}
      detail={target.detail}
      active={target.active}
      key={`${selectedGroup?.key}:${target.id ?? 'system'}`}
      onSelect={(event) => {
        // Why: keep the menu open so the follow-up "restart live Codex tabs" prompt stays in this interaction.
        event.preventDefault()
        if (!target.active) {
          void handleSelectAccount(target.id, target.runtimeTarget)
        }
      }}
      disabled={isBusy || target.active}
      action={
        showSignInAction || signInUnavailable ? (
          <InlineUsageSignInAction
            accountLabel={target.label}
            isSigningIn={reauthenticatingAccountId === target.id}
            disabled={isBusy}
            signInUnavailable={signInUnavailable}
            onSignIn={() => {
              if (target.id !== null) {
                void handleSignInAccount(target.id, target.runtimeTarget)
              }
            }}
          />
        ) : undefined
      }
    >
      {showSignInAction || signInUnavailable ? null : renderUsage(target.active, inactiveUsage)}
    </AccountSwitchRowItem>
  )
  function renderUsage(
    active: boolean,
    inactiveUsage: (typeof rows)[number]['inactiveUsage']
  ): React.ReactNode {
    if (active) {
      return (
        <AccountUsageGauge
          limits={displayedCodex}
          isFetching={displayedCodex.status === 'fetching'}
        />
      )
    }
    if (inactiveUsage?.isFetching && !inactiveUsage.rateLimits) {
      return <InlineUsageSkeleton />
    }
    return inactiveUsage?.rateLimits ? (
      <AccountUsageGauge limits={inactiveUsage.rateLimits} isFetching={inactiveUsage.isFetching} />
    ) : null
  }

  return (
    <ProviderDetailsMenu
      provider={displayedCodex}
      iconOnly={iconOnly}
      asSubmenu={asSubmenu}
      triggerContent={triggerContent}
      trigger={accountControl?.button}
      ariaLabel={t(
        'auto.components.status.bar.StatusBar.ba55303942',
        'Open Codex details and account switcher'
      )}
      variant="account"
      usageSignInHint={
        activeSignInRequired
          ? canSignInLocally
            ? t('accounts.codex.usageSignInMessage', 'Sign in to see usage.')
            : t('accounts.codex.usageSignInSettingsMessage', 'Open Settings → Accounts to sign in.')
          : undefined
      }
      accountLabel={
        rosterKnown
          ? (activeTarget?.label ??
            t('auto.components.status.bar.StatusBar.c676918adc', 'System default'))
          : undefined
      }
      panelFooter={
        !signInRequired && resetCreditCount !== null ? (
          <CodexResetCredits
            unsupportedRuntime={
              owner.wslHostDistro !== null || selectedGroup?.runtimeTarget.runtime === 'wsl'
                ? 'wsl'
                : undefined
            }
            resetCreditCount={resetCreditCount}
            resetCreditExpiry={resetCreditExpiry}
            canRedeemReset={canRedeemReset}
            isRedeemingReset={isRedeemingReset}
            onReset={handleResetMenuSelect}
            renderAction={(action) => (
              <DropdownMenuItem
                asChild
                disabled={isRedeemingReset}
                onSelect={(event) => {
                  event.preventDefault()
                }}
              >
                {action}
              </DropdownMenuItem>
            )}
          />
        ) : undefined
      }
      topContent={
        !hasActiveRuntimeEnvironment && owner.wslHostDistro === null && !chatAction ? (
          <AccountRuntimeToggle
            groups={switchGroups}
            value={selectedRuntimeKey}
            onChange={(group) => void handleSelectRuntime(group)}
            ariaLabel={t('auto.components.status.bar.StatusBar.38b5647724', 'Codex usage runtime')}
          />
        ) : undefined
      }
      open={open}
      onOpenChange={handleOpenChange}
    >
      <CodexResetConfirmation
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        skipFutureResetConfirm={skipFutureResetConfirm}
        onSkipChange={setSkipFutureResetConfirm}
        isRedeemingReset={isRedeemingReset}
        onConfirm={handleConfirmReset}
        {...(providerAccountHostLabel
          ? {
              accountLabel: selectedGroup?.targets.find(
                (target) => target.id === confirmedResetAccountId
              )?.label,
              hostLabel: providerAccountHostLabel
            }
          : {})}
      />
      {/* Why: restarting sessions onto a login that needs signing in again would break them. */}
      {open && !chatAction && !signInRequired && displayedCodex.status !== 'fetching' ? (
        <CodexRestartStatusPrompt />
      ) : null}
      {/* Why: until the host lists its accounts, the empty roster's only row would claim "System default". */}
      {rosterKnown ? (
        <AccountSwitchSection
          heading={t('auto.components.status.bar.AccountSwitchList.accounts', 'Accounts')}
          targets={selectedGroup?.targets ?? []}
          panelShowsActiveAccount={!(activeSignInRequired && canSignInLocally)}
          onOpenSettings={() => {
            openSettingsTarget({
              pane: 'accounts',
              repoId: null,
              sectionId: 'accounts-codex',
              hostScope: owner.target,
              ...(chatAction ? { intent: 'native-accounts' as const } : {})
            })
            openSettingsPage()
          }}
        >
          {rows.filter((row) => !isUnavailableUsageRow(row)).map(renderRow)}
          {unavailableUsageRows.length > 0 ? (
            <>
              <DropdownMenuLabel className="mt-1">
                {t('auto.components.status.bar.tooltip.f8b8dbed85', 'Usage unavailable')}
              </DropdownMenuLabel>
              {unavailableUsageRows.map(renderRow)}
            </>
          ) : null}
        </AccountSwitchSection>
      ) : null}
    </ProviderDetailsMenu>
  )
}
