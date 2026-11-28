import React, { useEffect, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { useRuntimeHostStatusSelector } from '@/store/slices/runtime-status/views/use-runtime-status-view'
import { useTranslate } from '@/i18n/use-translate'
import { extractIpcErrorMessage } from '@/runtime/errors/ipc-error'
import { lastVerifiedRuntimeStatus } from '../../../../../../shared/remote-runtime/host-status/runtime-host-status'
import { hasRuntimeRpcErrorCode } from '../../../../../../shared/remote-runtime/rpc/runtime-rpc-error-code'
import { GITHUB_LIST_REPOS_RUNTIME_CAPABILITY } from '../../../../../../shared/source-control/runtime/source-control-runtime-capabilities'
import type {
  GitHubAccessibleRepo,
  GitHubListReposResult
} from '../../../../../../shared/github/repositories/accessible-repos'
import { GitHubRepoPickerView, type GitHubRepoPickerState } from './GitHubRepoPickerView'

/** Null hides the picker: an older host that cannot list repositories. */
function useGitHubRepoList(environmentId: string | null): GitHubRepoPickerState | null {
  const advertised = useRuntimeHostStatusSelector(
    environmentId,
    (entry) =>
      lastVerifiedRuntimeStatus(entry)?.capabilities?.includes(
        GITHUB_LIST_REPOS_RUNTIME_CAPABILITY
      ) === true
  )
  // This app's own runtime always has the method.
  const supported = environmentId ? advertised : true
  const [state, setState] = useState<GitHubRepoPickerState | null>(null)

  useEffect(() => {
    if (!supported) {
      setState(null)
      return
    }
    let current = true
    setState({ status: 'loading' })
    const target = environmentId
      ? ({ kind: 'environment', environmentId } as const)
      : ({ kind: 'local' } as const)
    callRuntimeRpc<GitHubListReposResult>(target, 'github.listRepos', {}, { timeoutMs: 60_000 })
      .then((result) => {
        if (!current) {
          return
        }
        if (result.ok) {
          setState({ status: 'ready', repos: result.repos, truncated: result.truncated })
        } else if (result.error.type === 'auth_required') {
          setState({ status: 'auth_required' })
        } else {
          setState({ status: 'error', message: result.error.message })
        }
      })
      .catch((error: unknown) => {
        if (!current) {
          return
        }
        setState(
          hasRuntimeRpcErrorCode(error, 'method_not_found')
            ? null
            : { status: 'error', message: extractIpcErrorMessage(error, String(error)) }
        )
      })
    return () => {
      current = false
    }
  }, [environmentId, supported])

  return state
}

export function GitHubRepoPicker({
  runtimeEnvironmentId,
  hostLabel,
  selectedUrl,
  disabled,
  onPick
}: {
  runtimeEnvironmentId: string | null
  hostLabel: string | null
  selectedUrl: string
  disabled?: boolean
  onPick: (repo: GitHubAccessibleRepo) => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const state = useGitHubRepoList(runtimeEnvironmentId)
  if (!state) {
    return null
  }
  return (
    <GitHubRepoPickerView
      state={state}
      hostLabel={hostLabel ?? t('bots.github.ghSignedOut.thisComputer', 'this computer')}
      selectedUrl={selectedUrl}
      disabled={disabled}
      onPick={onPick}
    />
  )
}
