import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PACKAGE_JSON = fileURLToPath(new URL('../../package.json', import.meta.url))

// Why: electron-updater ignores prerelease builds on stable, so the UDA revision lives in the patch.
export function udaVersion(upstreamVersion, revision) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(upstreamVersion)
  if (!match) {
    throw new Error(`Upstream version "${upstreamVersion}" is not X.Y.Z.`)
  }
  if (!/^\d+$/.test(String(revision)) || Number(revision) < 1 || Number(revision) > 99) {
    throw new Error(`UDA revision must be an integer from 1 to 99, got "${revision}".`)
  }
  const [, major, minor, patch] = match
  return `${major}.${minor}.${Number(patch) * 100 + Number(revision)}`
}

export function runVersion(argv) {
  if (argv.length !== 1) {
    console.error('Usage: pnpm uda version <N>   (N = UDA revision, 1-99)')
    return 1
  }
  try {
    const { version } = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
    console.log(udaVersion(version, argv[0]))
    return 0
  } catch (error) {
    console.error(error.message)
    return 1
  }
}
