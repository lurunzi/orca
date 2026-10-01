import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { ClaudeStructuredSessionAdapter } from './claude-structured-session-adapter'
import {
  loadClaudePromptSuggestionStore,
  type ClaudePromptSuggestionStore
} from './claude-prompt-suggestion-store'
import {
  adapterFor,
  fakeClaude,
  identityFor,
  PROVIDER_SESSION_ID,
  USER_MESSAGE
} from './claude-structured-session-test-support'

it('publishes only same-session suggestions after a successful result and clears on dispatch', async () => {
  const claude = fakeClaude()
  const adapter = adapterFor(claude)
  const publish = vi.fn()
  await adapter.acquire({
    identity: identityFor(),
    fence: 7,
    spawnToken: 'suggestion',
    events: {
      appendItem: vi.fn(),
      appendTombstone: vi.fn(),
      publish
    }
  })
  const message = (body: Record<string, unknown>): void => {
    claude.connections[0].handlers.onMessage?.({ session_id: PROVIDER_SESSION_ID, ...body })
  }
  const sessionId = identityFor().sessionId
  message({ type: 'prompt_suggestion', suggestion: 'too early' })
  expect(adapter.readPromptSuggestion(sessionId)).toBeNull()
  message({ type: 'result', is_error: false })
  publish.mockClear()
  message({ type: 'prompt_suggestion', suggestion: 'Add tests' })
  expect(adapter.readPromptSuggestion(sessionId)).toBe('Add tests')
  expect(publish).toHaveBeenCalledOnce()
  message({ type: 'prompt_suggestion', suggestion: 'Add tests' })
  message({ type: 'prompt_suggestion', suggestion: 123 })
  message({ type: 'prompt_suggestion', suggestion: 'foreign', session_id: 'other' })
  expect(publish).toHaveBeenCalledOnce()
  await adapter.dispatch({ sessionId, fence: 7, clientMessageId: 'next', body: USER_MESSAGE })
  expect(adapter.readPromptSuggestion(sessionId)).toBeNull()
  message({ type: 'prompt_suggestion', suggestion: 'late previous turn' })
  expect(adapter.readPromptSuggestion(sessionId)).toBeNull()
  message({ type: 'result', is_error: true })
  message({ type: 'prompt_suggestion', suggestion: 'after error' })
  expect(adapter.readPromptSuggestion(sessionId)).toBeNull()
  await adapter.closeSession(sessionId)
})

const LEAF = '0b7c5d3e-1f2a-4b6c-8d9e-0a1b2c3d4e5f'
const STALE_LEAF = '9f8e7d6c-5b4a-4321-8fed-cba987654321'

async function acquireWith(store: ClaudePromptSuggestionStore, resumeLeafUuid: string | null) {
  const claude = fakeClaude()
  const adapter = new ClaudeStructuredSessionAdapter({
    resolveLaunch: async () => ({
      pathToClaudeCodeExecutable: 'claude',
      options: {},
      cwd: '/work/repo',
      claudeConfigDir: '/accounts/claude',
      providerSessionId: PROVIDER_SESSION_ID,
      resumeLeafUuid,
      resumesTranscript: resumeLeafUuid !== null,
      continuesChain: resumeLeafUuid !== null
    }),
    openConnection: claude.openConnection,
    readProcessStartTime: async () => 1_700_000_000_000,
    now: () => 1_700_000_000_500,
    persistHandle: async () => {},
    promptSuggestionStore: store
  })
  await adapter.acquire({
    identity: identityFor(),
    fence: 7,
    spawnToken: `suggestion-${resumeLeafUuid}`,
    events: { appendItem: vi.fn(), appendTombstone: vi.fn(), publish: vi.fn() }
  })
  await adapter.awaitStarted(identityFor().sessionId)
  const message = (body: Record<string, unknown>): void => {
    claude.connections[0].handlers.onMessage?.({ session_id: PROVIDER_SESSION_ID, ...body })
  }
  return { adapter, message }
}

it('restores the last suggestion after a restart until the next turn starts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orca-claude-suggestion-'))
  const sessionId = identityFor().sessionId
  try {
    const firstRun = await loadClaudePromptSuggestionStore(directory)
    const first = await acquireWith(firstRun, null)
    first.message({
      type: 'assistant',
      uuid: LEAF,
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }
    })
    first.message({ type: 'result', is_error: false })
    first.message({ type: 'prompt_suggestion', suggestion: 'Add tests' })
    expect(first.adapter.readPromptSuggestion(sessionId)).toBe('Add tests')
    await first.adapter.closeSession(sessionId)
    await firstRun.flush()

    const restarted = await loadClaudePromptSuggestionStore(directory)
    const stale = await acquireWith(restarted, STALE_LEAF)
    expect(stale.adapter.readPromptSuggestion(sessionId)).toBeNull()
    await stale.adapter.closeSession(sessionId)
    const resumed = await acquireWith(restarted, LEAF)
    expect(resumed.adapter.readPromptSuggestion(sessionId)).toBe('Add tests')
    await resumed.adapter.dispatch({
      sessionId,
      fence: 7,
      clientMessageId: 'next',
      body: USER_MESSAGE
    })
    expect(resumed.adapter.readPromptSuggestion(sessionId)).toBeNull()
    await resumed.adapter.closeSession(sessionId)
    await restarted.flush()

    const again = await acquireWith(await loadClaudePromptSuggestionStore(directory), LEAF)
    expect(again.adapter.readPromptSuggestion(sessionId)).toBeNull()
    await again.adapter.closeSession(sessionId)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
