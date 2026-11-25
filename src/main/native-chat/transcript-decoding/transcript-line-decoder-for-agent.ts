import type { AgentType } from '../../../shared/agent-status/contracts/agent-status-types'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'
import { resolveNativeChatTranscriptAgent } from '../../../shared/native-chat/native-chat-agent-support'
import { decodeAntigravityFullTranscriptLine } from './transcript-line-decoders-antigravity-full'
import { decodeClaudeChatTranscriptLine } from './transcript-line-decoders-claude'
import { decodeCodexTranscriptLine } from './transcript-line-decoders-codex'
import { decodeCursorTranscriptLine } from './transcript-line-decoders-cursor'
import { decodeGrokTranscriptLine } from './transcript-line-decoders-grok'
import { decodeOmpTranscriptLine } from './transcript-line-decoders-omp'

export type NativeChatLineDecoder = (line: string, fallbackId: string) => NativeChatMessage | null

export function nativeChatLineDecoderForAgent(agent: AgentType): NativeChatLineDecoder | null {
  const transcriptAgent = resolveNativeChatTranscriptAgent(agent)
  if (transcriptAgent === 'antigravity') {
    return decodeAntigravityFullTranscriptLine
  }
  if (transcriptAgent === 'claude') {
    return decodeClaudeChatTranscriptLine
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
