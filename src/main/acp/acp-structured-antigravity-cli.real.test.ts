// Opt in with ORCA_REAL_AGY_CLI_TEST=1 on a host whose installed agy is signed in; each run sends
// one short prompt from a temp folder, which agy keeps in its own conversation history.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { readAgentJournalTurn } from '../../shared/agent-session/lifecycle/agent-session-turn-record'
import {
  closeProviderTimelineRigs,
  SESSION
} from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { antigravityCliLaunchSpec } from '../antigravity/antigravity-cli-acp-launch-spec'
import { createAcpAgentConnection } from './acp-agent-connection'
import { ANTIGRAVITY_LAUNCH_SPEC } from './acp-launch-specs'
import { openAcpAdapterRig, sendHello } from './acp-structured-adapter.test-support'
import {
  checkAcpLaunchVersion,
  resolveAcpLaunchInvocation
} from './acp-structured-launch-resolution'

const CLI = antigravityCliLaunchSpec(ANTIGRAVITY_LAUNCH_SPEC)
afterEach(closeProviderTimelineRigs)

describe.skipIf(process.env.ORCA_REAL_AGY_CLI_TEST !== '1')('installed agy acp', () => {
  it('opens a Full access chat on the CLI account, lists models and answers a prompt', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'orca-agy-acp-'))
    onTestFinished(() => rm(cwd, { recursive: true, force: true }))
    const inherited = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => !!entry[1])
    )
    const home = await CLI.account.resolve({ launchEnv: inherited, stateDirectory: cwd })
    const { command, prefixArgs, env } = await resolveAcpLaunchInvocation(CLI, home, {
      resolveEnvironment: async () => inherited,
      dataDirectory: cwd
    })
    const release = await checkAcpLaunchVersion(CLI, { command, prefixArgs, cwd, env }, false)
    expect(release.status).toBe('ready')
    const rig = await openAcpAdapterRig({
      spec: CLI,
      launch: {
        command,
        prefixArgs,
        args: CLI.args({ fullAccess: true, pluginDir: null }),
        cwd,
        env,
        fullAccess: true
      },
      deps: { connect: createAcpAgentConnection }
    })
    onTestFinished(async () => {
      await rig.adapter.closeSession(SESSION)
    })
    await rig.acquire({ permissionMode: 'full-access' })
    expect(rig.openFailure()).toBeUndefined()
    const options = await rig.adapter.readOptions({ sessionId: SESSION, fence: 1 })
    expect(options.current.reportedPermissionMode).toBe('full-access')
    expect(options.models.length).toBeGreaterThan(0)
    expect(options.models.some((model) => model.efforts.length > 0)).toBe(true)
    await sendHello(rig, 'send-1')
    await vi.waitFor(
      async () => {
        const rows = await rig.rig.rows()
        const turns = rows.flatMap((row) => readAgentJournalTurn(row.body) ?? [])
        expect(turns.at(-1)).toMatchObject({ state: 'completed', outcome: 'success' })
        expect(
          rows.some((row) => row.body.kind === 'message' && row.body.role === 'assistant')
        ).toBe(true)
      },
      { timeout: 150_000, interval: 250 }
    )
  }, 180_000)
})
