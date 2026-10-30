import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { AgentSessionJournalIdentity } from '../../shared/agent-session-journal-types'
import { claudeProviderHandle } from '../../shared/agent-session-provider-handle-encoding'
import { claudeStartupSettled } from './claude-structured-startup-settled-test-support'
import { sessionInboxItemId, sessionInboxToolName } from '../../shared/session-inbox-tool-contract'
import { CLAUDE_STRUCTURED_BASE_OPTIONS } from './claude-structured-launch-resolution'
import {
  realClaudeAuthenticated,
  realClaudeAvailable,
  realClaudeCliGate,
  realClaudeCommand,
  realClaudeLaunchHome
} from './claude-real-cli-availability-test-support'
import { ClaudeStructuredSessionAdapter } from './claude-structured-session-adapter'
import type { ClaudeStructuredSessionEvent } from './structured/claude-structured-session-state'

const suiteTitle = `Claude inbox tools on the real CLI${realClaudeCliGate.skipReason ? ` (skipped: ${realClaudeCliGate.skipReason})` : ''}`
const SESSION_ID = 'real-cli-inbox'
const RECORD_FINDING = sessionInboxToolName('record_finding')
const TITLE = 'Inbox wiring proof'

function contentParts(message: Record<string, unknown>): Record<string, unknown>[] {
  const inner = message.message
  const content =
    inner && typeof inner === 'object' && 'content' in inner ? inner.content : undefined
  return Array.isArray(content)
    ? content.filter((part): part is Record<string, unknown> => !!part && typeof part === 'object')
    : []
}

function messages(events: readonly ClaudeStructuredSessionEvent[]): Record<string, unknown>[] {
  return events.flatMap((event) => (event.type === 'message' ? [event.message] : []))
}

describe.skipIf(!realClaudeAvailable)(suiteTitle, () => {
  // Unit tests cover the server's handlers; only the live binary proves the SDK serves them
  // through Orca's own spawn, loads them up front and runs them without a permission prompt.
  it.skipIf(!realClaudeAuthenticated)(
    'serves record_finding to a structured child and answers with the shared id',
    async () => {
      const providerSessionId = randomUUID()
      const home = realClaudeLaunchHome()
      const events: ClaudeStructuredSessionEvent[] = []
      const adapter = new ClaudeStructuredSessionAdapter({
        resolveLaunch: async () => ({
          pathToClaudeCodeExecutable: realClaudeCommand,
          options: { ...CLAUDE_STRUCTURED_BASE_OPTIONS, sessionId: providerSessionId },
          cwd: process.cwd(),
          env: home.env,
          claudeConfigDir: home.claudeConfigDir,
          providerSessionId,
          resumeLeafUuid: null,
          resumesTranscript: false,
          continuesChain: false,
          cliFlag: async () => 'supported' as const
        }),
        onEvent: (event) => events.push(event),
        readProcessStartTime: async () => 1,
        now: () => 2
      })
      const identity: AgentSessionJournalIdentity = {
        sessionId: SESSION_ID,
        workspaceId: 'real-cli-workspace',
        hostId: 'local',
        agent: 'claude',
        providerHandle: claudeProviderHandle(providerSessionId, null)
      }

      try {
        await adapter.acquire({ identity, fence: 1, spawnToken: 'real-cli-inbox' })
        await claudeStartupSettled(adapter, SESSION_ID)
        await adapter.setOption({ sessionId: SESSION_ID, key: 'model', value: 'haiku', fence: 1 })
        await adapter.dispatch({
          sessionId: SESSION_ID,
          clientMessageId: 'real-cli-inbox-1',
          body: {
            kind: 'message',
            role: 'user',
            blocks: [
              {
                type: 'text',
                text: `Call ${RECORD_FINDING} once with kind "issue", title "${TITLE}" and detail "Recorded by a test.", then reply with the single word done. Use no other tool.`
              }
            ]
          },
          fence: 1
        })
        const deadline = Date.now() + 90_000
        let result: Record<string, unknown> | undefined
        while (!result && Date.now() < deadline) {
          const toolUseIds = messages(events)
            .filter((message) => message.type === 'assistant')
            .flatMap(contentParts)
            .flatMap((part) =>
              part.type === 'tool_use' && part.name === RECORD_FINDING ? [part.id] : []
            )
          result = messages(events)
            .filter((message) => message.type === 'user')
            .flatMap(contentParts)
            .find((part) => part.type === 'tool_result' && toolUseIds.includes(part.tool_use_id))
          const finished = messages(events).find((message) => message.type === 'result')
          if (!result && finished) {
            throw new Error(
              `Claude ended without recording the finding: ${JSON.stringify({
                subtype: finished.subtype,
                errors: finished.errors,
                result: finished.result
              })}`
            )
          }
          await new Promise((settle) => setTimeout(settle, 250))
        }
        const init = messages(events).find(
          (message) => message.type === 'system' && message.subtype === 'init'
        )

        expect(init?.tools).toEqual(expect.arrayContaining([RECORD_FINDING]))
        expect(init?.mcp_servers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'orca_inbox', status: 'connected' })
          ])
        )
        expect(result?.is_error).not.toBe(true)
        expect(JSON.stringify(result?.content)).toContain(
          `Recorded finding ${sessionInboxItemId('finding', TITLE)}.`
        )
      } finally {
        await adapter.closeAll()
      }
    },
    120_000
  )
})
