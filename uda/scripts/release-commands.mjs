import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { parse as parseYaml } from 'yaml'
import { ReleaseCheckError, SUMS_FILE, VERSION_RE, verifyReleaseDir } from './release-feed.mjs'
import { draftMirrorRelease, mirrorRelease } from './release-mirror.mjs'
import { describeSsh, fetchPublic, notify, openReleaseSsh, sshTarget } from './release-remote.mjs'
import { tarStream } from './release-tar.mjs'

const PUBLISH_USAGE =
  'Usage: pnpm uda release-publish --version <ver> --dir <path> [--platform win|mac] [--dry-run] [--mirror-only] [--skip-mirror]'
const ROLLBACK_USAGE = 'Usage: pnpm uda release-rollback --to <ver> [--dry-run]'

function parse(argv, options, usage) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: false }).values
  } catch (error) {
    throw new ReleaseCheckError(`${error.message}\n${usage}`)
  }
}

async function reportErrors(run) {
  try {
    return await run()
  } catch (error) {
    console.error(`error: ${error.message}`)
    return 1
  }
}

function publishedRelease(index, version) {
  return (index.releases ?? []).find((release) => release.version === version) ?? null
}

async function comparePublic(urlPath, local) {
  try {
    const remote = await fetchPublic(urlPath)
    return remote.equals(local)
      ? { ok: true, line: `public: ${urlPath} matches the local feed` }
      : { ok: false, line: `public: ${urlPath} DIFFERS from the local feed` }
  } catch (error) {
    return { ok: false, line: `public: ${error.message}` }
  }
}

async function publishPrimary(ssh, { version, dir, feed, upload }) {
  const before = publishedRelease(ssh.status(), version)
  const already = new Set((before?.files ?? []).map((file) => file.name))
  const collisions = upload.filter((name) => already.has(name))
  const sent = upload.filter((name) => !(name === SUMS_FILE && already.has(name)))
  if (sent.length !== upload.length) {
    console.log(`note: ${SUMS_FILE} is already published for v${version}; not uploaded again`)
  }
  const blocking = collisions.filter((name) => name !== SUMS_FILE)
  if (blocking.length > 0) {
    throw new Error(
      `v${version} already has ${blocking.join(', ')}; published files are never replaced`
    )
  }
  console.log(`> ${describeSsh(`put ${version}`)}`)
  if ((await ssh.put(version, tarStream(dir, sent))) !== 0) {
    throw new Error('put failed; nothing was published')
  }
  console.log(`> ${describeSsh(`publish ${version}`)}`)
  if (ssh.run(`publish ${version}`) !== 0) {
    throw new Error('publish refused by the server; channels/stable is unchanged')
  }
  const stable = ssh.status().stable === version
  const local = readFileSync(path.join(dir, feed))
  const checks = [await comparePublic(`/releases/v${version}/${feed}`, local)]
  if (stable) {
    checks.push(await comparePublic(`/channels/stable/${feed}`, local))
  } else {
    checks.push({ ok: true, line: `public: v${version} is not stable; /channels/stable unchanged` })
  }
  for (const check of checks) {
    console.log(check.line)
  }
  return { stable, sent, publicOk: checks.every((check) => check.ok) }
}

