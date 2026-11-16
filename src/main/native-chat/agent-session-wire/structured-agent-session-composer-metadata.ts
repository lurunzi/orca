import type {
  AgentSessionSlashCommand,
  AgentSessionSubscribeEvent
} from '../../../shared/agent-session/agent-session-wire'

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

/** A suggestion change writes no row, so a caught-up subscriber still owes a frame. */
export function promptSuggestionChanged(
  subscriber: AgentSessionComposerMetadata,
  hooks: Pick<AgentSessionComposerMetadataHooks, 'readPromptSuggestion'>
): boolean {
  return composerMetadataChanged(subscriber, { readPromptSuggestion: hooks.readPromptSuggestion })
}

/** False when the subscriber went inactive before every frame was sent. */
export function emitComposerMetadataFrames(
  subscriber: AgentSessionComposerMetadata & { emit: (event: AgentSessionSubscribeEvent) => void },
  frames: readonly AgentSessionSubscribeEvent[],
  hooks: AgentSessionComposerMetadataHooks,
  isActive?: () => boolean
): boolean {
  const promptSuggestion = hooks.readPromptSuggestion?.(subscriber.sessionId) ?? null
  const [first, ...rest] = frames
  // Bounded side-list frames follow the single frame carrying the suggestion.
  const includeSuggestion =
    first !== undefined &&
    first.type !== 'end' &&
    hooks.readPromptSuggestion !== undefined &&
    (first.type !== 'batch' || promptSuggestion !== subscriber.promptSuggestion)
  for (const frame of includeSuggestion ? [{ ...first, promptSuggestion }, ...rest] : frames) {
    if (isActive && !isActive()) {
      return false
    }
    subscriber.emit(frame)
  }
  if (includeSuggestion) {
    subscriber.promptSuggestion = promptSuggestion
  }
  return true
}
