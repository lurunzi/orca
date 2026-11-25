import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { git, pnpmCommand, runInherited } from './command-runner.mjs'
import { ensureGitleaks } from './gitleaks-binary.mjs'
import { runSeamCheck } from './seam-check.mjs'

const REQUIRED_NODE_MAJOR = 24
const DENYLIST_FILE = fileURLToPath(new URL('../secrets-denylist.txt', import.meta.url))

// Hashes copied from gitleaks_8.30.1_checksums.txt of the official v8.30.1 GitHub release.
const GITLEAKS_VERSION = '8.30.1'
const GITLEAKS_SHA256 = {
  'gitleaks_8.30.1_windows_x64.zip':
    'd29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e',
  'gitleaks_8.30.1_windows_arm64.zip':
    'b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f',
  'gitleaks_8.30.1_darwin_x64.tar.gz':
    'dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709',
  'gitleaks_8.30.1_darwin_arm64.tar.gz':
    'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
  'gitleaks_8.30.1_linux_x64.tar.gz':
    '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
  'gitleaks_8.30.1_linux_arm64.tar.gz':
    'e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080'
}

const WINDOWS_RUNNER = {
  reason: 'wired with the Windows runner',
  fix: 'runs on the self-hosted Windows runner once uda-pr.yml lands'
}

function baseRef() {
  return process.env.ORCA_CODE_QUALITY_BASE || 'origin/main'
}

function pnpmStep(args) {
  return {
    describe: () => pnpmCommand(args).display,
    run: () => {
      const { command, args: fullArgs, shell } = pnpmCommand(args)
      const env = { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' }
      return runInherited(command, fullArgs, { shell, env }) === 0
        ? { status: 'passed' }
        : { status: 'failed', reason: `${pnpmCommand(args).display} exited non-zero` }
    }
  }
}

function readDenylist() {
  return readFileSync(DENYLIST_FILE, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => ({ source: line, pattern: new RegExp(line, 'i') }))
}

function denylistHits(base) {
  const patterns = readDenylist()
  const hits = []
  const check = (where, text) => {
    for (const { source, pattern } of patterns) {
      if (pattern.test(text)) {
        hits.push(`${where}: matches /${source}/`)
      }
    }
  }
  for (const commit of git(['log', '--format=%H%x00%B%x01', `${base}..HEAD`]).stdout.split(
    '\x01'
  )) {
    const [sha, message] = commit.trim().split('\0')
    if (sha) {
      check(`commit ${sha.slice(0, 12)} message`, message ?? '')
    }
  }
  const diff = git(['-c', 'core.quotepath=false', 'diff', '--unified=0', `${base}...HEAD`]).stdout
  let file = null
  let line = 0
  for (const text of diff.split('\n')) {
    if (text.startsWith('+++ ')) {
      file = text.replace(/^\+\+\+ (?:b\/)?/, '')
      check(`${file} (path)`, file)
    } else if (text.startsWith('@@')) {
      line = Number(/\+(\d+)/.exec(text)?.[1] ?? 0)
    } else if (text.startsWith('+')) {
      check(`${file}:${line}`, text.slice(1))
      line += 1
    }
  }
  return hits
}

async function runSecrets() {
  const base = baseRef()
  if (!git(['rev-parse', '-q', '--verify', `${base}^{commit}`], { allowFailure: true }).ok) {
    return { status: 'not-covered', reason: `base ${base} is missing`, fix: 'git fetch origin' }
  }
  const gitleaks = await ensureGitleaks({
    version: GITLEAKS_VERSION,
    sha256ByAsset: GITLEAKS_SHA256
  })
  if (gitleaks.notCovered) {
    return { status: 'not-covered', reason: gitleaks.notCovered, fix: gitleaks.fix }
  }
  const leaks = runInherited(gitleaks.path, [
    'git',
    '--no-banner',
    '--redact',
    `--log-opts=${base}..HEAD`,
    '.'
  ])
  const failures = leaks === 0 ? [] : [`gitleaks found leaks in ${base}..HEAD (exit ${leaks})`]
  const denylistOn = process.env.UDA_SECRETS_DENYLIST === '1'
  if (denylistOn) {
    const hits = denylistHits(base)
    for (const hit of hits) {
      console.error(`denylist: ${hit}`)
    }
    if (hits.length > 0) {
      failures.push(`${hits.length} denylist hit(s) in ${base}..HEAD`)
    }
  }
  const scope = denylistOn
    ? 'gitleaks + uda/secrets-denylist.txt'
    : 'gitleaks only; denylist skipped (set UDA_SECRETS_DENYLIST=1 for upstream-bound branches)'
  return failures.length === 0
    ? { status: 'passed', note: scope }
    : { status: 'failed', reason: `${failures.join('; ')} [${scope}]` }
}

// Step names are a contract: the UDA workflow calls `pnpm uda ci --step <name>`.
export const CI_STEPS = [
  {
    name: 'seam-check',
    describe: () => 'node uda/scripts/run.mjs seam-check',
    run: () =>
      runSeamCheck([]) === 0
        ? { status: 'passed', note: 'report only' }
        : {
            status: 'not-covered',
            reason: 'seam list could not be computed',
            fix: 'fetch the tag in uda/UPSTREAM_BASE from https://github.com/stablyai/orca.git'
          }
  },
  {
    name: 'changed',
    ...pnpmStep(['check:changed', `--base=${baseRef()}`])
  },
  { name: 'source', ...pnpmStep(['ci:local']) },
  {
    name: 'identity',
    ...pnpmStep([
      'exec',
      'vitest',
      'run',
      '--config',
      'config/vitest.config.ts',
      'src/shared/product-identity.test.ts'
    ])
  },
  {
    name: 'secrets',
    describe: () =>
      `gitleaks ${GITLEAKS_VERSION} git --log-opts=${baseRef()}..HEAD${
        process.env.UDA_SECRETS_DENYLIST === '1' ? ' + denylist' : ''
      }`,
    run: runSecrets
  },
  {
    name: 'package-smoke',
    windowsOnly: true,
    describe: () => `not implemented (${WINDOWS_RUNNER.reason})`,
    run: () => ({ status: 'not-covered', ...WINDOWS_RUNNER })
  },
  {
    name: 'update-e2e',
    windowsOnly: true,
    describe: () => `not implemented (${WINDOWS_RUNNER.reason})`,
    run: () => ({ status: 'not-covered', ...WINDOWS_RUNNER })
  }
]

function parseCiArgs(argv) {
  const options = { list: false, dryRun: false, step: null }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--list') {
      options.list = true
    } else if (argument === '--dry-run') {
      options.dryRun = true
    } else if (argument === '--step') {
      options.step = argv[++index]
      if (!options.step) {
        throw new Error('--step needs a step name.')
      }
    } else if (argument.startsWith('--step=')) {
      options.step = argument.slice('--step='.length)
    } else {
      throw new Error(`Unknown option ${argument}. Use --list, --step <name>, --dry-run.`)
    }
  }
  return options
}

