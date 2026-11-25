import { describe, expect, it } from 'vitest'

import { isKnownHarnessDeliveryTurnText } from './harness-injected-user-turns'

describe('isKnownHarnessDeliveryTurnText', () => {
  it('matches messages from another sender that the agent replies to', () => {
    const deliveries = [
      'Another Claude session sent a message: <cross-session-message from="uds:peer">hi',
      '<cross-session-message from="other session">hello',
      'A message arrived from teammate-b:\n<agent-message>hi',
      '<agent-message from="reviewer">REVIEW the diff',
      '<teammate-message teammate_id="worker-1">status?',
      '<task-notification summary="Agent finished">',
      '<channel source="general">new post'
    ]
    for (const text of deliveries) {
      expect(isKnownHarnessDeliveryTurnText(text), text).toBe(true)
    }
  })

  it('does not match reminders, notices, or command envelopes', () => {
    const notDeliveries = [
      '<system-reminder>context</system-reminder>',
      '[Request interrupted by user]',
      '<command-name>/review</command-name>',
      '<local-command-stdout>ok</local-command-stdout>',
      'No response requested.',
      'please read <cross-session-message> docs'
    ]
    for (const text of notDeliveries) {
      expect(isKnownHarnessDeliveryTurnText(text), text).toBe(false)
    }
  })
})
