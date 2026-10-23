import { describe, expect, it } from 'vitest'
import { extractAntigravityProseQuestion } from './native-chat-antigravity-prose-question'
import type { NativeChatMessage } from './native-chat-types'

function assistant(text: string): NativeChatMessage {
  return {
    id: 'reply-1',
    role: 'assistant',
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript'
  }
}

describe('Antigravity trailing prose question', () => {
  it('extracts the final request without interpreting the preceding comparison table as choices', () => {
    const question = '需要的话，我可以写打包脚本。请告诉我放在哪个仓库：更适合放进项目的运维库。'
    const reply = assistant(
      `| 方案 | 说明 |\n| --- | --- |\n| 官方源 | 直接下载 |\n| 离线整包 | 固定版本 |\n\n${question}`
    )
    expect(extractAntigravityProseQuestion([reply])).toEqual({
      sourceMessageId: 'reply-1',
      prompt: { questions: [{ question, multiSelect: false, options: [] }] }
    })
  })

  it.each([
    ['Which **repository** should I use?', 'Which repository should I use?'],
    ['Please specify the target folder.', 'Please specify the target folder.'],
    ['请确认要使用的分支。', '请确认要使用的分支。'],
    ['是否继续？', '是否继续？']
  ])('recognizes a direct request: %s', (text, question) => {
    expect(extractAntigravityProseQuestion([assistant(text)])?.prompt.questions[0]?.question).toBe(
      question
    )
  })

  it.each([
    'The work is complete.',
    'Which folder?\n\nI used the default.',
    '```text\nWhich folder?\n```',
    '> Which folder?',
    '| Question |\n| --- |\n| Which folder? |',
    '# Which folder?',
    'Which folder?\n\n- An example, not a pending question'
  ])('does not promote non-question prose or a Markdown example: %s', (text) => {
    expect(extractAntigravityProseQuestion([assistant(text)])).toBeNull()
  })

  it('retires the request when the user replies or a newer assistant message supersedes it', () => {
    const ask = assistant('Which folder?')
    const answer: NativeChatMessage = { ...assistant('docs'), id: 'user-2', role: 'user' }
    expect(extractAntigravityProseQuestion([ask, answer])).toBeNull()
    expect(extractAntigravityProseQuestion([ask, assistant('Done.')])).toBeNull()
  })

  it('leaves tool interaction to the structured prompt resolver', () => {
    const ask = assistant('Which folder?')
    ask.blocks.push({ type: 'tool-call', name: 'ask_question', input: {} })
    expect(extractAntigravityProseQuestion([ask])).toBeNull()
  })
})
