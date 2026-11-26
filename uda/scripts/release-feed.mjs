import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

// Why: these mirror uda-orca-release-receive on uda-vm; a file the server would refuse must fail here first.
export const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,9}$/
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ +()-]{0,150}$/
export const TAR_NAME_MAX_BYTES = 100
export const MAX_FILES = 40
export const MAX_FILE_BYTES = 2 * 1024 ** 3
export const MAX_TOTAL_BYTES = 6 * 1024 ** 3
export const PLATFORM_FEEDS = { win: 'latest.yml', mac: 'latest-mac.yml' }
export const SUMS_FILE = 'SHA256SUMS'

export class ReleaseCheckError extends Error {}

export function sha512Base64(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('base64')))
  })
}

export function selectFeed(dir, platform) {
  const present = Object.entries(PLATFORM_FEEDS).filter(([, feed]) =>
    existsSync(path.join(dir, feed))
  )
  if (platform) {
    const feed = PLATFORM_FEEDS[platform]
    if (!feed) {
      throw new ReleaseCheckError(`--platform must be win or mac, got "${platform}"`)
    }
    if (!present.some(([name]) => name === platform)) {
      throw new ReleaseCheckError(`${feed} not found in ${dir}`)
    }
    return { platform, feed }
  }
  if (present.length === 0) {
    throw new ReleaseCheckError(`neither latest.yml nor latest-mac.yml found in ${dir}`)
  }
  if (present.length > 1) {
    throw new ReleaseCheckError('both latest.yml and latest-mac.yml are present; pass --platform')
  }
  return { platform: present[0][0], feed: present[0][1] }
}

// Same entry list the server builds: files[] plus the legacy top-level path/sha512.
export function feedEntries(feed, text) {
  let doc
  try {
    doc = parseYaml(text)
  } catch (error) {
    throw new ReleaseCheckError(`${feed}: not valid YAML (${error.message})`)
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new ReleaseCheckError(`${feed}: not a YAML mapping`)
  }
  const entries = Array.isArray(doc.files) ? [...doc.files] : []
  if (doc.path && doc.sha512) {
    entries.push({ url: doc.path, sha512: doc.sha512 })
  }
  if (entries.length === 0) {
    throw new ReleaseCheckError(`${feed}: no files listed`)
  }
  return {
    version: doc.version === undefined || doc.version === null ? null : String(doc.version),
    entries: entries.map((entry) => ({
      name: String(entry?.url ?? ''),
      sha512: entry?.sha512 ? String(entry.sha512) : '',
      size: entry?.size === undefined ? null : Number(entry.size)
    }))
  }
}

export function nameRefusal(name) {
  if (!NAME_RE.test(name)) {
    return 'name not accepted by the server'
  }
  if (Buffer.byteLength(name) > TAR_NAME_MAX_BYTES) {
    return `name longer than ${TAR_NAME_MAX_BYTES} bytes (ustar limit)`
  }
  return null
}

/**
 * Verifies one feed against the files in `dir` and returns the files to upload and the ones left out.
 * Throws ReleaseCheckError on any mismatch.
 */
export async function verifyReleaseDir({ dir, version, platform }) {
  if (!VERSION_RE.test(version ?? '')) {
    throw new ReleaseCheckError(`version "${version}" is not N.N.N`)
  }
  const { feed, platform: resolvedPlatform } = selectFeed(dir, platform)
  const { version: feedVersion, entries } = feedEntries(
    feed,
    readFileSync(path.join(dir, feed), 'utf8')
  )
  if (feedVersion !== version) {
    throw new ReleaseCheckError(`${feed}: version is ${feedVersion}, expected ${version}`)
  }

  const referenced = new Set()
  for (const entry of entries) {
    const refusal = entry.sha512 ? nameRefusal(entry.name) : 'no sha512'
    if (refusal) {
      throw new ReleaseCheckError(`${feed}: entry ${JSON.stringify(entry.name)}: ${refusal}`)
    }
    if (referenced.has(entry.name)) {
      continue
    }
    const filePath = path.join(dir, entry.name)
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      throw new ReleaseCheckError(`${feed}: ${entry.name} is listed but missing from ${dir}`)
    }
    const size = statSync(filePath).size
    if (entry.size !== null && entry.size !== size) {
      throw new ReleaseCheckError(
        `${feed}: size mismatch for ${entry.name} (feed ${entry.size}, file ${size})`
      )
    }
    if ((await sha512Base64(filePath)) !== entry.sha512) {
      throw new ReleaseCheckError(`${feed}: sha512 mismatch for ${entry.name}`)
    }
    referenced.add(entry.name)
  }

  const upload = [feed]
  const leftOut = []
  for (const dirent of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  )) {
    const name = dirent.name
    if (name === feed) {
      continue
    }
    const reason = uploadRefusal(name, dirent, referenced)
    if (reason) {
      leftOut.push({ name, reason })
    } else {
      upload.push(name)
    }
  }
  assertServerFileSet(upload, referenced)
  const sizes = upload.map((name) => statSync(path.join(dir, name)).size)
  const total = sizes.reduce((sum, size) => sum + size, 0)
  if (
    upload.length > MAX_FILES ||
    total > MAX_TOTAL_BYTES ||
    sizes.some((s) => s > MAX_FILE_BYTES)
  ) {
    throw new ReleaseCheckError(
      `upload exceeds the server limit (${MAX_FILES} files, 2 GiB per file, 6 GiB total)`
    )
  }
  return { feed, platform: resolvedPlatform, upload, leftOut, totalBytes: total }
}

function uploadRefusal(name, dirent, referenced) {
  if (!dirent.isFile()) {
    return dirent.isDirectory() ? 'directory' : 'not a regular file'
  }
  const base = name.endsWith('.blockmap') ? name.slice(0, -'.blockmap'.length) : name
  if (!referenced.has(base) && name !== SUMS_FILE) {
    return Object.values(PLATFORM_FEEDS).includes(name)
      ? 'feed of the other platform'
      : 'not referenced by the feed'
  }
  return nameRefusal(name)
}

// The server's file-set rule, applied to the final list so selection bugs cannot reach a put.
export function assertServerFileSet(upload, referenced) {
  for (const name of upload) {
    const refusal = nameRefusal(name)
    if (refusal) {
      throw new ReleaseCheckError(`${name}: ${refusal}`)
    }
    const base = name.endsWith('.blockmap') ? name.slice(0, -'.blockmap'.length) : name
    const isFeed = Object.values(PLATFORM_FEEDS).includes(name)
    if (!isFeed && name !== SUMS_FILE && !referenced.has(base)) {
      throw new ReleaseCheckError(`${name} is not referenced by any uploaded feed file`)
    }
  }
}
