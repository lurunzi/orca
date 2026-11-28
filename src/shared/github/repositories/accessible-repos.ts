/** A repository the host's gh login can access, as offered by the clone picker. */
export type GitHubAccessibleRepo = {
  name: string
  owner: string
  /** `owner/name`. */
  fullName: string
  private: boolean
  defaultBranch: string
  cloneUrl: string
  /** ISO timestamp of the last push, or null when GitHub has none. */
  pushedAt: string | null
}

export type GitHubListReposErrorType =
  | 'auth_required'
  | 'rate_limited'
  | 'network_error'
  | 'unknown'

export type GitHubListReposResult =
  | { ok: true; repos: GitHubAccessibleRepo[]; truncated: boolean }
  | { ok: false; error: { type: GitHubListReposErrorType; message: string } }

export const GITHUB_LIST_REPOS_DEFAULT_LIMIT = 300
export const GITHUB_LIST_REPOS_MAX_LIMIT = 1000
