import { defineFixture } from '../../../../component-fixtures/component-fixture'
import type { GitHubAccessibleRepo } from '../../../../../../shared/github/repositories/accessible-repos'
import { GitHubRepoPickerView } from './GitHubRepoPickerView'

const ROWS: [owner: string, name: string, isPrivate: boolean][] = [
  ['octo-org', 'design-tokens', true],
  ['octo-org', 'render-farm', true],
  ['octocat', 'hello-world', false],
  ['octocat', 'dotfiles', false],
  ['octo-labs', 'voxel-engine', false]
]

const REPOS: GitHubAccessibleRepo[] = ROWS.map(([owner, name, isPrivate]) => ({
  owner,
  name,
  fullName: `${owner}/${name}`,
  private: isPrivate,
  defaultBranch: 'main',
  cloneUrl: `https://github.com/${owner}/${name}.git`,
  pushedAt: '2026-11-20T10:00:00Z'
}))

const noop = (): void => {}

export const open = defineFixture({
  width: 420,
  render: () => (
    <div className="min-h-[300px]">
      <GitHubRepoPickerView
        state={{ status: 'ready', repos: REPOS, truncated: true }}
        hostLabel="test"
        selectedUrl=""
        defaultOpen
        onPick={noop}
      />
    </div>
  )
})

export const picked = defineFixture({
  width: 420,
  render: () => (
    <GitHubRepoPickerView
      state={{ status: 'ready', repos: REPOS, truncated: false }}
      hostLabel="test"
      selectedUrl={REPOS[1].cloneUrl}
      onPick={noop}
    />
  )
})

export const loading = defineFixture({
  width: 420,
  render: () => (
    <GitHubRepoPickerView
      state={{ status: 'loading' }}
      hostLabel="test"
      selectedUrl=""
      onPick={noop}
    />
  )
})

export const signedOut = defineFixture({
  width: 420,
  render: () => (
    <GitHubRepoPickerView
      state={{ status: 'auth_required' }}
      hostLabel="test"
      selectedUrl=""
      onPick={noop}
    />
  )
})
