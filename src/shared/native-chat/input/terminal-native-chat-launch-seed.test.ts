import { describe, expect, it } from 'vitest'
import {
  resolveAgentLaunchCommand,
  terminalSessionOptionInputs
} from '../../tui-agent-launch-command'
import { resolveAgentStartupPlanInputs } from '../../agent-startup-plan-inputs'
import { tokenizeStartupCommand } from '../../tui-agent-startup-shell'
import {
  rememberedNativeChatLaunchChoices,
  rememberedNativeChatLaunchSessionOptions,
  rememberedNativeChatModelStillListed
} from './terminal-native-chat-launch-seed'

describe('rememberedNativeChatModelStillListed', () => {
  it('requires discovery membership when a discovered list is present', () => {
    expect(
      rememberedNativeChatModelStillListed({
        agent: 'cursor',
        modelId: 'gpt-5.3-codex',
        discoveredModelIds: ['auto', 'claude-opus-4-8']
      })
    ).toBe(false)
    expect(
      rememberedNativeChatModelStillListed({
        agent: 'cursor',
        modelId: 'claude-opus-4-8',
        discoveredModelIds: ['auto', 'claude-opus-4-8']
      })
    ).toBe(true)
  })

  it('allows a catalog seed before discovery returns', () => {
    expect(
      rememberedNativeChatModelStillListed({
        agent: 'cursor',
        modelId: 'gpt-5.3-codex'
      })
    ).toBe(true)
  })
})

describe('terminal native chat launch seed', () => {
  const settings = {
    nativeChatSessionOptions: {
      cursor: {
        model: 'gpt-5.3-codex',
        valuesByModel: {
          'gpt-5.3-codex': { effort: 'medium', fastMode: true }
        }
      }
    },
    agentLaunchChoices: {}
  } as const

  it('builds session options from the saved cursor pick', () => {
    expect(rememberedNativeChatLaunchSessionOptions(settings, 'cursor')).toEqual({
      model: 'gpt-5.3-codex',
      effort: 'medium',
      fastMode: true
    })
  })

  it('yields to explicit launch argv and agentLaunchChoices', () => {
    const shell = 'posix' as const
    const fromRemembered = terminalSessionOptionInputs({
      agent: 'cursor',
      settings,
      sessionOptions: undefined,
      rememberedChoices: rememberedNativeChatLaunchChoices(settings, 'cursor'),
      agentArgs: undefined,
      shell
    })
    const explicitModel = terminalSessionOptionInputs({
      agent: 'cursor',
      settings,
      sessionOptions: undefined,
      rememberedChoices: rememberedNativeChatLaunchChoices(settings, 'cursor'),
      agentArgs: '--model auto',
      shell
    })
    expect(fromRemembered.sessionOptions?.model).toBe('gpt-5.3-codex')
    expect(explicitModel.sessionOptions).toBeUndefined()

    const authored = terminalSessionOptionInputs({
      agent: 'cursor',
      settings: {
        ...settings,
        agentLaunchChoices: { cursor: { model: 'auto' } }
      },
      sessionOptions: undefined,
      rememberedChoices: rememberedNativeChatLaunchChoices(settings, 'cursor'),
      agentArgs: undefined,
      shell
    })
    expect(authored.sessionOptions?.model).toBe('auto')
  })

  it('emits composed --model argv for a new terminal chat launch', () => {
    const shell = 'posix' as const
    const inputs = resolveAgentStartupPlanInputs({
      agent: 'cursor',
      settings,
      platform: 'linux',
      isRemote: false,
      shell: undefined,
      rememberedNativeChatTerminalLaunch: {}
    })
    const result = resolveAgentLaunchCommand({
      agent: 'cursor',
      cmdOverrides: {},
      platform: 'linux',
      shell,
      agentArgs: inputs.agentArgs,
      sessionOptions: inputs.sessionOptions,
      sessionOptionsOverrideAgentArgs: inputs.sessionOptionsOverrideAgentArgs
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(tokenizeStartupCommand(result.command, shell)).toMatchObject({
      ok: true,
      tokens: ['cursor-agent', '--yolo', '--model', 'gpt-5.3-codex-medium-fast']
    })
  })

  it('does not seed when the remembered model left the discovered list', () => {
    expect(rememberedNativeChatLaunchSessionOptions(settings, 'cursor', ['auto'])).toBeUndefined()
    const inputs = resolveAgentStartupPlanInputs({
      agent: 'cursor',
      settings,
      platform: 'linux',
      isRemote: false,
      shell: undefined,
      rememberedNativeChatTerminalLaunch: { discoveredModelIds: ['auto'] }
    })
    expect(inputs.sessionOptions).toBeUndefined()
  })

  it('seeds Antigravity only from a model its account discovery listed', () => {
    const antigravity = {
      nativeChatSessionOptions: { antigravity: { model: 'gemini-4-argon', valuesByModel: {} } },
      agentLaunchChoices: {}
    }
    const launch = (discoveredModelIds: string[] | null) =>
      resolveAgentStartupPlanInputs({
        agent: 'antigravity',
        settings: antigravity,
        platform: 'win32',
        isRemote: false,
        shell: undefined,
        rememberedNativeChatTerminalLaunch: { discoveredModelIds }
      }).sessionOptions
    expect(launch(['gemini-3.8-flash', 'gemini-4-argon'])).toEqual({ model: 'gemini-4-argon' })
    expect(launch(null)).toBeUndefined()
    expect(launch(['gemini-3.8-flash'])).toBeUndefined()
  })
})
