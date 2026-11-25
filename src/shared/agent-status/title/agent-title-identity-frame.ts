import { isClaudeIdentityFrameSegment, isCursorAgentTitle } from './agent-title-core'
import type { TerminalAgent } from '../identity/terminal-agent'

/** Claude identity frames and Cursor's native or hook-synthesized titles anchor their agent outright. */
export function identityFrameAgent(segment: string): TerminalAgent | null {
  if (isClaudeIdentityFrameSegment(segment)) {
    return 'claude'
  }
  return isCursorAgentTitle(segment) ? 'cursor' : null
}
