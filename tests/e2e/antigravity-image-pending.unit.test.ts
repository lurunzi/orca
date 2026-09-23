import { describe, expect, it } from 'vitest'
import { decodeAntigravityTranscriptLine } from '../../src/main/native-chat/transcript-line-decoders-antigravity'
import { formatAgentImagePath } from '../../src/shared/agent-image-paste'
import {
  pendingSendsAsMessages,
  prunePendingSends
} from '../../src/renderer/src/components/native-chat/native-chat-pending'

function userTurn(paths: string[], text: string) {
  return decodeAntigravityTranscriptLine(
    JSON.stringify({
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      created_at: 2000,
      content:
        `${paths.map((path) => formatAgentImagePath('antigravity', path)).join(' ')} ${text}`.trim()
    }),
    'user-1'
  )!
}

describe('Antigravity attachment echoes', () => {
  it.each([
    ['C:\\Users\\Ada\\AppData\\Local\\Temp\\orca-paste-123.png'],
    ['C:\\Users\\Ada Lovelace\\Pictures\\shot.png'],
    ['/tmp/orca-paste-123.png', '/home/ada/My Pictures/second.jpg'],
    ['\\\\server\\share\\shot.webp'],
    ['/home/ada/a"b\'c.png'],
    ['/home/ada/a "b\'c.png'],
    ['/home/ada/a "b.png'],
    ['/home/ada/@picture.png']
  ])('merges image references from %s into the submitted turn', (...imagePaths) => {
    const text = 'antigravity的gui没有模型选择'
    const pending = [{ id: 'send-1', text, imagePaths, sentAt: 1000, afterMessageId: null }]
    const user = userTurn(imagePaths, text)
    expect(user.blocks).toEqual([
      ...imagePaths.map((path) => ({ type: 'image-ref', path })),
      { type: 'text', text }
    ])
    expect(pendingSendsAsMessages(pending, [user])).toEqual([])
    expect(prunePendingSends(pending, [user])).toEqual(pending)
    const assistant = decodeAntigravityTranscriptLine(
      JSON.stringify({ source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Response' }),
      'assistant-1'
    )!
    expect(prunePendingSends(pending, [user, assistant])).toEqual([])
  })

  it('reconciles image-only sends by their actual attachment paths', () => {
    const imagePaths = ['/tmp/orca-paste-123.png']
    const pending = [{ id: 'send-1', text: '', imagePaths, sentAt: 1000 }]
    expect(pendingSendsAsMessages(pending, [userTurn(imagePaths, '')])).toEqual([])
    expect(pendingSendsAsMessages(pending, [userTurn(['/tmp/other.png'], '')])).toHaveLength(1)
  })

  it('keeps a repeated send when the only matching turn predates its boundary', () => {
    const imagePaths = ['/tmp/orca-paste-123.png']
    const user = userTurn(imagePaths, 'inspect')
    const pending = [
      {
        id: 'send-2',
        text: 'inspect',
        imagePaths,
        sentAt: 3000,
        afterMessageId: user.id
      }
    ]
    expect(pendingSendsAsMessages(pending, [user])).toHaveLength(1)
  })
})
