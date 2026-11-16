import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createStructuredAgentSessionEventCoalescer } from '../../../shared/agent-session/structured-agent-session-coalescer'
import { EMPTY_STRUCTURED_AGENT_SESSION } from '../../../shared/agent-session/structured-agent-session-reducer'
import { reduceWithPromptSuggestion } from '../../../shared/structured-agent-session-prompt-suggestion-reducer'
import { createTrackedJournalOpener } from '../agent-session-journal/store-lifecycle/journal-host-database-test-support'
import { AgentSessionSubscribers } from './publication/subscribers/structured-agent-session-subscribers'
import { identityFor } from '../../claude/structured/claude-structured-session-test-support'
import type { AgentSessionSubscribeEvent } from '../../../shared/agent-session/agent-session-wire'

it('carries suggestions through idle checkpoints, coalescing, clearing and reconnect without journal rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-suggestions-'))
  const journals = createTrackedJournalOpener()
  let state = EMPTY_STRUCTURED_AGENT_SESSION
  const frames: AgentSessionSubscribeEvent[] = []
  const coalescer = createStructuredAgentSessionEventCoalescer((event) => {
    frames.push(event)
    state = reduceWithPromptSuggestion(state, { type: 'event', event })
  })
  // Deliveries queue per subscriber, so a frame lands after the call that caused it returns.
  const settled = (value: string | null | undefined) =>
    vi.waitFor(() => {
      coalescer.flush()
      expect(state.promptSuggestion).toBe(value)
    })
  try {
    const journal = await journals.open({ identity: identityFor(), stateDirectory: root })
    const sessionId = identityFor().sessionId
    const originalCursor = journal.cursor()
    let promptSuggestion: string | null = 'Add tests'
    const subscribers = new AgentSessionSubscribers({
      readPromptSuggestion: () => promptSuggestion
    })
    const close = subscribers.open({
      id: 'one',
      sessionId,
      journal,
      fence: 7,
      emit: coalescer.push
    })
    await settled('Add tests')
    promptSuggestion = 'Run tests'
    subscribers.publish(sessionId, journal)
    await settled('Run tests')
    promptSuggestion = null
    subscribers.publish(sessionId, journal)
    await settled(null)
    const count = frames.length
    // An unchanged suggestion owes no frame; the next change's frame follows it in order.
    subscribers.publish(sessionId, journal)
    promptSuggestion = 'Lint'
    subscribers.publish(sessionId, journal)
    await settled('Lint')
    expect(frames).toHaveLength(count + 1)
    close()
    promptSuggestion = 'Explain tests'
    subscribers.open({
      id: 'two',
      sessionId,
      journal,
      fence: 7,
      cursor: journal.cursor(),
      emit: coalescer.push
    })
    await settled('Explain tests')
    expect(state.items).toEqual([])
    expect(journal.cursor()).toEqual(originalCursor)
    // An older host's reset omits the field and must discard stale text.
    new AgentSessionSubscribers().open({
      id: 'old',
      sessionId,
      journal,
      fence: 7,
      emit: coalescer.push
    })
    await settled(undefined)
  } finally {
    coalescer.dispose()
    await journals.closeAll()
    await rm(root, { recursive: true, force: true })
  }
})
