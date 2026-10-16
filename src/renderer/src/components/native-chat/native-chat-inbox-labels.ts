// How inbox checks read in the panel and in requests. Wording follows petekp/inbox
// `hooks/checks.ts` (https://github.com/petekp/inbox @ a8ee58e, MIT, Copyright (c) 2026 Pete
// Petrash); license: resources/licenses/petekp-inbox/LICENSE.

import { translate } from '@/i18n/i18n'
import { distinctSummary, failCount } from '../../../../shared/session-inbox-check-output'
import { sessionInboxPathContains } from '../../../../shared/session-inbox-check-tracking'
import type { SessionInboxCheck } from '../../../../shared/session-inbox-types'

function lastSegment(path: string): string {
  return path.replace(/\/+$/, '').replace(/^.*\//, '') || path
}

/** "pnpm test", "vitest a.test.ts" for a narrower run, "pnpm test in app" outside the session's folder. */
export function nativeChatInboxCheckName(
  check: SessionInboxCheck,
  root: string | null = null
): string {
  const base = check.folder ?? root
  const paths = check.target.paths.map((path) =>
    base !== null && path !== base && sessionInboxPathContains(base, path)
      ? path.slice(base.replace(/\/+$/, '').length + 1)
      : path
  )
  const target = [...paths, ...check.target.filters].join(' ')
  const name = target ? `${check.name} ${target}` : check.name
  return check.folder
    ? translate('components.native-chat.inbox.check.inFolder', '{{check}} in {{folder}}', {
        check: name,
        folder: lastSegment(check.folder)
      })
    : name
}

/** How a failed run ended in a few words: "2 of 176 failed", its summary line, or "failed". */
export function nativeChatInboxCheckOutcome(check: SessionInboxCheck): string {
  const counts = failCount(check.summary)
  if (counts) {
    return translate(
      'components.native-chat.inbox.check.failedOf',
      '{{fail}} of {{total}} failed',
      {
        fail: String(counts.fail),
        total: String(counts.total)
      }
    )
  }
  return (
    distinctSummary(check.summary, check.failures) ??
    translate('components.native-chat.inbox.check.failed', 'failed')
  )
}
