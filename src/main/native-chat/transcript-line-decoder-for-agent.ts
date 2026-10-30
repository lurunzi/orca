import type { AgentType, NativeChatMessage } from '../../shared/native-chat-types'
import { resolveNativeChatTranscriptAgent } from '../../shared/native-chat-agent-support'
import {
  decodeAntigravityTranscriptLine,
  decodeClaudeTranscriptLine,
  decodeCodexTranscriptLine,
  decodeCursorTranscriptLine,
  decodeGrokTranscriptLine,
  decodeOmpTranscriptLine
} from './transcript-line-decoders'

export type NativeChatLineDecoder = (line: string, fallbackId: string) => NativeChatMessage | null

export function nativeChatLineDecoderForAgent(agent: AgentType): NativeChatLineDecoder | null {
  const transcriptAgent = resolveNativeChatTranscriptAgent(agent)
  if (transcriptAgent === 'antigravity') {
    return decodeAntigravityTranscriptLine
  }
  if (transcriptAgent === 'claude') {
    return decodeClaudeTranscriptLine
  }
  if (transcriptAgent === 'codex') {
    return decodeCodexTranscriptLine
  }
  if (transcriptAgent === 'cursor') {
    return decodeCursorTranscriptLine
  }
  if (transcriptAgent === 'grok') {
    return decodeGrokTranscriptLine
  }
  if (transcriptAgent === 'omp') {
    return decodeOmpTranscriptLine
  }
  return null
}
