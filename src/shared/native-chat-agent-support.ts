import type { TuiAgent } from './tui-agent'

export type NativeChatTranscriptAgent =
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'grok'
  | 'omp'
  | 'antigravity'
  | 'opencode'

/** Agents whose transcripts the native chat view can parse and render, in the
 *  order the settings pane advertises them. */
export const NATIVE_CHAT_SUPPORTED_AGENT_LIST: readonly TuiAgent[] = [
  'claude',
  'openclaude',
  'codex',
  'cursor',
  'grok',
  'omp',
  'antigravity',
  'opencode',
  'opencode2'
]

export const NATIVE_CHAT_SUPPORTED_AGENTS: ReadonlySet<string> = new Set(
  NATIVE_CHAT_SUPPORTED_AGENT_LIST
)

export function isNativeChatSupportedAgent(agent: string | null | undefined): boolean {
  return agent != null && NATIVE_CHAT_SUPPORTED_AGENTS.has(agent)
}

/** Agents whose chat reads require a filesystem owned by the selected runtime.
 * Direct SSH has no transcript transport; a hook path alone is not a local file. */
export function nativeChatRequiresLocalTranscript(agent: string | null | undefined): boolean {
  const transcriptAgent = resolveNativeChatTranscriptAgent(agent)
  return (
    transcriptAgent === 'cursor' ||
    transcriptAgent === 'grok' ||
    transcriptAgent === 'omp' ||
    transcriptAgent === 'antigravity' ||
    transcriptAgent === 'opencode'
  )
}

/** Selector TUIs require key steps rather than pasted option labels. */
export function shouldStepNativeChatAskAnswer(agent: string | null | undefined): boolean {
  const transcriptAgent = resolveNativeChatTranscriptAgent(agent)
  return (
    transcriptAgent === 'claude' || transcriptAgent === 'codex' || transcriptAgent === 'opencode'
  )
}

export function resolveNativeChatTranscriptAgent(
  agent: string | null | undefined
): NativeChatTranscriptAgent | null {
  // Why: OpenClaude writes the Claude transcript format and layout even though
  // Orca preserves its distinct agent identity for launch and UI behavior.
  if (agent === 'claude' || agent === 'openclaude') {
    return 'claude'
  }
  if (agent === 'opencode' || agent === 'opencode2') {
    return 'opencode'
  }
  if (
    agent === 'codex' ||
    agent === 'cursor' ||
    agent === 'grok' ||
    agent === 'omp' ||
    agent === 'antigravity'
  ) {
    return agent
  }
  return null
}

export function nativeChatApprovalAcceptKey(agent: string | null | undefined): string {
  return resolveNativeChatTranscriptAgent(agent) === 'opencode' ? '\r' : '1'
}
