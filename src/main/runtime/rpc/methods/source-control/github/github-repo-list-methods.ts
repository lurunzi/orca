import { defineMethod } from '../../../core'
import { GithubListReposParams } from '../../../../../../shared/rpc-contract/github/github-repo-list-params'
import { listAccessibleGitHubRepos } from '../../../../../github/repositories/github-accessible-repo-listing'

export const GITHUB_REPO_LIST_METHODS = [
  defineMethod({
    name: 'github.listRepos',
    permission: 'workspace',
    params: GithubListReposParams,
    handler: async (params) => listAccessibleGitHubRepos(params)
  })
]
