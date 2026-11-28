import { acquire, release } from '../execution/github-operation-slots'
import { ghExecFileAsync } from '../../git/command-runner/hosted-cli/gh-exec-file'
import {
  extractExecError,
  isMissingCommandBinaryError
} from '../../git/command-runner/process-capture/exec-error'
import { noteRepositoryRateLimitSpend } from '../api/rate-limit'
import {
  GITHUB_LIST_REPOS_DEFAULT_LIMIT,
  GITHUB_LIST_REPOS_MAX_LIMIT,
  type GitHubAccessibleRepo,
  type GitHubListReposResult
} from '../../../shared/github/repositories/accessible-repos'

const PAGE_SIZE = 100

type RawRepo = {
  name?: unknown
  full_name?: unknown
  owner?: { login?: unknown } | null
  private?: unknown
  default_branch?: unknown
  clone_url?: unknown
  pushed_at?: unknown
}

export type ListAccessibleReposArgs = { query?: string; limit?: number; host?: string }

/** Repos the host's gh login can reach (own, collaborator, org member), newest push first, capped. */
export async function listAccessibleGitHubRepos(
  args: ListAccessibleReposArgs = {}
): Promise<GitHubListReposResult> {
  const limit = Math.min(
    Math.max(1, Math.floor(args.limit ?? GITHUB_LIST_REPOS_DEFAULT_LIMIT)),
    GITHUB_LIST_REPOS_MAX_LIMIT
  )
  const host = args.host?.trim() || undefined
  const repos: GitHubAccessibleRepo[] = []
  let truncated = false
  for (let page = 1; repos.length < limit; page++) {
    const result = await fetchPage(page, host)
    if (!result.ok) {
      return result
    }
    for (const raw of result.page) {
      const repo = toAccessibleRepo(raw)
      if (repo) {
        repos.push(repo)
      }
    }
    if (result.rawCount < PAGE_SIZE) {
      break
    }
    if (repos.length >= limit) {
      // A full last page means GitHub may hold more than the cap.
      truncated = true
    }
  }
  if (repos.length > limit) {
    repos.length = limit
    truncated = true
  }
  return { ok: true, repos: filterRepos(repos, args.query), truncated }
}

async function fetchPage(
  page: number,
  host: string | undefined
): Promise<
  { ok: true; page: RawRepo[]; rawCount: number } | Extract<GitHubListReposResult, { ok: false }>
> {
  const path = `user/repos?per_page=${PAGE_SIZE}&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`
  await acquire()
  noteRepositoryRateLimitSpend({ host }, 'core')
  try {
    const { stdout } = await ghExecFileAsync(['api', path], {
      encoding: 'utf-8',
      idempotent: true,
      ...(host ? { host } : {})
    })
    const parsed: unknown = JSON.parse(stdout)
    if (!Array.isArray(parsed)) {
      return { ok: false, error: { type: 'unknown', message: 'Unexpected GitHub response.' } }
    }
    const rows: RawRepo[] = parsed.filter(isRawRepo)
    return { ok: true, page: rows, rawCount: parsed.length }
  } catch (err) {
    if (err instanceof SyntaxError) {
      return { ok: false, error: { type: 'unknown', message: 'Unexpected GitHub response.' } }
    }
    return { ok: false, error: classifyListReposError(err) }
  } finally {
    release()
  }
}

export function classifyListReposError(
  err: unknown
): Extract<GitHubListReposResult, { ok: false }>['error'] {
  if (isMissingCommandBinaryError(err)) {
    return { type: 'unknown', message: 'GitHub CLI (gh) is not installed on this host.' }
  }
  const { stderr } = extractExecError(err)
  const s = stderr.toLowerCase()
  if (
    s.includes('gh auth login') ||
    s.includes('not logged in') ||
    s.includes('authentication required') ||
    s.includes('http 401') ||
    s.includes('bad credentials')
  ) {
    return {
      type: 'auth_required',
      message: 'GitHub CLI is not signed in on this host. Run `gh auth login`.'
    }
  }
  if (s.includes('rate limit')) {
    return { type: 'rate_limited', message: 'GitHub rate limit hit. Try again in a few minutes.' }
  }
  if (
    s.includes('timeout') ||
    s.includes('no such host') ||
    s.includes('could not resolve host') ||
    s.includes('dial tcp') ||
    s.includes('network')
  ) {
    return { type: 'network_error', message: 'Network error — check your connection.' }
  }
  // Bound unexpected diagnostics instead of exposing full request dumps.
  const firstLine =
    stderr
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ?? ''
  return {
    type: 'unknown',
    message: firstLine
      ? `Failed to list repositories: ${firstLine.slice(0, 200)}`
      : 'Failed to list repositories.'
  }
}

function isRawRepo(value: unknown): value is RawRepo {
  return typeof value === 'object' && value !== null
}

function toAccessibleRepo(raw: RawRepo): GitHubAccessibleRepo | null {
  if (!raw || typeof raw.name !== 'string' || typeof raw.clone_url !== 'string') {
    return null
  }
  const owner = typeof raw.owner?.login === 'string' ? raw.owner.login : ''
  return {
    name: raw.name,
    owner,
    fullName: typeof raw.full_name === 'string' ? raw.full_name : `${owner}/${raw.name}`,
    private: raw.private === true,
    defaultBranch: typeof raw.default_branch === 'string' ? raw.default_branch : '',
    cloneUrl: raw.clone_url,
    pushedAt: typeof raw.pushed_at === 'string' ? raw.pushed_at : null
  }
}

function filterRepos(
  repos: GitHubAccessibleRepo[],
  query: string | undefined
): GitHubAccessibleRepo[] {
  const terms = query?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? []
  if (terms.length === 0) {
    return repos
  }
  return repos.filter((repo) => {
    const haystack = repo.fullName.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
