import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentHookServer, _internals } from './server'
import { buildBody, PANE, postHookEvent } from './server.test-fixtures'
import type { AgentProviderSessionMetadata } from '../../shared/agent-session-resume'

vi.mock('../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

beforeEach(() => _internals.resetCachesForTests())
afterEach(() => vi.restoreAllMocks())

const parentSession: AgentProviderSessionMetadata = {
  key: 'conversation_id',
  id: 'cursor-parent',
  transcriptPath: '/cursor/agent-transcripts/cursor-parent.jsonl'
}
const childSession: AgentProviderSessionMetadata = {
  key: 'session_id',
  id: 'codex-child',
  transcriptPath: '/codex/sessions/codex-child.jsonl'
}

describe('nested hooks preserve the parent transcript identity', () => {
  it.each([true, false])('local Cursor parent has session metadata: %s', async (hasSession) => {
    const server = new AgentHookServer()
    await server.start({ env: 'production' })
    try {
      const listener = vi.fn()
      server.setListener(listener)
      const parent = await postHookEvent(
        server,
        buildBody({
          hook_event_name: 'beforeSubmitPrompt',
          ...(hasSession
            ? { conversation_id: parentSession.id, transcript_path: parentSession.transcriptPath }
            : {}),
          model: 'parent-model',
          prompt: 'Review Claude progress'
        }),
        '/hook/cursor'
      )
      expect(parent.status).toBe(204)
      const original = server.getStatusSnapshot()[0]
      expect(original.agentType).toBe('cursor')
      expect(original.providerSession?.id).toBe(hasSession ? parentSession.id : undefined)

      for (const hookEvent of ['UserPromptSubmit', 'PreToolUse']) {
        const child = await postHookEvent(
          server,
          buildBody({
            hook_event_name: hookEvent,
            session_id: childSession.id,
            transcript_path: childSession.transcriptPath,
            model: 'child-model',
            prompt: 'Nested review',
            tool_name: 'Bash'
          }),
          '/hook/codex'
        )
        expect(child.status).toBe(204)
        const current = server.getStatusSnapshot()[0]
        expect(current.agentType).toBe('cursor')
        expect(current.providerSession).toEqual(original.providerSession)
        expect(current.model).toBe(original.model)
        expect(listener).toHaveBeenLastCalledWith(
          expect.objectContaining({ providerSession: original.providerSession })
        )
      }
    } finally {
      server.stop()
    }
  })

  it.each([true, false])('remote Cursor parent has session metadata: %s', (hasSession) => {
    const server = new AgentHookServer()
    try {
      server.ingestRemote(
        {
          paneKey: PANE,
          ...(hasSession ? { providerSession: parentSession } : {}),
          payload: { state: 'working', prompt: 'Parent review', agentType: 'cursor' }
        },
        'remote-host'
      )
      server.ingestRemote(
        {
          paneKey: PANE,
          providerSession: childSession,
          payload: {
            state: 'working',
            prompt: 'Nested review',
            agentType: 'codex',
            model: 'child-model'
          }
        },
        'remote-host'
      )
      const current = server.getStatusSnapshot()[0]
      expect(current.agentType).toBe('cursor')
      expect(current.providerSession).toEqual(hasSession ? parentSession : undefined)
      expect(current.model).toBeUndefined()
    } finally {
      server.stop()
    }
  })

  it('accepts a new agent session after the parent finishes', () => {
    const server = new AgentHookServer()
    try {
      server.ingestRemote(
        {
          paneKey: PANE,
          providerSession: parentSession,
          payload: { state: 'done', prompt: 'Parent review', agentType: 'cursor' }
        },
        'remote-host'
      )
      server.ingestRemote(
        {
          paneKey: PANE,
          providerSession: childSession,
          payload: { state: 'working', prompt: 'New review', agentType: 'codex' }
        },
        'remote-host'
      )
      expect(server.getStatusSnapshot()[0]).toMatchObject({
        agentType: 'codex',
        providerSession: childSession
      })
    } finally {
      server.stop()
    }
  })
})
