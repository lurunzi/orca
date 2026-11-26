import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { git } from './command-runner.mjs'

const UPSTREAM_URL = 'https://github.com/stablyai/orca.git'
const UPSTREAM_BASE_FILE = fileURLToPath(new URL('../UPSTREAM_BASE', import.meta.url))
const SEAMS_FILE = fileURLToPath(new URL('../seams.json', import.meta.url))
const OVERLAY_PATH = /^(?:uda\/|src\/uda\/|assets\/icon\.png$|\.github\/workflows\/uda-)/

function ensureUpstreamTag(tag) {
  const ref = `refs/tags/${tag}`
  if (git(['rev-parse', '-q', '--verify', `${ref}^{commit}`], { allowFailure: true }).ok) {
    return
  }
  console.log(`Fetching ${tag} from ${UPSTREAM_URL}`)
  git(['fetch', '--no-tags', UPSTREAM_URL, `+${ref}:${ref}`])
}

export function computeSeams() {
  const upstreamBase = readFileSync(UPSTREAM_BASE_FILE, 'utf8').trim()
  if (!upstreamBase) {
    throw new Error('uda/UPSTREAM_BASE is empty.')
  }
  ensureUpstreamTag(upstreamBase)
  const output = git([
    '-c',
    'core.quotepath=false',
    'diff',
    '--name-only',
    '-z',
    `refs/tags/${upstreamBase}...HEAD`
  ]).stdout
  const files = output
    .split('\0')
    .filter((file) => file && !OVERLAY_PATH.test(file))
    .sort()
  return { upstreamBase, total: files.length, files }
}

function readRecord() {
  try {
    return JSON.parse(readFileSync(SEAMS_FILE, 'utf8'))
  } catch {
    return null
  }
}

export function runSeamCheck(argv) {
  const update = argv.includes('--update')
  const unknown = argv.filter((argument) => argument !== '--update')
  if (unknown.length > 0) {
    console.error(`Unknown option ${unknown[0]}. Use --update.`)
    return 1
  }
  let current
  try {
    current = computeSeams()
  } catch (error) {
    console.error(`seam-check could not list changed upstream files: ${error.message}`)
    return 1
  }
  if (update) {
    writeFileSync(SEAMS_FILE, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
    console.log(
      `Wrote uda/seams.json: ${current.total} files changed against ${current.upstreamBase}.`
    )
    return 0
  }
  const record = readRecord()
  console.log(`Upstream base: ${current.upstreamBase}`)
  console.log(`Upstream files changed outside the UDA overlay: ${current.total}`)
  if (!record) {
    console.log('No readable uda/seams.json; run `pnpm uda seam-check --update` to record one.')
    return 0
  }
  const delta = current.total - record.total
  console.log(
    `Recorded: ${record.total} against ${record.upstreamBase} (change ${delta >= 0 ? '+' : ''}${delta})`
  )
  const recorded = new Set(record.files)
  const added = current.files.filter((file) => !recorded.has(file))
  const currentSet = new Set(current.files)
  const dropped = record.files.filter((file) => !currentSet.has(file)).length
  console.log(`New since the record: ${added.length}; no longer changed: ${dropped}`)
  for (const file of added) {
    console.log(`  + ${file}`)
  }
  return 0
}
