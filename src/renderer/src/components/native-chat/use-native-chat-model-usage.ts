import { useEffect, useState } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { useAppStore } from '@/store'
import { watchProviderAccounts } from '@/runtime/runtime-provider-accounts-client'
import { resolveNativeChatModelDiscoveryContext } from './native-chat-session-option-discovery'

export function useNativeChatModelUsage(
  agent: AgentType | undefined,
  terminalTabId: string | undefined
): ProviderRateLimits | null {
  const local = useAppStore((state) =>
    agent === 'antigravity' ? (state.rateLimits?.antigravity ?? null) : null
  )
  // Resolve again when the owning workspace changes, including folder workspaces.
  useAppStore((state) => state.tabsByWorktree)
  const context =
    agent === 'antigravity' && terminalTabId
      ? resolveNativeChatModelDiscoveryContext(terminalTabId)
      : null
  const host = context?.hostKey ?? null
  const environmentId = host?.startsWith('runtime:') ? host.slice('runtime:'.length) : null
  const [remote, setRemote] = useState<{ owner: string; usage: ProviderRateLimits | null } | null>(
    null
  )
  useEffect(() => {
    if (!environmentId) {
      return
    }
    const watcher = watchProviderAccounts(
      { activeRuntimeEnvironmentId: environmentId },
      {
        onSnapshot: (snapshot) =>
          setRemote({ owner: environmentId, usage: snapshot.rateLimits?.antigravity ?? null }),
        onError: () => setRemote(null)
      }
    )
    return () => watcher.close()
  }, [environmentId])
  // SSH/WSL quotas are not published by this subscription; never substitute this machine's account.
  if (context?.runtime.connectionId || host?.startsWith('wsl:')) {
    return null
  }
  if (host === 'local') {
    return local
  }
  return environmentId && remote?.owner === environmentId ? remote.usage : null
}
