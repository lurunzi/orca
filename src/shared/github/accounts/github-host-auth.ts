import type { HostAccountSignInPhase } from '../../agent-accounts/host-account-sign-in-types'

/** The page the person opens on their own device; the client never opens a host-supplied link. */
export const GITHUB_DEVICE_LOGIN_URL = 'https://github.com/login/device'

/** The one-time code `gh auth login --web` prints and the page it names. */
export type GitHubHostAuthPrompt = {
  userCode: string
  verificationUri: string
}

/** One host `gh` sign-in as the host reports it to the client that started it. */
export type GitHubHostAuthStatus = {
  flowId: string
  provider: 'github'
  revision: number
  phase: HostAccountSignInPhase
  prompt?: GitHubHostAuthPrompt
  /** English text; `errorCode` names Orca's own failures so clients can localize them. */
  error?: string
  errorCode?: GitHubHostAuthFailureCode
  /** The account gh reports after sign-in, when it can tell. */
  login?: string | null
}

// One English table for failures Orca names itself; gh's own errors stay uncoded.
export const GITHUB_HOST_AUTH_FAILURE_COPY = {
  notInstalled: 'The GitHub CLI (gh) is not installed on this host.',
  noCode: 'The GitHub CLI did not show a sign-in code. Update gh on this host and try again.',
  promptTimeout: 'The GitHub CLI did not show a sign-in code within 30 seconds. Try again.',
  expired: 'The sign-in code expired before it was approved. Start again.',
  denied: 'The sign-in was not approved on GitHub.',
  envToken:
    'This host signs gh in with GH_TOKEN or GITHUB_TOKEN. Change that variable on the host instead.',
  ownerSilent: 'The device that started this sign-in stopped answering.'
} as const

export type GitHubHostAuthFailureCode = keyof typeof GITHUB_HOST_AUTH_FAILURE_COPY

export function isGitHubHostAuthFailureCode(value: unknown): value is GitHubHostAuthFailureCode {
  return typeof value === 'string' && Object.hasOwn(GITHUB_HOST_AUTH_FAILURE_COPY, value)
}

/** Whether `url` is GitHub's own https device page; the host's output is not trusted blindly. */
export function isGitHubDeviceLoginPage(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'github.com' &&
      parsed.pathname.replace(/\/+$/, '') === '/login/device'
    )
  } catch {
    return false
  }
}
