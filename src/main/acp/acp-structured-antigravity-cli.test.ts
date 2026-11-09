import { readFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'
import { agentChatPermissionModes } from '../../shared/agent-launch/permissions/agent-chat-permission-support'
import {
  closeProviderTimelineRigs,
  SESSION
} from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { antigravityCliLaunchSpec } from '../antigravity/antigravity-cli-acp-launch-spec'
import { ANTIGRAVITY_LAUNCH_SPEC } from '../antigravity/antigravity-acp-launch-spec'
import type { AcpScriptedAgent } from './process/testing/acp-scripted-agent.test-support'
import {
  openAcpAdapterRig,
  PROVIDER_SESSION,
  sendHello,
  waitFor
} from './session/testing/acp-structured-adapter.test-support'

const CLI = antigravityCliLaunchSpec(ANTIGRAVITY_LAUNCH_SPEC)
const optionSchema = z.looseObject({
  id: z.string(),
  currentValue: z.string(),
  options: z.array(z.looseObject({ value: z.string() }))
})
// Recorded from `agy acp` 1.5.1: initialize, session/new and the reply to a mode of 1.4.x.
const RECORDED = z
  .object({
    initialize: z.record(z.string(), z.unknown()),
    session: z.looseObject({
      modes: z.looseObject({ availableModes: z.array(z.looseObject({ id: z.string() })) }),
      configOptions: z.array(optionSchema)
    }),
    unknownMode: z.object({ code: z.number(), message: z.string() })
  })
  .parse(
    JSON.parse(
      readFileSync(
        new URL('./fixtures/antigravity-cli-v1.5.1-session.json', import.meta.url),
        'utf8'
      )
    )
  )
afterEach(closeProviderTimelineRigs)

function agy151(agent: AcpScriptedAgent): void {
  let configOptions = RECORDED.session.configOptions
  agent.on('session/new', (frame) =>
    agent.reply(frame, { ...RECORDED.session, sessionId: PROVIDER_SESSION })
  )
  agent.on('session/set_config_option', (frame) => {
    const { configId, value } = z
      .object({ configId: z.string(), value: z.string() })
      .parse(frame.params)
    if (
      !configOptions.some(
        (option) =>
          option.id === configId && option.options.some((choice) => choice.value === value)
      )
    ) {
      agent.fail(frame, RECORDED.unknownMode.code, RECORDED.unknownMode.message)
      return
    }
    configOptions = configOptions.map((option) =>
      option.id === configId ? { ...option, currentValue: value } : option
    )
    agent.reply(frame, { configOptions })
  })
}

async function openAgy(permissionMode: 'ask' | 'accept-edits' | 'full-access') {
  const rig = await openAcpAdapterRig({
    spec: CLI,
    initialize: RECORDED.initialize,
    script: agy151,
    launch: { fullAccess: permissionMode === 'full-access' }
  })
  await rig.acquire({ permissionMode })
  expect(rig.openFailure()).toBeUndefined()
  return rig
}

const modeSent = (rig: Awaited<ReturnType<typeof openAgy>>) =>
  rig.sent('session/set_config_option').map((frame) => frame.params)

const readOptions = (rig: Awaited<ReturnType<typeof openAgy>>) =>
  rig.adapter.readOptions({ sessionId: SESSION, fence: 1 })

it('offers only modes agy 1.5.1 accepts for every permission mode the chat shows', () => {
  const recorded = RECORDED.session.modes.availableModes.map((mode) => mode.id)
  const { values } = CLI.permissionModeConfig!
  for (const mode of agentChatPermissionModes('antigravity')!.modes) {
    expect(recorded).toContain(values[mode] ?? values.ask)
  }
})

it('asks in default mode and approves edits in accept-edits mode', async () => {
  for (const [mode, sent] of [
    ['ask', 'default'],
    ['accept-edits', 'accept-edits']
  ] as const) {
    const rig = await openAgy(mode)
    expect(modeSent(rig)).toEqual([expect.objectContaining({ configId: 'mode', value: sent })])
    expect((await readOptions(rig)).current.reportedPermissionMode).toBe(mode)
  }
})

it('runs Full access in default mode and answers tool approvals but not questions', async () => {
  const rig = await openAgy('full-access')
  expect(modeSent(rig)).toEqual([expect.objectContaining({ configId: 'mode', value: 'default' })])
  expect((await readOptions(rig)).current.reportedPermissionMode).toBe('full-access')
  await sendHello(rig, 'send-1')
  await rig.frame('session/prompt')
  const { agent } = rig.child()
  const options = [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    { optionId: 'reject', name: 'Reject', kind: 'reject_once' }
  ]
  const approval = await agent.request(3, 'session/request_permission', {
    sessionId: PROVIDER_SESSION,
    toolCall: { toolCallId: 'call-1', title: 'Run command' },
    options
  })
  expect(approval.result).toEqual({ outcome: { outcome: 'selected', optionId: 'allow' } })
  void agent.request(4, 'session/request_permission', {
    sessionId: PROVIDER_SESSION,
    toolCall: { toolCallId: 'interaction_1', title: 'Which color?' },
    options
  })
  await waitFor(async () =>
    expect((await rig.rig.rows()).some((row) => row.body.kind === 'question')).toBe(true)
  )
  expect(agent.frames.some((frame) => frame.id === 4 && !frame.method)).toBe(false)
})

it('lists the 1.5.1 models with their thinking levels', async () => {
  const rig = await openAgy('ask')
  const { models, current } = await readOptions(rig)
  expect(models.map((model) => model.id)).toEqual(
    RECORDED.session.configOptions
      .find((option) => option.id === 'model')!
      .options.map((option) => option.value)
  )
  expect(models[0]?.efforts.map((effort) => effort.value)).toEqual(['low', 'medium', 'high'])
  expect(current).toMatchObject({ model: 'gemini-4-argon', effort: 'medium' })
})
