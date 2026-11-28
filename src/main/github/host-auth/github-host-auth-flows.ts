import {
  GITHUB_HOST_AUTH_FAILURE_COPY,
  isGitHubDeviceLoginPage,
  isGitHubHostAuthFailureCode,
  type GitHubHostAuthPrompt,
  type GitHubHostAuthStatus
} from '../../../shared/github/accounts/github-host-auth'
import { CallerOwnedSignInFlows } from '../../runtime/caller-owned-sign-in-flows'
import type {
  CallerOwnedSignInChannel,
  CallerOwnedSignInStatus
} from '../../runtime/caller-owned-sign-in-contract'

type GitHubHostAuthResult = { login: string | null }

export type GitHubHostAuthRunner = (
  channel: CallerOwnedSignInChannel<GitHubHostAuthPrompt, never>
) => Promise<GitHubHostAuthResult>

/** One `gh auth login` per host, owned by the client that started it (#48645). */
export class GitHubHostAuthFlows {
  private readonly flows: CallerOwnedSignInFlows<
    'github',
    GitHubHostAuthPrompt,
    never,
    GitHubHostAuthResult
  >

  constructor(run: GitHubHostAuthRunner) {
    this.flows = new CallerOwnedSignInFlows((_provider, channel) => run(channel), {
      acceptsPrompt: (_provider, prompt) => isGitHubDeviceLoginPage(prompt.verificationUri),
      acceptsCode: () => false,
      describeFailure,
      busyMessage:
        'Another GitHub sign-in is already running on this host. Finish or cancel it first.',
      // The person may take a while on GitHub's page; the client's long polls keep it alive.
      ownerSilenceMs: 120_000
    })
  }

  /** A repeat start by the same client resumes its sign-in; `replace` ends anyone else's first. */
  async start(owner: string, replace = false): Promise<GitHubHostAuthStatus> {
    const running = this.flows.activeFlow()
    if (replace && running && running.owner !== owner) {
      await this.flows.cancel(running.owner, running.flowId)
    }
    return toStatus(this.flows.start(owner, 'github'))
  }

  async wait(
    owner: string,
    flowId: string,
    afterRevision: number,
    signal?: AbortSignal
  ): Promise<GitHubHostAuthStatus> {
    return toStatus(await this.flows.wait(owner, flowId, afterRevision, signal))
  }

  async cancel(owner: string, flowId: string): Promise<GitHubHostAuthStatus> {
    return toStatus(await this.flows.cancel(owner, flowId))
  }
}

function toStatus(
  status: CallerOwnedSignInStatus<'github', GitHubHostAuthPrompt, GitHubHostAuthResult>
): GitHubHostAuthStatus {
  const { errorCode, ...rest } = status
  return isGitHubHostAuthFailureCode(errorCode) ? { ...rest, errorCode } : rest
}

function describeFailure(message: string): { error: string; errorCode?: string } {
  const code = Object.entries(GITHUB_HOST_AUTH_FAILURE_COPY).find(
    ([, copy]) => copy === message
  )?.[0]
  return code ? { error: message, errorCode: code } : { error: message }
}
