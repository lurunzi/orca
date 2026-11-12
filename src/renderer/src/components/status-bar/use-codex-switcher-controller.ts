import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { CodexRateLimitAccountsState } from '../../../../shared/managed-account-types'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { useAppStore } from '../../store'
import { defaultScopeHost } from '@/runtime/hosts/selection/default-creation-host'
import { useActiveAccountOwner } from '@/runtime/provider-accounts/ownership/use-active-account-owner'
import { runtimeTargetEnvironmentId } from '@/runtime/rpc/targets/runtime-client-target'
import {
  fetchProviderAccountsSnapshot,
  selectCodexProviderAccount
} from '@/runtime/provider-accounts/observations/runtime-provider-accounts-client'
import { useTranslate } from '@/i18n/use-translate'
import {
  markLiveCodexSessionsForRestart,
  resolveCodexRestartPromptAccountLabel
} from '@/lib/agent-session/accounts/codex/codex-session-restart'
import {
  getWindowsTerminalCapabilityOwnerKey,
  useWindowsTerminalCapabilities
} from '@/runtime/hosts/capabilities/windows-terminal-capabilities'
import { getCodexAccountSyncKey } from './codex-switcher-projection'
import { useCodexResetCreditController } from './use-codex-reset-credit-controller'
import type { ChatAccountAction } from './ProviderAccountChatButton'
import {
  getCodexStatusRuntimeKey,
  getStatusBarPreferredWslDistro,
  shouldIncludeSettingsWslRuntime,
  toCodexStatusRuntimeTarget,
  type CodexStatusRuntimeTarget,
  type CodexStatusSwitchGroup
} from './status-bar-runtime-targets'
import {
  buildCodexStatusSwitchGroups,
  getCodexStatusActiveId,
  normalizeCodexStatusRuntimeTarget,
  resolveCodexStatusAccountState
} from './status-bar-codex-accounts'
import { signInCodexAccount } from './codex-sign-in-action'

const EMPTY_INACTIVE: [] = []

