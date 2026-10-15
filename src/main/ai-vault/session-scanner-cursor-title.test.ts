import { describe, expect, it } from 'vitest'
import { parseCursorSessionContent } from './session-scanner-cursor-parser'

const file = {
  path: '/home/u/.cursor/projects/p/agent-transcripts/chat-1/chat-1.jsonl',
  mtimeMs: 1,
  modifiedAt: new Date(1).toISOString()
}

async function titleOf(content: unknown): Promise<string | null | undefined> {
  const line = JSON.stringify({ role: 'user', message: { content } })
  return (await parseCursorSessionContent(file, `${line}\n`, 'linux'))?.title
}

describe('cursor session title', () => {
  it('drops the timestamp and user_query envelope Cursor wraps around the ask', async () => {
    expect(
      await titleOf([
        {
          type: 'text',
          text: '<timestamp>Sunday, Oct 11, 2026, 4:30 PM (UTC+1)</timestamp>\n<user_query>\nReview the backup scripts.\n</user_query>'
        }
      ])
    ).toBe('Review the backup scripts.')
  })

  it('keeps a plain first prompt unchanged', async () => {
    expect(await titleOf('Fix the login bug')).toBe('Fix the login bug')
  })
})
