import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_INBOX_GUIDANCE,
  sessionInboxItemId
} from '../../shared/session-inbox-tool-contract'
import { withClaudeInboxSdkOptions } from './claude-inbox-mcp-server'
import { ClaudePromptRegistry } from './structured/permissions/claude-prompt-registry'
import { buildClaudePermissionCallbacks } from './structured/permissions/claude-structured-inbound-control'

type ServerOptions = Parameters<typeof createSdkMcpServer>[0]

/** The real SDK, with the server options it was handed kept so handlers can be called directly. */
function capturingSdk() {
  const servers: ServerOptions[] = []
  return {
    servers,
    sdk: {
      tool,
      createSdkMcpServer: (options: ServerOptions) => {
        servers.push(options)
        return createSdkMcpServer(options)
      }
    }
  }
}

function handlerOf(servers: ServerOptions[], name: string) {
  const found = servers[0]?.tools?.find((candidate) => candidate.name === name)
  if (!found) {
    throw new Error(`no ${name} tool`)
  }
  return (args: Record<string, unknown>) => found.handler(args, {})
}

describe('withClaudeInboxSdkOptions', () => {
  it('serves the inbox tools up front, with the guidance as instructions', () => {
    const { sdk, servers } = capturingSdk()
    const options = withClaudeInboxSdkOptions(sdk, {})

    expect(options.mcpServers.orca_inbox).toMatchObject({ type: 'sdk', name: 'orca_inbox' })
    // No allowedTools: bare entries would shadow the permission callback, which allows these itself.
    expect(options).not.toHaveProperty('allowedTools')
    expect(servers[0]?.instructions).toBe(SESSION_INBOX_GUIDANCE)
    expect(servers[0]?.alwaysLoad).toBe(true)
    expect(servers[0]?.tools?.map((entry) => entry.annotations)).toEqual([
      { readOnlyHint: true },
      { readOnlyHint: true },
      { readOnlyHint: true }
    ])
  })

  it('keeps servers the launch already named', () => {
    const { sdk } = capturingSdk()
    const options = withClaudeInboxSdkOptions(sdk, {
      mcpServers: { docs: { type: 'http', url: 'https://example.test/mcp' } }
    })

    expect(Object.keys(options.mcpServers)).toEqual(['docs', 'orca_inbox'])
  })

  it('answers each record with the id every journal reader derives from the same text', async () => {
    const { sdk, servers } = capturingSdk()
    withClaudeInboxSdkOptions(sdk, {})

    const finding = await handlerOf(
      servers,
      'record_finding'
    )({
      kind: 'issue',
      title: 'Retry loop never gives up',
      detail: 'It spins forever on a 401.'
    })
    const question = await handlerOf(
      servers,
      'record_question'
    )({
      question: 'Ship the migration today?'
    })

    expect(finding).toEqual({
      content: [
        {
          type: 'text',
          text: `Recorded finding ${sessionInboxItemId('finding', 'Retry loop never gives up')}. It waits in the user's Inbox until you or the user close it.`
        }
      ]
    })
    expect(JSON.stringify(question)).toContain(
      sessionInboxItemId('question', 'Ship the migration today?')
    )
  })

  it('refuses to close an id no record call could have returned', async () => {
    const { sdk, servers } = capturingSdk()
    withClaudeInboxSdkOptions(sdk, {})
    const close = handlerOf(servers, 'close')

    expect(await close({ id: 'i35' })).toMatchObject({ isError: true })
    expect(await close({ id: 'f00k3x9a' })).toEqual({
      content: [{ type: 'text', text: 'Closed f00k3x9a.' }]
    })
  })
})

describe('Claude permission callbacks for the inbox tools', () => {
  it('allows the inbox tools without a prompt, since they only record into the journal', async () => {
    const prompts = new ClaudePromptRegistry()
    const emit = vi.fn()
    const { canUseTool } = buildClaudePermissionCallbacks({
      sessionId: 'session-1',
      prompts,
      emit,
      fullAccessAt: () => false
    })
    const input = { kind: 'issue', title: 'Retry loop never gives up', detail: 'It spins.' }

    await expect(
      canUseTool('mcp__orca_inbox__record_finding', input, {
        requestId: 'perm-inbox',
        toolUseID: 'tool-inbox',
        signal: new AbortController().signal
      })
    ).resolves.toEqual({ behavior: 'allow', updatedInput: input, toolUseID: 'tool-inbox' })
    expect(emit).not.toHaveBeenCalled()
    expect(prompts.find('perm-inbox')).toBeNull()
  })
})
