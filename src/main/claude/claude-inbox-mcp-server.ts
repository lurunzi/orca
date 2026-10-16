// The session inbox's tools, served to a structured Claude child from this process. The server
// keeps no state: the journaled tool calls are the record, and every reader projects the inbox
// from them, so a resumed or remote conversation needs nothing besides its journal.

import type * as ClaudeAgentSdk from '@anthropic-ai/claude-agent-sdk'
import type { Options as ClaudeAgentSdkOptions } from '@anthropic-ai/claude-agent-sdk'
import {
  SESSION_INBOX_CLOSE_DESCRIPTION,
  SESSION_INBOX_FINDING_DESCRIPTION,
  SESSION_INBOX_GUIDANCE,
  SESSION_INBOX_MCP_SERVER,
  SESSION_INBOX_QUESTION_DESCRIPTION,
  SESSION_INBOX_TOOLS,
  closeToolFields,
  isSessionInboxItemId,
  recordFindingToolFields,
  recordQuestionToolFields,
  sessionInboxItemId
} from '../../shared/session-inbox-tool-contract'

type ClaudeInboxSdk = Pick<typeof ClaudeAgentSdk, 'createSdkMcpServer' | 'tool'>

type ClaudeInboxSdkOptions = Required<Pick<ClaudeAgentSdkOptions, 'mcpServers'>>

// Recording an item touches nothing in the workspace, so plan mode and its peers may run it.
const READ_ONLY = { annotations: { readOnlyHint: true } }

function reply(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) }
}

/**
 * Options that give one Claude child the inbox tools, merged over the launch's own. A server
 * instance serves one connection, so every child gets its own. The tools load up front; the
 * permission callback allows them (bare allowedTools entries would shadow that callback).
 */
export function withClaudeInboxSdkOptions(
  sdk: ClaudeInboxSdk,
  options: Pick<ClaudeAgentSdkOptions, 'mcpServers'>
): ClaudeInboxSdkOptions {
  const server = sdk.createSdkMcpServer({
    name: SESSION_INBOX_MCP_SERVER,
    version: '1.0.0',
    instructions: SESSION_INBOX_GUIDANCE,
    alwaysLoad: true,
    tools: [
      sdk.tool(
        SESSION_INBOX_TOOLS.recordFinding,
        SESSION_INBOX_FINDING_DESCRIPTION,
        recordFindingToolFields,
        async ({ title }) =>
          reply(
            `Recorded finding ${sessionInboxItemId('finding', title)}. It waits in the user's Inbox until you or the user close it.`
          ),
        READ_ONLY
      ),
      sdk.tool(
        SESSION_INBOX_TOOLS.recordQuestion,
        SESSION_INBOX_QUESTION_DESCRIPTION,
        recordQuestionToolFields,
        async ({ question }) =>
          reply(
            `Recorded question ${sessionInboxItemId('question', question)}. It waits in the user's Inbox until it is answered or closed.`
          ),
        READ_ONLY
      ),
      sdk.tool(
        SESSION_INBOX_TOOLS.close,
        SESSION_INBOX_CLOSE_DESCRIPTION,
        closeToolFields,
        async ({ id }) =>
          isSessionInboxItemId(id)
            ? reply(`Closed ${id}.`)
            : reply(
                `No inbox item has the id "${id}". Use the id a record call returned, such as q0k3x9a2 or f1b2c3d4.`,
                true
              ),
        READ_ONLY
      )
    ]
  })
  return {
    mcpServers: { ...options.mcpServers, [SESSION_INBOX_MCP_SERVER]: server }
  }
}
