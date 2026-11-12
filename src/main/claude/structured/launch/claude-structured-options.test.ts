import { ClaudeJournalBoundDelivery } from '../../claude-journal-bound-delivery'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionFastModeSupport } from '../../../../shared/agent-session/agent-session-wire'
import { setClaudeStructuredOption } from './claude-structured-options'
import {
  observeClaudeFastModeFacts,
  readClaudeStructuredSessionOptions
} from './claude-structured-session-options'
import type { ClaudeSession } from '../claude-structured-session-state'
import { ClaudeBackgroundTaskTracker } from '../../claude-background-task-tracker'
import { ClaudeChildWorkDecoder } from '../../claude-child-work-decoder'
import { ClaudeSlashCommandCatalog } from '../../claude-slash-command-catalog'
import { createClaudeInitProof } from '../claude-structured-init-proof'
import { createClaudeStartupOutcome } from '../claude-structured-startup-outcome'
import { claudeProviderHandleLink } from '../claude-structured-owner-identity'

vi.mock('@orca/process-host', () => ({ runProcess: vi.fn() }))

function sessionFor(setModel: ClaudeSession['connection']['setModel']): ClaudeSession {
  return {
    connection: {
      setModel,
      supportedModels: async (): Promise<unknown[]> => []
    } as ClaudeSession['connection'],
    providerSessionId: 'provider-session',
    leafUuid: null,
    turnEndLeafUuid: null,
    fence: 1,
    acquisitionGeneration: 'generation-1',
    prompts: {} as ClaudeSession['prompts'],
    dispatchWaiters: [],
    retiredDispatchWaiters: [],
    replayContentFallbackBlocked: false,
    delivery: new ClaudeJournalBoundDelivery(),
    backgroundTasks: new ClaudeBackgroundTaskTracker(),
    childWork: new ClaudeChildWorkDecoder(),
    commands: new ClaudeSlashCommandCatalog(),
    dispatchSequence: 0,
    optionMutationSequence: 0,
    options: new Map(),
    reportedOptions: {},
    reportedModelMutation: 0,
    confirmedOptions: new Set(),
    appliedInputOptions: new Map(),
    fastModeAtStart: false,
    capabilities: [],
    events: undefined,
    translator: null,
    link: claudeProviderHandleLink({
      sessionId: 'provider-session',
      leafUuid: null,
      resumed: false,
      fence: 1,
      observedAt: 1
    }),
    initialization: {
      proof: createClaudeInitProof(),
      account: undefined,
      resumesTranscript: false,
      claudeConfigDir: '/claude-home',
      cwd: '/work',
      history: { leafUuid: null, covered: true, contextActivity: 0 },
      onLateRefusal: () => {},
      startup: createClaudeStartupOutcome()
    }
  }
}

describe('Claude structured option mutation fencing', () => {
  it('does not let a delayed earlier apply overwrite a later option', async () => {
    let releaseFirst!: () => void
    const firstApply = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const setModel = vi
      .fn<ClaudeSession['connection']['setModel']>()
      .mockReturnValueOnce(firstApply)
      .mockResolvedValue(undefined)
    const session = sessionFor(setModel)

    const first = setClaudeStructuredOption(session, { key: 'model', value: 'old' }, undefined)
    await vi.waitFor(() => expect(setModel).toHaveBeenCalledTimes(1))
    const second = setClaudeStructuredOption(session, { key: 'model', value: 'new' }, undefined)
    await expect(second).resolves.toEqual({ model: 'new' })

    releaseFirst()
    await expect(first).resolves.toEqual({ model: 'new' })
    expect(session.options).toEqual(new Map([['model', 'new']]))
  })
})

