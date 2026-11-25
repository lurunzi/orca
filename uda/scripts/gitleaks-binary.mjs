import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT, runInherited } from './command-runner.mjs'

const RELEASE_ASSET = {
  'win32-x64': 'windows_x64.zip',
  'win32-arm64': 'windows_arm64.zip',
  'darwin-x64': 'darwin_x64.tar.gz',
  'darwin-arm64': 'darwin_arm64.tar.gz',
  'linux-x64': 'linux_x64.tar.gz',
  'linux-arm64': 'linux_arm64.tar.gz'
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function tarExecutable() {
  // Why: Git Bash's GNU tar on PATH cannot read zip; the Windows bsdtar can.
  return process.platform === 'win32'
    ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar'
}

// Returns { path } or { notCovered: reason, fix }; throws when the download fails verification.
export async function ensureGitleaks({ version, sha256ByAsset }) {
  const platformKey = `${process.platform}-${process.arch}`
  const suffix = RELEASE_ASSET[platformKey]
  if (!suffix) {
    return {
      notCovered: `no pinned gitleaks ${version} build for ${platformKey}`,
      fix: 'run the secrets step on Windows, macOS or Linux (x64/arm64)'
    }
  }
  const assetName = `gitleaks_${version}_${suffix}`
  const expected = sha256ByAsset[assetName]
  const toolDir = path.join(REPO_ROOT, '.local', 'tools', `gitleaks-${version}`)
  const archivePath = path.join(toolDir, assetName)
  const binaryPath = path.join(toolDir, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks')

  if (!existsSync(archivePath)) {
    const url = `https://github.com/gitleaks/gitleaks/releases/download/v${version}/${assetName}`
    console.log(`Downloading ${url}`)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`gitleaks download failed: HTTP ${response.status}`)
    }
    const archive = Buffer.from(await response.arrayBuffer())
    const actual = sha256(archive)
    if (actual !== expected) {
      throw new Error(`${assetName} SHA-256 mismatch: expected ${expected}, got ${actual}`)
    }
    mkdirSync(toolDir, { recursive: true })
    writeFileSync(archivePath, archive)
  }
  const actual = sha256(readFileSync(archivePath))
  if (actual !== expected) {
    throw new Error(`${archivePath} SHA-256 mismatch: expected ${expected}, got ${actual}`)
  }
  console.log(`gitleaks ${version}: ${assetName} SHA-256 ${actual} matches the pinned checksum.`)
  if (!existsSync(binaryPath)) {
    const status = runInherited(tarExecutable(), [
      '-xf',
      archivePath,
      '-C',
      toolDir,
      path.basename(binaryPath)
    ])
    if (status !== 0 || !existsSync(binaryPath)) {
      throw new Error(`could not extract ${path.basename(binaryPath)} from ${assetName}`)
    }
  }
  return { path: binaryPath }
}
