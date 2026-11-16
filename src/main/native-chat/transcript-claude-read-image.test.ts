import { expect, it } from 'vitest'
import { nativeChatToolRunViewedImages } from '../../shared/native-chat/tools/native-chat-tool-viewed-images'

it('shows the stored snapshot, which outlives the file the agent read', () => {
  const snapshot =
    '/home/u/.config/orca/agent-session-attachments/0b6f8a52-4a3e-4c4e-9a59-1d5d1f2b8c01/s.png'
  expect(
    nativeChatToolRunViewedImages([
      {
        type: 'tool-call',
        name: 'Read',
        callId: 'c1',
        input: { file_path: '/repo/target/select-check/s.png' },
        resultImagePaths: [snapshot]
      },
      { type: 'tool-result', callId: 'c1', output: '' }
    ])
  ).toEqual([{ type: 'image-ref', path: snapshot }])
})
