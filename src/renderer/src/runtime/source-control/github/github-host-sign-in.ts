// Signs a host's own gh in from this client (`github.hostAuth.*`): the host runs
// `gh auth login --web`, this window shows its one-time code, and the person approves on GitHub.
import { useSyncExternalStore } from 'react'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { RuntimeRpcCallError } from '@/runtime/rpc/calls/runtime-rpc-result'
import type { RuntimeClientTarget } from '../../../../../shared/remote-runtime/host-catalog/runtime-client-target'
import type {
  GitHubHostAuthFailureCode,
  GitHubHostAuthPrompt,
  GitHubHostAuthStatus
} from '../../../../../shared/github/accounts/github-host-auth'

export type GitHubHostSignInView =
  | { phase: 'starting' }
  | { phase: 'waiting'; prompt: GitHubHostAuthPrompt }
  | { phase: 'signedIn'; login: string | null }
  | { phase: 'cancelled' }
  | { phase: 'updateRequired' }
  /** `busy`: another client's sign-in holds the host; starting again with replace ends it. */
  | { phase: 'failed'; error: string; errorCode?: GitHubHostAuthFailureCode; busy?: boolean }

type DialogState = {
  target: RuntimeClientTarget
  view: GitHubHostSignInView
  onSignedIn?: () => void
} | null

// The wait answers when the flow changes; past this a paired call ends and the wait asks again.
const WAIT_TIMEOUT_MS = 60_000
const RETRY_MS = 2_000
const BUSY_PREFIX = 'Another GitHub sign-in is already running on this host'

let state: DialogState = null
let flowId: string | null = null
const listeners = new Set<() => void>()

function emit(next: DialogState): void {
  state = next
  listeners.forEach((listener) => listener())
}

function setView(view: GitHubHostSignInView): void {
  if (state) {
    emit({ ...state, view })
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useGitHubHostSignInDialog(): DialogState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state
  )
}

/** Opens the dialog for `target` and starts its host's sign-in; `onSignedIn` refreshes what failed. */
export function openGitHubHostSignIn(
  target: RuntimeClientTarget,
  options: { onSignedIn?: () => void } = {}
): void {
  if (state && flowId) {
    cancelGitHubHostSignIn()
  }
  emit({ target, view: { phase: 'starting' }, onSignedIn: options.onSignedIn })
  void start(false)
}

/** Starts again; `replace` ends a sign-in another client left running on that host. */
export function restartGitHubHostSignIn(replace = false): void {
  if (!state) {
    return
  }
  setView({ phase: 'starting' })
  void start(replace)
}

export function cancelGitHubHostSignIn(): void {
  const target = state?.target
  const running = flowId
  flowId = null
  setView({ phase: 'cancelled' })
  if (target && running) {
    void callRuntimeRpc(target, 'github.hostAuth.cancel', { flowId: running }).catch(
      () => undefined
    )
  }
}

export function closeGitHubHostSignIn(): void {
  if (flowId) {
    cancelGitHubHostSignIn()
  }
  emit(null)
}

async function start(replace: boolean): Promise<void> {
  const target = state?.target
  if (!target) {
    return
  }
  let flow: GitHubHostAuthStatus
  try {
    flow = await callRuntimeRpc<GitHubHostAuthStatus>(
      target,
      'github.hostAuth.start',
      replace ? { replace } : {}
    )
  } catch (error) {
    if (state?.target !== target) {
      return
    }
    if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
      setView({ phase: 'updateRequired' })
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    setView({ phase: 'failed', error: message, busy: message.startsWith(BUSY_PREFIX) })
    return
  }
  if (state?.target !== target) {
    void callRuntimeRpc(target, 'github.hostAuth.cancel', { flowId: flow.flowId }).catch(
      () => undefined
    )
    return
  }
  flowId = flow.flowId
  await follow(target, flow)
}

async function follow(target: RuntimeClientTarget, from: GitHubHostAuthStatus): Promise<void> {
  let flow = from
  while (flowId === flow.flowId && state?.target === target) {
    if (flow.phase === 'signedIn') {
      flowId = null
      setView({ phase: 'signedIn', login: flow.login ?? null })
      state?.onSignedIn?.()
      return
    }
    if (flow.phase === 'failed' || flow.phase === 'cancelled') {
      flowId = null
      setView(
        flow.phase === 'cancelled'
          ? { phase: 'cancelled' }
          : {
              phase: 'failed',
              error: flow.error ?? 'GitHub sign-in failed.',
              errorCode: flow.errorCode
            }
      )
      return
    }
    if (flow.phase === 'waiting' && flow.prompt) {
      setView({ phase: 'waiting', prompt: flow.prompt })
    }
    let next: GitHubHostAuthStatus | null = null
    try {
      next = await callRuntimeRpc<GitHubHostAuthStatus>(
        target,
        'github.hostAuth.wait',
        { flowId: flow.flowId, afterRevision: flow.revision },
        { timeoutMs: WAIT_TIMEOUT_MS }
      )
    } catch (error) {
      // The host answered and refused (it restarted, or the flow is gone); a lost reply asks again.
      if (error instanceof RuntimeRpcCallError && flowId === flow.flowId) {
        flowId = null
        setView({ phase: 'failed', error: error.message })
        return
      }
    }
    if (next) {
      flow = next
    } else {
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
    }
  }
}
