import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'
import {
  closeProviderTimelineRigs,
  SESSION
} from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { acpLaunchSpecFor } from './acp-launch-specs'
import {
  openAcpAdapterRig,
  PROVIDER_SESSION,
  sendHello,
  waitFor
} from './acp-structured-adapter.test-support'
import type { AcpScriptedAgent, FakeFrame } from './acp-scripted-agent.test-support'

const CURSOR = acpLaunchSpecFor('cursor')!
afterEach(closeProviderTimelineRigs)

const select = (id: string, category: string, currentValue: string, values: string[]) => ({
  id,
  name: id,
  category,
  type: 'select',
  currentValue,
  options: values.map((value) => ({ value, name: value }))
})

// Recorded from cursor-agent 2026.11.05 with clientCapabilities._meta.parameterizedModelPicker.
const CONFIG_OPTIONS = [
  select('mode', 'mode', 'agent', ['agent', 'plan', 'ask']),
  select('model', 'model', 'claude-opus-5', ['default', 'composer-2.5', 'claude-opus-5']),
  select('thinking', 'thought_level', 'true', ['false', 'true']),
  select('context', 'model_config', '300k', ['300k', '1m']),
  select('effort', 'thought_level', 'high', ['low', 'medium', 'high', 'xhigh', 'max']),
  select('fast', 'model_config', 'false', ['false', 'true'])
]

function scriptCursor(agent: AcpScriptedAgent, onPrompt: (frame: FakeFrame) => Promise<void>) {
  agent.on('session/new', (frame) =>
    agent.reply(frame, { sessionId: PROVIDER_SESSION, configOptions: CONFIG_OPTIONS })
  )
  let configOptions = CONFIG_OPTIONS
  agent.on('session/set_config_option', (frame) => {
    const { configId, value } = z
      .object({ configId: z.string(), value: z.string() })
      .parse(frame.params)
    configOptions = configOptions.map((option) =>
      option.id === configId ? { ...option, currentValue: value } : option
    )
    if (configId === 'model' && value === 'composer-2.5') {
      // Recorded: Composer reports only Fast, no thinking, context or effort.
      configOptions = configOptions.filter((option) =>
        ['mode', 'model', 'fast'].includes(option.id)
      )
    }
    agent.reply(frame, { configOptions })
  })
  agent.on('session/prompt', (frame) => {
    void onPrompt(frame).then(() => agent.reply(frame, { stopReason: 'end_turn' }))
  })
}

async function promptRow(rig: Awaited<ReturnType<typeof openAcpAdapterRig>>, kind: string) {
  return waitFor(async () => {
    const found = (await rig.rig.rows()).find((row) => row.body.kind === kind)
    expect(found).toBeDefined()
    return found!
  })
}

it('opts into the parameterized picker, reads effort rather than thinking, and drives Fast', async () => {
  const rig = await openAcpAdapterRig({
    spec: CURSOR,
    script: (agent) => scriptCursor(agent, async () => {})
  })
  await rig.acquire()
  const initialize = rig.sent('initialize')[0]?.params
  expect(initialize).toMatchObject({
    clientCapabilities: { _meta: { parameterizedModelPicker: true } }
  })
  const options = await rig.adapter.readOptions({ sessionId: SESSION, fence: 1 })
  expect(options.current).toMatchObject({ model: 'claude-opus-5', effort: 'high' })
  expect(options.models.map((model) => model.id)).toEqual([
    'default',
    'composer-2.5',
    'claude-opus-5'
  ])
  expect(options.models.find((model) => model.id === 'claude-opus-5')).toMatchObject({
    supportsFastMode: true,
    efforts: expect.arrayContaining([{ value: 'max', label: 'max' }])
  })
  expect(options.current).toMatchObject({ fastMode: false })
  const reported = await rig.adapter.setOption({
    sessionId: SESSION,
    fence: 1,
    key: 'fastMode',
    value: 'true'
  })
  expect(rig.sent('session/set_config_option').at(-1)?.params).toMatchObject({
    configId: 'fast',
    value: 'true'
  })
  expect(reported).toMatchObject({ model: 'claude-opus-5', effort: 'high', fastMode: 'true' })
})

it('maps a CLI variant id such as composer-2.5-fast to its listed model and Fast, skipping a saved effort Composer lacks', async () => {
  const rig = await openAcpAdapterRig({
    spec: CURSOR,
    script: (agent) => scriptCursor(agent, async () => {})
  })
  await rig.acquire()
  await expect(
    sendHello(rig, 'send-1', 1, { model: 'composer-2.5-fast', effort: 'xhigh' })
  ).resolves.toMatchObject({
    state: 'admitted'
  })
  expect(rig.sent('session/set_config_option').map((frame) => frame.params)).toMatchObject([
    { configId: 'model', value: 'composer-2.5' },
    { configId: 'fast', value: 'true' }
  ])
})

it('answers a sessionless cursor/ask_question with the chosen option ids', async () => {
  let reply: Promise<FakeFrame> | undefined
  const rig = await openAcpAdapterRig({
    spec: CURSOR,
    script: (agent) =>
      scriptCursor(agent, async () => {
        reply = agent.request(7, 'cursor/ask_question', {
          toolCallId: 'tool-ask',
          title: 'Pick one',
          questions: [
            {
              id: 'q1',
              prompt: 'Which?',
              options: [
                { id: 'a', label: 'A' },
                { id: 'b', label: 'B' }
              ]
            }
          ]
        })
        await reply
      })
  })
  await rig.acquire()
  await sendHello(rig, 'send-1')
  const question = await promptRow(rig, 'question')
  expect(question.body).toMatchObject({ question: 'Pick one', questions: [{ id: 'q1' }] })
  await rig.adapter.answerPrompt({
    sessionId: SESSION,
    itemId: question.itemId,
    kind: 'question',
    response: { kind: 'answers', answers: [{ questionId: 'q1', optionIds: ['b'] }] },
    fence: 1,
    commit: async () => {}
  })
  expect((await reply)?.result).toEqual({
    outcome: { outcome: 'answered', answers: [{ questionId: 'q1', selectedOptionIds: ['b'] }] }
  })
})

it('acknowledges task reports silently and shows create_plan as a plan approval', async () => {
  const replies: Promise<FakeFrame>[] = []
  const rig = await openAcpAdapterRig({
    spec: CURSOR,
    script: (agent) =>
      scriptCursor(agent, async () => {
        const task = { toolCallId: 't', description: '', prompt: '', subagentType: 'explore' }
        replies.push(agent.request(8, 'cursor/task', task))
        await replies[0]
        replies.push(
          agent.request(9, 'cursor/create_plan', {
            toolCallId: 'tool-plan',
            name: 'Ship it',
            overview: 'Two steps',
            plan: '1. Build\n2. Test',
            todos: []
          })
        )
        await replies[1]
      })
  })
  await rig.acquire()
  await sendHello(rig, 'send-1')
  const approval = await promptRow(rig, 'approval')
  expect((await replies[0])?.result).toEqual({})
  expect(approval.body).toMatchObject({
    title: 'Ship it',
    description: 'Two steps',
    subject: { kind: 'plan', text: '1. Build\n2. Test' }
  })
  await rig.adapter.answerPrompt({
    sessionId: SESSION,
    itemId: approval.itemId,
    kind: 'approval',
    response: { kind: 'option', optionId: 'accept' },
    fence: 1,
    commit: async () => {}
  })
  expect((await replies[1])?.result).toEqual({ outcome: { outcome: 'accepted' } })
})
