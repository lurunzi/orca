import type { AgentSessionSlashCommand } from '../../../shared/agent-session-wire'

export type AgentSessionComposerMetadata = {
  sessionId: string
  commands?: AgentSessionSlashCommand[] | null
  promptSuggestion?: string | null
}

export type AgentSessionComposerMetadataHooks = {
  readCommands?: (sessionId: string) => AgentSessionSlashCommand[] | undefined
  readPromptSuggestion?: (sessionId: string) => string | null
}

export function composerMetadataChanged(
  subscriber: AgentSessionComposerMetadata,
  hooks: AgentSessionComposerMetadataHooks
): boolean {
  return (
    (hooks.readCommands !== undefined &&
      (hooks.readCommands(subscriber.sessionId) ?? null) !== subscriber.commands) ||
    (hooks.readPromptSuggestion !== undefined &&
      hooks.readPromptSuggestion(subscriber.sessionId) !== subscriber.promptSuggestion)
  )
}
