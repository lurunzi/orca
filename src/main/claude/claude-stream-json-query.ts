import { openPairedClaudeSession } from '../dashboard-accounts/paired-claude-session'
import { withOrcaClaudeChatEntrypoint } from '../../shared/agent-launch/startup/claude-chat-entrypoint'
import { claudeStartupAnswerObservation } from './child-process/claude-startup-answer-observation'
import { claudeStreamJsonChildEnv } from './claude-stream-json-child-env'
import { createClaudeCodeProcessSpawn } from './child-process/claude-agent-sdk-process-spawn'
import { withClaudeInboxSdkOptions } from './claude-inbox-mcp-server'
import { createClaudeUserMessageQueue } from './sdk-transport/claude-agent-sdk-user-message-queue'
import type { ProviderProcessSpawner } from '../provider-process/provider-process-spawn'
import type * as ClaudeAgentSdk from '@anthropic-ai/claude-agent-sdk'
import type {
  ClaudeStreamJsonLaunch,
  ClaudeStreamJsonConnectionHandlers
} from './claude-stream-json-connection'

/** Lazy import confines SDK executable-search env mutation and missing-package failures to structured Claude. */

let claudeAgentSdk: Promise<typeof ClaudeAgentSdk> | null = null

export function loadClaudeAgentSdk(): Promise<typeof ClaudeAgentSdk> {
  claudeAgentSdk ??= import('@anthropic-ai/claude-agent-sdk')
  return claudeAgentSdk
}

export async function startClaudeStreamJsonQuery(
  launch: ClaudeStreamJsonLaunch,
  handlers: ClaudeStreamJsonConnectionHandlers,
  spawnImpl: ProviderProcessSpawner,
  queryImpl?: typeof ClaudeAgentSdk.query
) {
  const sdk = await loadClaudeAgentSdk()
  const startup = claudeStartupAnswerObservation(handlers.onStdout)
  const env = launch.pairedSubscription ? {} : await claudeStreamJsonChildEnv(launch)
  const relay = launch.pairedSubscription
    ? await openPairedClaudeSession(launch.pairedSubscription, launch.cwd, launch.options.model)
    : undefined
  const spawner = createClaudeCodeProcessSpawn(
    spawnImpl,
    process.platform,
    launch,
    startup.feed,
    relay
  )
  const inbox = createClaudeUserMessageQueue()
  const startQuery = () =>
    (queryImpl ?? sdk.query)({
      prompt: inbox.messages,
      options: {
        ...launch.options,
        ...withClaudeInboxSdkOptions(sdk, launch.options),
        cwd: launch.cwd,
        env: withOrcaClaudeChatEntrypoint(env, process.platform),
        pathToClaudeCodeExecutable: launch.pathToClaudeCodeExecutable,
        spawnClaudeCodeProcess: spawner.spawn,
        ...(handlers.canUseTool ? { canUseTool: handlers.canUseTool } : {}),
        ...(handlers.onUserDialog ? { onUserDialog: handlers.onUserDialog } : {})
      }
    })
  let session: ReturnType<typeof sdk.query>
  try {
    session = startQuery()
  } catch (error) {
    relay?.dispose()
    throw error
  }
  const managed = spawner.managed
  const child = managed?.child
  if (!child || !managed) {
    relay?.dispose()
    throw new Error('the claude agent SDK returned without spawning a child')
  }
  return { session, managed, child, spawner, inbox, startup }
}
