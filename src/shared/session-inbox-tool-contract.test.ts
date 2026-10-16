import { describe, expect, it } from 'vitest'
import {
  SESSION_INBOX_GUIDANCE,
  SESSION_INBOX_TOOL_NAMES,
  isSessionInboxItemId,
  readSessionInboxToolCall,
  sessionInboxItemId,
  sessionInboxToolName
} from './session-inbox-tool-contract'

describe('session inbox tool contract', () => {
  it('names the tools the way the model calls them', () => {
    expect(SESSION_INBOX_TOOL_NAMES).toEqual([
      'mcp__orca_inbox__record_finding',
      'mcp__orca_inbox__record_question',
      'mcp__orca_inbox__close'
    ])
    for (const name of SESSION_INBOX_TOOL_NAMES) {
      expect(SESSION_INBOX_GUIDANCE).toContain(name)
    }
  })

  it('derives one stable id per text, ignoring case, spacing and punctuation', () => {
    const id = sessionInboxItemId('finding', 'Retry loop never gives up')

    // Pinned: the server answered the model with these ids, so they can never change.
    expect(id).toBe('f0w60l3u')
    expect(sessionInboxItemId('finding', '  retry LOOP never gives up!')).toBe(id)
    expect(sessionInboxItemId('question', 'Retry loop never gives up')).toBe('q0w60l3u')
    expect(sessionInboxItemId('finding', 'Retry loop gives up')).not.toBe(id)
    expect(isSessionInboxItemId(id)).toBe(true)
    expect(isSessionInboxItemId('i35')).toBe(false)
  })

  it('reads a journaled call by its full name and refuses an input the server would refuse', () => {
    expect(
      readSessionInboxToolCall(sessionInboxToolName('record_question'), {
        question: ' Ship it? ',
        options: ['Yes', 'No']
      })
    ).toEqual({
      tool: 'record_question',
      input: { question: 'Ship it?', options: ['Yes', 'No'] }
    })
    expect(readSessionInboxToolCall('record_question', { question: 'Ship it?' })).toBeNull()
    expect(
      readSessionInboxToolCall(sessionInboxToolName('record_finding'), { kind: 'nit', title: 't' })
    ).toBeNull()
    expect(readSessionInboxToolCall(sessionInboxToolName('close'), { id: '' })).toBeNull()
  })
})
