import { afterEach, expect, it } from 'vitest'
import { closeProviderTimelineRigs } from '../../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { acpLaunchSpecFor } from '../launch/acp-launch-registry'
import { acpHostBackendSpec } from '../launch/acp-launch-command'
import {
  openAcpAdapterRig,
  PROVIDER_SESSION,
  sendHello,
  waitFor
} from './testing/acp-structured-adapter.test-support'

const ANTIGRAVITY = acpLaunchSpecFor('antigravity')!
afterEach(closeProviderTimelineRigs)

it("lets Orca answer a default Full access host chat's tool approvals, but not its plan", async () => {
  const spec = acpHostBackendSpec(ANTIGRAVITY.hostBackend!, {})
  expect(spec.args({ fullAccess: true, pluginDirs: [] })).toEqual(['acp'])
  let tool: unknown = null
  let planAnswered = false
  const rig = await openAcpAdapterRig({
    spec,
    launch: { args: ['acp'], fullAccess: true },
    script: (agent) =>
      agent.on('session/prompt', () => {
        void agent
          .request('tool', 'session/request_permission', {
            sessionId: PROVIDER_SESSION,
            toolCall: { toolCallId: 'tool-1', title: 'Run ls', kind: 'execute' },
            options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }]
          })
          .then((reply) => {
            tool = reply
          })
        void agent
          .request('plan', 'session/request_permission', {
            sessionId: PROVIDER_SESSION,
            toolCall: { toolCallId: 'plan-1', title: 'Approve plan', kind: 'switch_mode' },
            options: [{ optionId: 'proceed', name: 'Proceed', kind: 'allow_once' }]
          })
          .then(() => {
            planAnswered = true
          })
      })
  })
  await rig.acquire({ permissionMode: 'full-access' })
  await sendHello(rig, 'send-1')
  await waitFor(() =>
    expect(tool).toMatchObject({ result: { outcome: { outcome: 'selected', optionId: 'allow' } } })
  )
  await waitFor(async () =>
    expect((await rig.rig.rows()).some((row) => row.body.kind === 'approval')).toBe(true)
  )
  expect(planAnswered).toBe(false)
})