function fastModeSession(supportsFastMode: boolean | undefined) {
  let reportedFastMode = false
  const applyFlagSettings = vi.fn(async (settings: { fastMode?: boolean }) => {
    if (typeof settings.fastMode === 'boolean') {
      reportedFastMode = settings.fastMode
    }
  })
  const session = sessionFor(vi.fn(async () => undefined))
  session.options.set('model', 'opus')
  session.fastModeState = 'off'
  session.fastModeAccountSupport = { supported: true, accountVerified: true }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the literal supplies every connection member this fixture's code paths call, and the spread carries the rest from sessionFor.
  session.connection = {
    ...session.connection,
    supportedModels: async () => [
      {
        value: 'opus',
        resolvedModel: 'claude-opus-current',
        displayName: 'Opus',
        ...(supportsFastMode === undefined ? {} : { supportsFastMode })
      }
    ],
    applyFlagSettings,
    getSettings: async () => ({ effective: { fastMode: reportedFastMode } }),
    getContextUsage: async () => ({})
  } as ClaudeSession['connection']
  return { session, applyFlagSettings }
}

describe('Claude structured Fast mode', () => {
  it('requires live availability before enabling but always permits turning Fast off', async () => {
    const { session, applyFlagSettings } = fastModeSession(true)
    session.fastModeAccountSupport = undefined
    await expect(readClaudeStructuredSessionOptions(session, undefined)).resolves.toMatchObject({
      fastModeSupport: { supported: false, reason: 'availability-unconfirmed' }
    })
    await expect(
      setClaudeStructuredOption(session, { key: 'fastMode', value: 'true' }, undefined)
    ).rejects.toThrow('availability has not been confirmed')
    expect(applyFlagSettings).not.toHaveBeenCalled()
    await expect(
      setClaudeStructuredOption(session, { key: 'fastMode', value: 'false' }, undefined)
    ).resolves.toMatchObject({ fastMode: 'false' })
  })

  it('never unlocks account-denied Fast from routing frames or a saved preference', async () => {
    const { session, applyFlagSettings } = fastModeSession(true)
    session.options.set('fastMode', 'true')
    session.readFastModeAccountSupport = vi.fn(async () => ({
      supported: false,
      reason: 'extra_usage_disabled'
    }))
    for (const state of ['off', 'on', 'cooldown']) {
      observeClaudeFastModeFacts(session, { fast_mode_state: state })
      await expect(readClaudeStructuredSessionOptions(session, undefined)).resolves.toMatchObject({
        fastModeSupport: { supported: false, reason: 'extra_usage_disabled' }
      })
      await expect(
        setClaudeStructuredOption(session, { key: 'fastMode', value: 'true' }, undefined)
      ).rejects.toThrow('extra_usage_disabled')
    }
    expect(applyFlagSettings).not.toHaveBeenCalled()
    const reads = vi.mocked(session.readFastModeAccountSupport).mock.calls.length
    await setClaudeStructuredOption(session, { key: 'fastMode', value: 'false' }, undefined)
    expect(session.readFastModeAccountSupport).toHaveBeenCalledTimes(reads)
    session.readFastModeAccountSupport = async () => ({ supported: true, accountVerified: true })
    await expect(
      setClaudeStructuredOption(session, { key: 'fastMode', value: 'true' }, undefined)
    ).resolves.toMatchObject({ fastMode: 'true' })
  })

  it('coalesces concurrent permission checks but retries after denial', async () => {
    const { session } = fastModeSession(true)
    let finish: (value: {
      supported: boolean
      reason?: string
      accountVerified?: boolean
    }) => void = () => {}
    session.readFastModeAccountSupport = vi.fn(
      () =>
        new Promise<AgentSessionFastModeSupport>((resolve) => {
          finish = resolve
        })
    )
    const first = readClaudeStructuredSessionOptions(session, undefined)
    const second = readClaudeStructuredSessionOptions(session, undefined)
    await vi.waitFor(() => expect(session.readFastModeAccountSupport).toHaveBeenCalledTimes(1))
    finish({ supported: false, reason: 'extra_usage_disabled' })
    for (const result of await Promise.all([first, second])) {
      expect(result.fastModeSupport).toMatchObject({
        supported: false,
        reason: 'extra_usage_disabled'
      })
    }
    session.readFastModeAccountSupport = async () => ({ supported: true, accountVerified: true })
    await expect(readClaudeStructuredSessionOptions(session, undefined)).resolves.toMatchObject({
      fastModeSupport: { supported: true }
    })
  })
})
