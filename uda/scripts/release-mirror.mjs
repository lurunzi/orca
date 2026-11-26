import { statSync } from 'node:fs'
import path from 'node:path'
import { runCaptured, runInherited } from './command-runner.mjs'
import { SUMS_FILE } from './release-feed.mjs'

export const MIRROR_REPO = 'Ultramarine-Digital-Art/uda-orca-releases'
export const MIRROR_MISSING = 'mirror: not covered — repository does not exist yet'

function gh(args) {
  return runCaptured('gh', [...args, '-R', MIRROR_REPO])
}

/** 'missing' when the repository does not exist, otherwise true; throws when gh itself fails. */
export function mirrorRepoExists() {
  const result = runCaptured('gh', ['repo', 'view', MIRROR_REPO, '--json', 'name'])
  if (result.status === 0) {
    return true
  }
  if (/Could not resolve to a Repository/i.test(result.stderr)) {
    return false
  }
  throw new Error(`gh repo view failed: ${result.stderr.trim()}`)
}

function viewRelease(tag) {
  const result = gh(['release', 'view', tag, '--json', 'isDraft,assets'])
  if (result.status !== 0) {
    if (/release not found/i.test(result.stderr)) {
      return null
    }
    throw new Error(`gh release view ${tag} failed: ${result.stderr.trim()}`)
  }
  return JSON.parse(result.stdout)
}

// Why: GitHub stores asset names with spaces as dots.
function assetName(name) {
  return name.replaceAll(' ', '.')
}

/** Uploads `names` from `dir` to the mirror release v<version> and publishes it. Returns lines to print. */
export function mirrorRelease({ version, dir, names }) {
  if (!mirrorRepoExists()) {
    return [MIRROR_MISSING]
  }
  const tag = `v${version}`
  const lines = []
  let release = viewRelease(tag)
  if (!release) {
    const created = gh([
      'release',
      'create',
      tag,
      '--draft',
      '--title',
      `UDA Orca ${tag}`,
      '--notes',
      `Mirror of the UDA Orca ${tag} installer feed.`
    ])
    if (created.status !== 0) {
      throw new Error(`gh release create ${tag} failed: ${created.stderr.trim()}`)
    }
    lines.push(`mirror: created draft release ${tag}`)
    release = viewRelease(tag)
  }
  const existing = new Map(release.assets.map((asset) => [asset.name, asset.size]))
  const toUpload = []
  for (const name of names) {
    const size = statSync(path.join(dir, name)).size
    const present = existing.get(assetName(name))
    if (present === undefined) {
      toUpload.push(path.join(dir, name))
    } else if (present === size || name === SUMS_FILE) {
      lines.push(`mirror: ${name} already present, skipped`)
    } else {
      throw new Error(
        `mirror: ${name} is already on ${tag} with size ${present}, local ${size}; assets are never replaced`
      )
    }
  }
  if (toUpload.length > 0) {
    const status = runInherited('gh', ['release', 'upload', tag, ...toUpload, '-R', MIRROR_REPO])
    if (status !== 0) {
      throw new Error(`gh release upload ${tag} exited ${status}`)
    }
  }
  const after = viewRelease(tag)
  const uploaded = new Map(after.assets.map((asset) => [asset.name, asset.size]))
  for (const name of names) {
    const size = statSync(path.join(dir, name)).size
    if (name !== SUMS_FILE && uploaded.get(assetName(name)) !== size) {
      throw new Error(
        `mirror: ${name} on ${tag} has size ${uploaded.get(assetName(name))}, local ${size}`
      )
    }
  }
  lines.push(`mirror: ${names.length} files verified by size on ${tag}`)
  if (after.isDraft) {
    const published = gh(['release', 'edit', tag, '--draft=false'])
    if (published.status !== 0) {
      throw new Error(`gh release edit ${tag} --draft=false failed: ${published.stderr.trim()}`)
    }
    lines.push(`mirror: published ${tag}`)
  }
  return lines
}

/** Sets the mirror release of `version` back to draft. Returns lines to print. */
export function draftMirrorRelease(version) {
  if (!mirrorRepoExists()) {
    return [MIRROR_MISSING]
  }
  const tag = `v${version}`
  if (!viewRelease(tag)) {
    return [`mirror: not covered — no mirror release ${tag}`]
  }
  const result = gh(['release', 'edit', tag, '--draft=true'])
  if (result.status !== 0) {
    throw new Error(`gh release edit ${tag} --draft=true failed: ${result.stderr.trim()}`)
  }
  return [`mirror: ${tag} set to draft`]
}