export function runReleasePublish(argv) {
  return reportErrors(async () => {
    const opts = parse(
      argv,
      {
        version: { type: 'string' },
        dir: { type: 'string' },
        platform: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'mirror-only': { type: 'boolean', default: false },
        'skip-mirror': { type: 'boolean', default: false }
      },
      PUBLISH_USAGE
    )
    if (!opts.version || !opts.dir) {
      throw new ReleaseCheckError(PUBLISH_USAGE)
    }
    if (opts['mirror-only'] && opts['skip-mirror']) {
      throw new ReleaseCheckError('--mirror-only and --skip-mirror exclude each other')
    }
    const dir = path.resolve(opts.dir)
    const checked = await verifyReleaseDir({ dir, version: opts.version, platform: opts.platform })
    console.log(`verified ${checked.feed} for v${opts.version} (${checked.platform})`)
    console.log(`upload (${checked.upload.length} files, ${checked.totalBytes} bytes):`)
    for (const name of checked.upload) {
      console.log(`  ${name}`)
    }
    for (const { name, reason } of checked.leftOut) {
      console.log(`  left out: ${name} (${reason})`)
    }
    if (opts['dry-run']) {
      console.log(`would run (host ${sshTarget()}):`)
      for (const command of [
        'status',
        `put ${opts.version}`,
        `publish ${opts.version}`,
        'status'
      ]) {
        console.log(
          `  ${describeSsh(command)}${command.startsWith('put') ? ' < tar of the files above' : ''}`
        )
      }
      console.log('dry run: nothing uploaded')
      return 0
    }

    let stable = null
    let names = checked.upload
    if (!opts['mirror-only']) {
      const ssh = openReleaseSsh()
      let primary
      try {
        primary = await publishPrimary(ssh, { ...checked, version: opts.version, dir })
      } finally {
        ssh.close()
      }
      stable = primary.stable
      names = primary.sent
      if (!primary.publicOk) {
        console.error(
          'error: published, but the public check failed; investigate, then rerun with --mirror-only'
        )
        return 1
      }
    }

    let failed = false
    if (opts['skip-mirror']) {
      console.log('mirror: skipped (--skip-mirror)')
    } else {
      try {
        for (const line of mirrorRelease({ version: opts.version, dir, names })) {
          console.log(line)
        }
      } catch (error) {
        console.error(`error: ${error.message}`)
        console.error('mirror failed; the primary feed is unchanged. Rerun with --mirror-only.')
        failed = true
      }
    }
    if (opts['mirror-only']) {
      console.log('notify: skipped (--mirror-only)')
    } else {
      const sent = await notify(
        `UDA Orca v${opts.version} published (${checked.platform}); stable=${stable ? 'yes' : 'no'}`
      )
      console.log(sent.line)
      failed ||= !sent.ok
    }
    return failed ? 1 : 0
  })
}

export function runReleaseRollback(argv) {
  return reportErrors(async () => {
    const opts = parse(
      argv,
      { to: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
      ROLLBACK_USAGE
    )
    if (!VERSION_RE.test(opts.to ?? '')) {
      throw new ReleaseCheckError(ROLLBACK_USAGE)
    }
    const version = opts.to
    if (opts['dry-run']) {
      console.log(`would run (host ${sshTarget()}):`)
      for (const command of ['status', `rollback ${version}`, 'status']) {
        console.log(`  ${describeSsh(command)}`)
      }
      console.log(
        `then check /channels/stable feeds report ${version} and draft the old mirror release`
      )
      return 0
    }
    const ssh = openReleaseSsh()
    let previous
    let release
    try {
      const index = ssh.status()
      release = publishedRelease(index, version)
      if (!release) {
        throw new Error(`v${version} is not published`)
      }
      if (index.stable === version) {
        throw new Error(`v${version} is already stable`)
      }
      previous = index.stable
      console.log(`> ${describeSsh(`rollback ${version}`)}`)
      if (ssh.run(`rollback ${version}`) !== 0) {
        throw new Error('rollback refused by the server')
      }
    } finally {
      ssh.close()
    }

    let failed = false
    const feeds = ['latest.yml', 'latest-mac.yml'].filter((feed) =>
      (release.files ?? []).some((file) => file.name === feed)
    )
    for (const feed of feeds) {
      try {
        const doc = parseYaml((await fetchPublic(`/channels/stable/${feed}`)).toString('utf8'))
        const ok = String(doc?.version) === version
        console.log(
          `public: /channels/stable/${feed} version ${doc?.version}${ok ? '' : ` (expected ${version})`}`
        )
        failed ||= !ok
      } catch (error) {
        console.log(`public: ${error.message}`)
        failed = true
      }
    }
    if (previous) {
      try {
        for (const line of draftMirrorRelease(previous)) {
          console.log(line)
        }
      } catch (error) {
        console.error(`error: ${error.message}`)
        failed = true
      }
    }
    const sent = await notify(`UDA Orca stable rolled back: v${previous} -> v${version}`)
    console.log(sent.line)
    return failed || !sent.ok ? 1 : 0
  })
}

export function runReleaseStatus(argv) {
  return reportErrors(async () => {
    if (argv.length > 0) {
      throw new ReleaseCheckError('Usage: pnpm uda release-status')
    }
    const ssh = openReleaseSsh()
    try {
      console.log(JSON.stringify(ssh.status(), null, 1))
    } finally {
      ssh.close()
    }
    return 0
  })
}
