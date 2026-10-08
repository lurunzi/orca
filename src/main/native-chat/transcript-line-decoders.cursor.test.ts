import { describe, expect, it } from 'vitest'
import { decodeCursorTranscriptLine } from './transcript-line-decoders-cursor'

describe('decodeCursorTranscriptLine', () => {
  it('preserves multiline query bodies with Windows line endings', () => {
    const text =
      '  Wednesday, Sep 23, 2026, 1:44 AM (UTC+1)\r\n<user_query>\r\nfirst\r\n\r\nsecond\r\n</user_query>'
    expect(
      decodeCursorTranscriptLine(
        JSON.stringify({ role: 'user', message: { content: text } }),
        'multiline'
      )?.blocks
    ).toEqual([{ type: 'text', text: 'first\r\n\r\nsecond' }])
  })

  it('does not render an empty envelope as a user message', () => {
    expect(
      decodeCursorTranscriptLine(
        JSON.stringify({ role: 'user', message: { content: '<user_query>\n</user_query>' } }),
        'empty'
      )
    ).toBeNull()
  })

  it.each([
    '',
    'Wednesday, Sep 23, 2026, 1:44 AM (UTC+1)\n',
    '<timestamp>Thursday, Oct 8, 2026, 2:41 PM (UTC+1)</timestamp>\n',
    '  <timestamp>Thursday, Oct 8, 2026, 2:41 PM (UTC+1)</timestamp>\r\n'
  ])('unwraps the Cursor user query after %j', (prefix) => {
    expect(
      decodeCursorTranscriptLine(
        JSON.stringify({
          role: 'user',
          message: {
            content: [{ type: 'text', text: `${prefix}<user_query>\n1为eeqe\n</user_query>` }]
          }
        }),
        'cursor:query'
      )
    ).toMatchObject({
      blocks: [{ type: 'text', text: '1为eeqe' }],
      timestamp: null
    })
  })

  it.each(['user', 'assistant'])('preserves literal query examples in %s prose', (role) => {
    const text = 'Explain <user_query>example</user_query> without changing it'
    expect(
      decodeCursorTranscriptLine(
        JSON.stringify({ role, message: { content: [{ type: 'text', text }] } }),
        'literal'
      )?.blocks
    ).toEqual([{ type: 'text', text }])
  })

  it('preserves a timestamp followed by prose before a literal query', () => {
    const text = '<timestamp>now</timestamp>\nExplain <user_query>example</user_query>'
    expect(
      decodeCursorTranscriptLine(
        JSON.stringify({ role: 'user', message: { content: text } }),
        'literal-timestamp'
      )?.blocks
    ).toEqual([{ type: 'text', text }])
  })

  it.each(['[REDACTED]', ' \n[REDACTED]\r\n'])(
    'omits an assistant row containing only the placeholder %j',
    (text) => {
      expect(
        decodeCursorTranscriptLine(
          JSON.stringify({ role: 'assistant', message: { content: text } }),
          'placeholder'
        )
      ).toBeNull()
    }
  )

  it('removes assistant placeholders while retaining tools and surrounding text in order', () => {
    expect(
      decodeCursorTranscriptLine(
        JSON.stringify({
          role: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Checking' },
              { type: 'text', text: '[REDACTED]' },
              { type: 'tool_use', id: 'read', name: 'Read', input: { path: 'README.md' } },
              { type: 'tool_result', content: '[REDACTED]' },
              { type: 'text', text: 'Done' }
            ]
          }
        }),
        'placeholder-with-tool'
      )?.blocks
    ).toEqual([
      { type: 'text', text: 'Checking' },
      { type: 'tool-call', callId: 'read', name: 'Read', input: { path: 'README.md' } },
      { type: 'tool-result', output: '[REDACTED]' },
      { type: 'text', text: 'Done' }
    ])
  })

  it.each([
    ['user', '[REDACTED]'],
    ['assistant', 'The value is [REDACTED].']
  ])('preserves literal redaction text from %s', (role, text) => {
    expect(
      decodeCursorTranscriptLine(
        JSON.stringify({ role, message: { content: [{ type: 'text', text }] } }),
        'literal-redaction'
      )?.blocks
    ).toEqual([{ type: 'text', text }])
  })

  it('preserves assistant envelopes and non-text blocks', () => {
    const text = '<user_query>example</user_query>'
    expect(
      decodeCursorTranscriptLine(
        JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text }] } }),
        'assistant'
      )?.blocks
    ).toEqual([{ type: 'text', text }])
    expect(
      decodeCursorTranscriptLine(
        JSON.stringify({
          role: 'user',
          message: {
            content: [
              { type: 'text', text: '<user_query>\nDescribe this\n</user_query>' },
              { type: 'image', path: '/tmp/example.png' }
            ]
          }
        }),
        'image'
      )?.blocks
    ).toEqual([
      { type: 'text', text: 'Describe this' },
      { type: 'image-ref', path: '/tmp/example.png' }
    ])
  })

  it('decodes user and assistant text without inventing metadata', () => {
    expect(
      decodeCursorTranscriptLine(
        JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: 'Fix it' }] } }),
        'cursor:0'
      )
    ).toEqual({
      id: 'cursor:0',
      role: 'user',
      blocks: [{ type: 'text', text: 'Fix it' }],
      timestamp: null,
      source: 'transcript'
    })
  })

  it('keeps assistant text and tool_use blocks in transcript order', () => {
    expect(
      decodeCursorTranscriptLine(
        JSON.stringify({
          role: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Checking' },
              { type: 'tool_use', name: 'Read', input: { path: 'README.md' } }
            ]
          }
        }),
        'cursor:1'
      )
    ).toMatchObject({
      role: 'assistant',
      blocks: [
        { type: 'text', text: 'Checking' },
        { type: 'tool-call', name: 'Read', input: { path: 'README.md' } }
      ],
      timestamp: null
    })
  })

  it('skips lifecycle, malformed and empty message rows', () => {
    expect(
      decodeCursorTranscriptLine(JSON.stringify({ type: 'turn_ended', status: 'success' }), 'a')
    ).toBeNull()
    expect(decodeCursorTranscriptLine('{', 'b')).toBeNull()
    expect(
      decodeCursorTranscriptLine(
        JSON.stringify({ role: 'assistant', message: { content: [] } }),
        'c'
      )
    ).toBeNull()
  })
})
