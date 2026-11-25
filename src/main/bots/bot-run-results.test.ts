import { describe, expect, it } from 'vitest'
import type { AutomationRun } from '../../shared/automations/history/automation-run'
import { normalizeLoadedAutomationRuns } from '../persistence/loading-store/profile-loading/normalize-loaded-state-collections'
import { getDefaultPersistedState } from '../../shared/orca-profiles/constants'
import { makeTestBot } from './bot.test-fixture'
import {
  deliverBotRunResult,
  type BotRunDeliveryDependencies,
  type BotRunResult
} from './bot-run-results'

const NOTICE =
  "This run's message was answered together with another message, so its result wasn't posted."

const notReached = (): never => {
  throw new Error('A run answered together with another message delivers nothing.')
}

const DELIVERY: BotRunDeliveryDependencies = {
  notify: notReached,
  noteToChat: notReached,
  sendToChat: notReached,
  postAsBot: notReached,
  cloudSignedOut: notReached,
  noteToRun: notReached,
  replyInThread: notReached,
  turnForOf: notReached
}

describe('a run answered together with another message', () => {
  it('completes: its prompt was handled in the turn that answered it', async () => {
    const result: BotRunResult = {
      automation: { id: 'a1', name: 'Triage', dtstart: 1 },
      run: { id: 'r1', trigger: 'event' },
      bot: makeTestBot(),
      target: { runsIn: 'new', resultsTo: 'chat' },
      sessionId: 's1',
      ended: { unavailable: 'shared' }
    }
    const completion = await deliverBotRunResult(DELIVERY, result)
    expect(completion).toEqual({ status: 'completed', outputSnapshot: null, error: NOTICE })
  })

  it('reads as completed when an older build stored it as failed', () => {
    const run: AutomationRun = {
      id: 'r1',
      automationId: 'a1',
      title: 'Triage',
      runNumber: 25,
      status: 'dispatch_failed',
      trigger: 'event',
      workspaceId: null,
      sessionKind: 'chat',
      chatSessionId: null,
      terminalSessionId: null,
      terminalPaneKey: null,
      terminalPtyId: null,
      outputSnapshot: null,
      precheckResult: null,
      usage: null,
      error: NOTICE,
      startedAt: null,
      dispatchedAt: null,
      createdAt: 1,
      scheduledFor: 1
    }
    const other = { ...run, id: 'r2', runNumber: 26, error: 'Could not start.' }
    let saved = false
    const runs = normalizeLoadedAutomationRuns(
      { ...getDefaultPersistedState('/home/test'), automationRuns: [run, other] },
      () => (saved = true)
    )
    expect(runs.map((r) => r.status)).toEqual(['completed', 'dispatch_failed'])
    expect(saved).toBe(true)
  })
})
