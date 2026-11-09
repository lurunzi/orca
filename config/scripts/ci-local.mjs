import { spawnSync } from 'node:child_process'
import { resolvePnpmCliInvocation } from './tool-invocation/pnpm-cli-invocation.mjs'
import { prepareCrossVersionReleases } from './prepare-cross-version-releases.mjs'

// Uses the same package scripts and Vitest config as pr.yml / unit-tests.yml.
const invocation = resolvePnpmCliInvocation()
const args = process.argv.slice(2)
const focused = args[0] === '--focused'
const tests = focused ? args.slice(1) : args
const env = { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' }
const checks = [
  ['run', focused ? 'check:code-quality:changed' : 'lint'],
  ['run', 'typecheck'],
  ['exec', 'vitest', 'run', '--config', 'config/vitest.config.ts', ...tests]
]
if (
  tests.some((file) =>
    /(?:^|\/)tests\/e2e\/cross-version-wire(?:\/|$)/.test(file.replaceAll('\\', '/'))
  )
) {
  const baseline = prepareCrossVersionReleases(process.cwd())
  env.ORCA_CROSS_VERSION_BASELINE_REF ||= baseline
  console.log(`Cross-version release baseline: ${env.ORCA_CROSS_VERSION_BASELINE_REF}`)
  checks.splice(
    2,
    0,
    ['run', 'check:daemon-protocol-crossing'],
    [
      'run',
      'check:runtime-launcher-protocol-ratchet',
      '--',
      '--base',
      env.ORCA_CODE_QUALITY_BASE || 'origin/main'
    ]
  )
}
console.log(
  'Local source checks only; packaging, rendered Electron, mobile and other operating systems are not covered.'
)
if (focused) {
  console.log('Focused mode: changed-code lint and only the selected unit tests.')
}
for (const check of checks) {
  console.log(`pnpm ${check.join(' ')}`)
  const result = spawnSync(invocation.command, [...invocation.prefixArgs, ...check], {
    shell: invocation.shell,
    windowsHide: true,
    stdio: 'inherit',
    env
  })
  if (result.error || result.status !== 0) {
    if (result.error) {
      console.error(result.error.message)
    }
    process.exit(result.status ?? 1)
  }
}
