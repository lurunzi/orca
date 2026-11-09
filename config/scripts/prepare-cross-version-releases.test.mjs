import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { prepareCrossVersionReleases } from './prepare-cross-version-releases.mjs'

const roots = []
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()

function releaseRepository() {
  const root = mkdtempSync(join(tmpdir(), 'orca-release-preparation-'))
  roots.push(root)
  const upstream = join(root, 'upstream')
  git(root, ['init', '-q', upstream])
  return { root, upstream, fork: join(root, 'fork') }
}

function release(repo, tag) {
  git(repo, [
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-q',
    '--allow-empty',
    '--no-gpg-sign',
    '-m',
    tag
  ])
  git(repo, ['tag', tag])
  return git(repo, ['rev-parse', 'HEAD'])
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

it('supplies missing release refs to a fork without pairing a backport with future upstream code', () => {
  const { root, upstream, fork } = releaseRepository()
  const candidate = release(upstream, 'v1.4.9')
  git(upstream, ['tag', 'v1.4.8'])
  release(upstream, 'v1.4.10')
  git(root, ['clone', '-q', '--no-tags', upstream, fork])
  git(fork, ['checkout', '-q', '--detach', candidate])
  expect(git(fork, ['tag', '--list'])).toBe('')

  expect(prepareCrossVersionReleases(fork, upstream)).toBe('v1.4.9')
  expect(git(fork, ['rev-parse', 'v1.4.8^{commit}'])).toBe(candidate)
  expect(git(fork, ['rev-parse', 'v1.4.10^{commit}'])).not.toBe(candidate)
  expect(git(fork, ['rev-parse', 'HEAD'])).toBe(candidate)
})

it('fails rather than skipping compatibility when there is no stable release on the branch', () => {
  const { root, upstream, fork } = releaseRepository()
  release(upstream, 'v1.5.0-rc.1')
  git(root, ['clone', '-q', '--no-tags', upstream, fork])
  expect(() => prepareCrossVersionReleases(fork, upstream)).toThrow(
    'No stable desktop release tag is reachable from this checkout'
  )
})
