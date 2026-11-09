// Opt in with ORCA_REAL_CURSOR_CLI_TEST=1 on a host whose installed cursor-agent is signed in; each
// run sends one short prompt from a temp folder, which Cursor keeps in its own chat history.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { readAgentJournalTurn } from '../../shared/agent-session/lifecycle/agent-session-turn-record'
import {
  closeProviderTimelineRigs,
  SESSION
} from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { createAcpAgentConnection } from './acp-agent-connection'
import { acpLaunchSpecFor } from './acp-launch-specs'
import { openAcpAdapterRig, sendHello } from './acp-structured-adapter.test-support'
import { resolveAcpLaunchInvocation } from './acp-structured-launch-resolution'

const CURSOR = acpLaunchSpecFor('cursor')!
afterEach(closeProviderTimelineRigs)

describe.skipIf(process.env.ORCA_REAL_CURSOR_CLI_TEST !== '1')('installed cursor-agent acp', () => {
  it(
    'answers a send that names a CLI variant id such as composer-2.5-fast',
    async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'orca-cursor-acp-'))
      onTestFinished(() =>
        rm(cwd, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
      )
      const inherited = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => !!entry[1])
      )
      const home = await CURSOR.account.resolve({ launchEnv: inherited, stateDirectory: cwd })
      const { command, prefixArgs, env } = await resolveAcpLaunchInvocation(CURSOR, home, {
        resolveEnvironment: async () => inherited,
        dataDirectory: cwd
      })
      const rig = await openAcpAdapterRig({
        spec: CURSOR,
        launch: {
          command,
          prefixArgs,
          args: CURSOR.args({ fullAccess: false, pluginDir: null }),
          cwd,
          env,
          fullAccess: false
        },
        deps: { connect: createAcpAgentConnection }
      })
      onTestFinished(async () => {
        await rig.adapter.closeSession(SESSION)
      })
      await rig.acquire()
      expect(rig.openFailure()).toBeUndefined()
      await expect(
        sendHello(rig, 'send-1', 1, {
          model: 'composer-2.5-fast',
          effort: 'xhigh',
          fastMode: 'true'
        })
      ).resolves.toMatchObject({ state: 'admitted' })
      await vi.waitFor(
        async () => {
          const rows = await rig.rig.rows()
          const turns = rows.flatMap((row) => readAgentJournalTurn(row.body) ?? [])
          expect(turns.at(-1)).toMatchObject({ state: 'completed', outcome: 'success' })
        },
        { timeout: 150_000, interval: 250 }
      )
      const options = await rig.adapter.readOptions({ sessionId: SESSION, fence: 1 })
      expect(options.current).toMatchObject({ model: 'composer-2.5', fastMode: true })
    },
    // Starts the real cursor-agent and waits on one model turn.
    180_000
  )
})