/** `chatAction` drives the switcher for one chat: its host's accounts only, and no tab restarts. */
export function useCodexSwitcherController(
  codex: ProviderRateLimits | null,
  chatAction?: ChatAccountAction
) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [accounts, setAccounts] = useState<CodexRateLimitAccountsState>({
    accounts: [],
    activeAccountId: null
  })
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [reauthenticatingAccountId, setReauthenticatingAccountId] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const menuOpenRef = useRef(open)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const fetchSettings = useAppStore((s) => s.fetchSettings)
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  const refreshCodexRateLimitsForTarget = useAppStore((s) => s.refreshCodexRateLimitsForTarget)
  const fetchInactiveCodexAccountUsage = useAppStore((s) => s.fetchInactiveCodexAccountUsage)
  // A remote chat's accounts are its server's; this desktop's usage would land on the wrong rows.
  const inactiveCodexAccounts = useAppStore((s) =>
    chatAction?.target.kind === 'environment' ? EMPTY_INACTIVE : s.rateLimits.inactiveCodexAccounts
  )
  const codexTarget = useAppStore((s) => s.rateLimits.codexTarget)
  const settings = useAppStore((s) => s.settings)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const owner = useActiveAccountOwner(defaultScopeHost(settings))
  const runtimeTarget = chatAction?.target ?? owner.target
  const wslHostDistro = chatAction ? null : owner.wslHostDistro
  const activeRuntimeEnvironmentId = runtimeTargetEnvironmentId(runtimeTarget)
  const hasActiveRuntimeEnvironment = activeRuntimeEnvironmentId !== null
  const providerAccountHostLabel = hasActiveRuntimeEnvironment
    ? (runtimeEnvironments.find((environment) => environment.id === activeRuntimeEnvironmentId)
        ?.name ?? t('auto.components.status.bar.StatusBar.remoteServerLabel', 'Remote server'))
    : undefined
  const windowsTerminalCapabilities = useWindowsTerminalCapabilities(
    navigator.userAgent.includes('Windows') || hasActiveRuntimeEnvironment,
    false,
    getWindowsTerminalCapabilityOwnerKey(activeRuntimeEnvironmentId),
    runtimeTarget
  )
  const codexAccountSyncKey = useAppStore((s) => getCodexAccountSyncKey(s.settings))
  const accountState = resolveCodexStatusAccountState(
    settings,
    accounts,
    activeRuntimeEnvironmentId
  )

  // Why: keyed on owner id, not settings identity, so routine settings mutations don't re-run the remote snapshot fetch.
  const loadAccounts = useCallback(async () => {
    const snapshot = await fetchProviderAccountsSnapshot(runtimeTarget)
    // Why: a failed Codex half is a substituted empty roster; keep prior state.
    if (snapshot.failedProviders?.includes('codex')) {
      console.error('Codex account list failed; keeping previous status bar state.')
      return
    }
    if (mountedRef.current) {
      setAccounts(snapshot.codex)
      setAccountsLoaded(true)
    }
  }, [runtimeTarget])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    menuOpenRef.current = open
  }, [open])

  useEffect(() => {
    // Load on demand at mount and resync account mutations without fetching again on submenu expansion.
    void loadAccounts().catch((error) => {
      console.error('Failed to load Codex accounts for status bar:', error)
    })
  }, [loadAccounts, codexAccountSyncKey])

  const handleSelectAccount = async (
    accountId: string | null,
    target: CodexStatusRuntimeTarget
  ): Promise<void> => {
    if (isSwitching || reauthenticatingAccountId !== null) {
      return
    }
    const previousActiveAccountId = getCodexStatusActiveId(accountState, target)
    setIsSwitching(true)
    try {
      if (chatAction && !(await chatAction.canSwitch())) {
        toast.error(
          t(
            'components.native-chat.usageLimitActions.accountUnavailable',
            'This chat cannot move to another account. Hand it off to another agent instead.'
          )
        )
        return
      }
      const next = await selectCodexProviderAccount(runtimeTarget, {
        accountId,
        runtime: target.runtime,
        wslDistro: target.wslDistro
      })
      recordFeatureInteraction('codex-account-switching')
      if (mountedRef.current) {
        setAccounts(next)
      }
      // Why: remote selections live on the server; local GlobalSettings are untouched, so refetching is pure churn.
      if (!hasActiveRuntimeEnvironment) {
        await fetchSettings()
      }
      const nextActiveAccountId = getCodexStatusActiveId(next, target)
      // The chat's next send starts under the new account; other tabs keep theirs until asked.
      if (!chatAction && previousActiveAccountId !== nextActiveAccountId) {
        await markLiveCodexSessionsForRestart({
          previousAccountLabel: resolveCodexRestartPromptAccountLabel(
            accountState.accounts,
            previousActiveAccountId
          ),
          nextAccountLabel: resolveCodexRestartPromptAccountLabel(
            next.accounts,
            nextActiveAccountId
          ),
          // Emails can coincide; IDs determine whether switching returns to the launch account.
          previousAccountId: previousActiveAccountId ?? null,
          nextAccountId: nextActiveAccountId ?? null,
          // Only this owner/runtime slot changed; other lanes keep their current launch accounts.
          owner: runtimeTarget,
          target,
          // Why: clearing a distro-less WSL row nulls every distro slot at once.
          clearsEveryWslDistro: accountId === null
        })
      }
    } catch (error) {
      console.error('Failed to switch Codex account from status bar:', error)
    } finally {
      if (mountedRef.current) {
        setIsSwitching(false)
      }
    }
  }

  const handleSignInAccount = (
    accountId: string,
    target: CodexStatusRuntimeTarget
  ): Promise<void> =>
    signInCodexAccount(accountId, target, {
      accountState,
      menuOpenRef,
      fetchInactiveCodexAccountUsage,
      fetchSettings,
      isSwitching,
      mountedRef,
      reauthenticatingAccountId,
      recordFeatureInteraction,
      setAccounts,
      setReauthenticatingAccountId
    })

  const handleSelectRuntime = async (group: CodexStatusSwitchGroup): Promise<void> => {
    const currentKey = getCodexStatusRuntimeKey(
      normalizeCodexStatusRuntimeTarget(accountState, toCodexStatusRuntimeTarget(codexTarget))
    )
    if (group.key === currentKey) {
      return
    }
    try {
      await refreshCodexRateLimitsForTarget(group.runtimeTarget)
    } catch (error) {
      console.error('Failed to switch Codex usage runtime:', error)
    }
  }

  const handleOpenChange = useCallback(
    (nextOpen: boolean): void => {
      setOpen(nextOpen)
      if (nextOpen && !hasActiveRuntimeEnvironment) {
        void fetchInactiveCodexAccountUsage()
      }
    },
    [fetchInactiveCodexAccountUsage, hasActiveRuntimeEnvironment]
  )

  const selectedRuntimeKey = getCodexStatusRuntimeKey(
    normalizeCodexStatusRuntimeTarget(accountState, toCodexStatusRuntimeTarget(codexTarget))
  )
  // A focused WSL host's accounts are this desktop's for its distro, so that group always shows.
  const fallbackWslDistro =
    wslHostDistro ??
    getStatusBarPreferredWslDistro(settings, windowsTerminalCapabilities.wslDistros)
  const switchGroups = buildCodexStatusSwitchGroups(
    accountState,
    toCodexStatusRuntimeTarget(codexTarget),
    {
      fallbackWslDistro,
      includeFallbackWsl:
        wslHostDistro !== null ||
        (!hasActiveRuntimeEnvironment && shouldIncludeSettingsWslRuntime(settings)),
      hostLabel: providerAccountHostLabel
    }
  )
  const selectedGroup = chatAction
    ? switchGroups.find((group) => group.runtimeTarget.runtime === 'host')
    : (switchGroups.find((group) => group.key === selectedRuntimeKey) ?? switchGroups[0])
  const activeTarget = selectedGroup?.targets.find((target) => target.active)
  const resetCredits = useCodexResetCreditController(codex, hasActiveRuntimeEnvironment, mountedRef)

  return {
    accounts,
    accountsLoaded,
    activeTarget,
    handleOpenChange,
    handleSelectAccount,
    handleSelectRuntime,
    handleSignInAccount,
    hasActiveRuntimeEnvironment,
    inactiveCodexAccounts,
    isSwitching,
    open,
    openSettingsPage,
    openSettingsTarget,
    reauthenticatingAccountId,
    ...resetCredits,
    selectedGroup,
    selectedRuntimeKey,
    switchGroups
  }
}
