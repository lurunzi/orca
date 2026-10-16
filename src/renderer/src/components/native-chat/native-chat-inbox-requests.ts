// What an inbox action sends the agent as the user's message. Each names the entry's id, so the
// agent can close it with the inbox's close tool. Wording follows petekp/inbox `hooks/register.tsx`
// and `hooks/checks.ts` (https://github.com/petekp/inbox @ a8ee58e, MIT, Copyright (c) 2026 Pete
// Petrash); license: resources/licenses/petekp-inbox/LICENSE.

import { translate } from '@/i18n/i18n'
import { outputLines } from '../../../../shared/session-inbox-check-output'
import type {
  SessionInboxCheck,
  SessionInboxFinding,
  SessionInboxQuestion
} from '../../../../shared/session-inbox-types'
import { nativeChatInboxCheckName } from './native-chat-inbox-labels'

export function nativeChatInboxAnswerRequest(
  question: SessionInboxQuestion,
  answer: string
): string {
  return translate(
    'components.native-chat.inbox.request.answer',
    'My answer to your question {{id}} ("{{question}}"): {{answer}}',
    { id: question.id, question: question.question, answer }
  )
}

/** The quote a typed reply starts from; the user writes the rest in the composer. */
export function nativeChatInboxReplyPrefix(question: SessionInboxQuestion): string {
  return translate(
    'components.native-chat.inbox.request.replyPrefix',
    'About your question {{id}} ("{{question}}"): ',
    { id: question.id, question: question.question }
  )
}

export function nativeChatInboxFixRequest(check: SessionInboxCheck): string {
  const output = outputLines(check.summary, check.failures)
  return [
    translate(
      'components.native-chat.inbox.request.fixFailed',
      '{{check}} failed when you last ran it.',
      { check: nativeChatInboxCheckName(check) }
    ),
    ...(check.command
      ? [
          translate('components.native-chat.inbox.request.fixCommand', 'Command: {{command}}', {
            command: check.command
          })
        ]
      : []),
    ...(output.length > 0
      ? [translate('components.native-chat.inbox.request.fixOutput', 'Output:'), ...output]
      : []),
    translate(
      'components.native-chat.inbox.request.fixInstruction',
      'Find the cause, fix it, and run it again to verify.'
    )
  ].join('\n')
}

export function nativeChatInboxFindingRequest(
  finding: SessionInboxFinding,
  how: 'address' | 'discuss'
): string {
  const opening =
    how === 'address'
      ? translate(
          'components.native-chat.inbox.request.address',
          'Please address this finding you recorded ({{id}}):',
          { id: finding.id }
        )
      : translate(
          'components.native-chat.inbox.request.discuss',
          "Let's talk through this finding you recorded ({{id}}) before changing anything:",
          { id: finding.id }
        )
  return [
    opening,
    finding.title,
    finding.detail,
    ...(finding.path
      ? [
          translate('components.native-chat.inbox.request.findingFile', 'File: {{path}}', {
            path: finding.path
          })
        ]
      : [])
  ].join('\n')
}
