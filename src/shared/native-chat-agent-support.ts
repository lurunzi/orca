import type { TuiAgent } from './tui-agent'

export type NativeChatTranscriptAgent =
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'grok'
  | 'omp'
  | 'antigravity'
  | 'opencode'

/** Agents whose transcripts the native chat view can parse and render. */
export const NATIVE_CHAT_SUPPORTED_AGENT_LIST: readonly TuiAgent[] = [
  'claude',
  'openclaude',
  'codex',
  'cursor',
  'grok',
  'omp',
  'antigravity',
  'opencode',
  'opencode2',
  'zcode'
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
    transcriptAgent === 'claude' ||
    transcriptAgent === 'codex' ||
    transcriptAgent === 'opencode' ||
    transcriptAgent === 'antigravity'
  )
}

/** OMP's configurable keys and existing checkbox state cannot be replaced through PTY input. */
export function nativeChatAskRequiresTerminal(agent: string | null | undefined): boolean {
  return resolveNativeChatTranscriptAgent(agent) === 'omp'
}

/** OpenCode confirms an interrupt with a second Escape; Claude Code and Codex read Esc-Esc at an idle prompt as rewind. */
export function nativeChatStopSendsSecondEscape(agent: string | null | undefined): boolean {
  return resolveNativeChatTranscriptAgent(agent) === 'opencode'
}

export function resolveNativeChatTranscriptAgent(
  agent: string | null | undefined
): NativeChatTranscriptAgent | null {
  // OpenClaude writes Claude transcripts but retains distinct launch/UI identity.
  if (agent === 'claude' || agent === 'openclaude') {
    return 'claude'
  }
  if (agent === 'opencode' || agent === 'opencode2' || agent === 'zcode') {
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
