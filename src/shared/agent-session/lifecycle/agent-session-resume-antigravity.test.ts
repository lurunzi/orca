import { describe, expect, it } from 'vitest'
import { extractAgentProviderSession } from './agent-session-resume'

describe('Antigravity resume metadata', () => {
  it('preserves the Antigravity hook transcript path for host-owned chat reads', () => {
    expect(
      extractAgentProviderSession('antigravity', {
        conversationId: 'agy-conversation',
        transcriptPath: '/workspace/brain/transcript.jsonl'
      })
    ).toEqual({
      key: 'conversation_id',
      id: 'agy-conversation',
      transcriptPath: '/workspace/brain/transcript.jsonl'
    })
  })
})
