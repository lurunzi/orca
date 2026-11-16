import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'
import { closeProviderTimelineRigs } from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { acpLaunchSpecFor } from './launch/acp-launch-registry'
import {
  openAcpAdapterRig,
  PROVIDER_SESSION,
  sendHello
} from './session/testing/acp-structured-adapter.test-support'
import type { AcpScriptedAgent, FakeFrame } from './process/testing/acp-scripted-agent.test-support'

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
