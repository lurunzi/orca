import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../native-chat-types'
import { withoutSentImagePromptMarkers } from './native-chat-image-transcript-markers'

describe('withoutSentImagePromptMarkers', () => {
  const sent = (text: string, images: number, role: NativeChatMessage['role'] = 'user') => ({
    id: 'm',
    role,
    blocks: [
      { type: 'text' as const, text },
      ...Array.from({ length: images }, (_, i) => ({
        type: 'image-ref' as const,
        path: `/tmp/${i}.png`
      }))
    ],
    timestamp: 1,
    source: 'transcript' as const
  })

  it('drops a marker from the middle of the words, not only the start', () => {
    expect(
      withoutSentImagePromptMarkers(sent('然后图片下面自带 [Image #1] 。如果不在开头', 1))[0]
    ).toEqual({
      type: 'text',
      text: '然后图片下面自带  。如果不在开头'
    })
    expect(withoutSentImagePromptMarkers(sent('[Image #1] 就像这样', 1))[0]).toEqual({
      type: 'text',
      text: '就像这样'
    })
  })

  it('drops a text block left with nothing but its markers', () => {
    expect(withoutSentImagePromptMarkers(sent('[Image #1] [Image #2]', 2))).toEqual([
      { type: 'image-ref', path: '/tmp/0.png' },
      { type: 'image-ref', path: '/tmp/1.png' }
    ])
  })

  it('keeps a marker past the message images, and every marker of an imageless or agent row', () => {
    expect(withoutSentImagePromptMarkers(sent('see [Image #2]', 1))[0]).toEqual({
      type: 'text',
      text: 'see [Image #2]'
    })
    const imageless = sent('see [Image #1]', 0)
    expect(withoutSentImagePromptMarkers(imageless)).toBe(imageless.blocks)
    const agent = sent('see [Image #1]', 1, 'assistant')
    expect(withoutSentImagePromptMarkers(agent)).toBe(agent.blocks)
  })
})
