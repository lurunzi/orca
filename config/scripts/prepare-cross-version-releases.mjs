import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { selectLatestStableReleaseTag } from './release/versioning/stable-release-tags.mjs'

export function prepareCrossVersionReleases(
  repoRoot,
  source = 'https://github.com/stablyai/orca.git'
) {
  const git = (args) =>
    execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'inherit']
    }).trim()
  git(['fetch', '--no-tags', source, 'refs/tags/v*:refs/tags/v*'])
  // A backport upgrades its branch's releases, not newer upstream code it does not contain.
  const tags = git(['tag', '--merged', 'HEAD', '--list', 'v[0-9]*']).split('\n')
  const baseline = selectLatestStableReleaseTag(tags)
  if (!baseline) {
    throw new Error('No stable desktop release tag is reachable from this checkout')
  }
  return baseline
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const baseline = prepareCrossVersionReleases(resolve(import.meta.dirname, '..', '..'))
  console.log(process.env.ORCA_CROSS_VERSION_BASELINE_REF?.trim() || baseline)
}
