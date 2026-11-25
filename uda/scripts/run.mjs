import process from 'node:process'

const COMMANDS = {
  ci: async (argv) => (await import('./ci-steps.mjs')).runCi(argv),
  'seam-check': async (argv) => (await import('./seam-check.mjs')).runSeamCheck(argv),
  version: async (argv) => (await import('./version.mjs')).runVersion(argv)
}

const RESERVED = [
  'merge',
  'sync',
  'release-build',
  'release-audit',
  'release-publish',
  'release-rollback',
  'disable-upstream-workflows'
]

function printUsage(stream) {
  stream.write(
    `Usage: pnpm uda <command> [options]\n` +
      `Commands: ${Object.keys(COMMANDS).join(', ')}\n` +
      `Reserved (not available yet): ${RESERVED.join(', ')}\n`
  )
}

async function main(argv) {
  const [name, ...rest] = argv
  if (name && Object.hasOwn(COMMANDS, name)) {
    return COMMANDS[name](rest)
  }
  if (RESERVED.includes(name)) {
    console.error(`pnpm uda ${name} is not available yet.`)
    return 1
  }
  if (name === '--help' || name === '-h') {
    printUsage(process.stdout)
    return 0
  }
  console.error(name ? `Unknown command: ${name}` : 'Missing command.')
  printUsage(process.stderr)
  return 1
}

process.exitCode = await main(process.argv.slice(2))
