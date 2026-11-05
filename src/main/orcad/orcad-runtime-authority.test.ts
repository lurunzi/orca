import { afterEach, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { OrcadFeatureReadiness } from '../runtime/rpc/orcad-feature-readiness'
import { restoreOrcadTerminalAuthority } from './orcad-restored-terminal-authority'
import { restoreOrcadRuntimeAuthority } from './orcad-runtime-authority'

const platform = vi.hoisted(() => ({ value: 'linux' }))
vi.mock('node:process', () => ({
  default: {
    get platform() {
      return platform.value
    },
    get env() {
      return globalThis.process.env
    }
  }
}))
vi.mock('./orcad-restored-terminal-authority', () => ({
  restoreOrcadTerminalAuthority: vi.fn(async () => {})
}))
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
  platform.value = 'linux'
})
function runtime(install: () => Promise<void>): OrcaRuntimeService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: terminal recovery is mocked; only this installer is called.
  return { ensureStructuredAgentSessionHost: install } as OrcaRuntimeService
}
const readiness = () => new OrcadFeatureReadiness(['orchestration', 'unshownPlacement'])

it('waits for Dashboard installation after terminal recovery before startup can proceed', async () => {
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'fixture-instance')
  const events: string[] = []
  vi.mocked(restoreOrcadTerminalAuthority).mockImplementationOnce(async () => {
    events.push('terminals-restored')
  })
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const entry = new Promise<void>((resolve) => {
    entered = resolve
  })
  const pending = restoreOrcadRuntimeAuthority(
    runtime(async () => {
      events.push('installing')
      entered()
      await gate
      events.push('installed')
    }),
    (_name, run) => run(),
    readiness()
  ).then(() => {
    events.push('startup-continues')
  })
  try {
    await entry
    expect(events).toEqual(['terminals-restored', 'installing'])
  } finally {
    release()
    await pending
  }
  expect(events).toEqual(['terminals-restored', 'installing', 'installed', 'startup-continues'])
})

it.each([
  ['linux', ''],
  ['win32', 'fixture-instance'],
  ['darwin', 'fixture-instance']
])('preserves lazy installation on %s with pool id %s', async (host, instanceId) => {
  platform.value = host
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', instanceId)
  await restoreOrcadRuntimeAuthority(
    runtime(async () => {
      throw new Error('Unexpected Dashboard installation')
    }),
    (_name, run) => run(),
    readiness()
  )
  expect(restoreOrcadTerminalAuthority).toHaveBeenCalledOnce()
})

it('propagates installation failure instead of admitting RPC readiness', async () => {
  vi.stubEnv('ORCA_DASHBOARD_INSTANCE_ID', 'fixture-instance')
  await expect(
    restoreOrcadRuntimeAuthority(
      runtime(async () => {
        throw new Error('fixture-install-failure')
      }),
      (_name, run) => run(),
      readiness()
    )
  ).rejects.toThrow('fixture-install-failure')
})