function nodeVersionProblem() {
  const major = Number(process.versions.node.split('.')[0])
  if (major === REQUIRED_NODE_MAJOR) {
    return null
  }
  return (
    `Node ${REQUIRED_NODE_MAJOR} is required (found ${process.versions.node}). ` +
    `Install it with fnm (\`fnm install ${REQUIRED_NODE_MAJOR} && fnm use ${REQUIRED_NODE_MAJOR}\`) ` +
    `or volta (\`volta install node@${REQUIRED_NODE_MAJOR}\`), then run \`corepack enable\` ` +
    'so pnpm comes from packageManager in package.json.'
  )
}

/** @typedef {{ name: string, status: string, note?: string, reason?: string, fix?: string }} StepResult */

/** @param {StepResult[]} results */
function printSummary(results) {
  /** @type {Record<string, StepResult[]>} */
  const groups = { passed: [], failed: [], 'not-covered': [] }
  for (const result of results) {
    groups[result.status].push(result)
  }
  console.log('\n== pnpm uda ci summary ==')
  console.log(`Passed (${groups.passed.length}):`)
  for (const { name, note } of groups.passed) {
    console.log(`  ${name}${note ? ` - ${note}` : ''}`)
  }
  console.log(`Failed (${groups.failed.length}):`)
  for (const { name, reason } of groups.failed) {
    console.log(`  ${name} - ${reason}`)
  }
  console.log(`Not covered (${groups['not-covered'].length}):`)
  for (const { name, reason, fix } of groups['not-covered']) {
    console.log(`  ${name} - ${reason}; fix: ${fix}`)
  }
  return groups.failed.length > 0 ? 1 : 0
}

export async function runCi(argv) {
  let options
  try {
    options = parseCiArgs(argv)
  } catch (error) {
    console.error(error.message)
    return 1
  }
  if (options.list) {
    for (const step of CI_STEPS) {
      console.log(step.windowsOnly ? `${step.name} (Windows only)` : step.name)
    }
    return 0
  }
  const steps = options.step ? CI_STEPS.filter((step) => step.name === options.step) : CI_STEPS
  if (steps.length === 0) {
    console.error(
      `Unknown step ${options.step}. Steps: ${CI_STEPS.map((step) => step.name).join(', ')}`
    )
    return 1
  }
  if (options.dryRun) {
    for (const step of steps) {
      console.log(`${step.name}: ${step.describe()}`)
    }
    return 0
  }
  const nodeProblem = nodeVersionProblem()
  if (nodeProblem) {
    console.error(nodeProblem)
    return 1
  }
  const results = []
  for (const step of steps) {
    console.log(`\n== ${step.name}: ${step.describe()} ==`)
    let outcome
    try {
      outcome = await step.run()
    } catch (error) {
      outcome = { status: 'failed', reason: error.message }
    }
    results.push({ name: step.name, ...outcome })
  }
  return printSummary(results)
}
