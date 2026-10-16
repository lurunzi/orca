import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  NativeChatInboxCheckRow,
  NativeChatInboxFindingRow,
  NativeChatInboxQuestionRow,
  type NativeChatInboxRowContext
} from './NativeChatInboxRows'
import type { NativeChatInbox } from './use-native-chat-inbox'

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <h3 className="px-3 pt-2 pb-1 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

/** Whether the inbox covers the whole conversation, and a retry when it could not. */
function HistoryStatus({ inbox }: { inbox: NativeChatInbox }): React.JSX.Element | null {
  const { state, load } = inbox.history
  if (state === 'loading') {
    return (
      <p
        className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground"
        role="status"
      >
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        {translate('components.native-chat.inbox.history.loading', 'Reading earlier turns…')}
      </p>
    )
  }
  if (state === 'partial') {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        {translate('components.native-chat.inbox.history.partial', 'Older turns are not included.')}
      </p>
    )
  }
  if (state === 'failed') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span>
          {translate(
            'components.native-chat.inbox.history.failed',
            'Earlier turns could not be read.'
          )}
        </span>
        <Button type="button" variant="ghost" size="xs" onClick={load}>
          {translate('components.native-chat.inbox.history.retry', 'Retry')}
        </Button>
      </div>
    )
  }
  return null
}

export function NativeChatInboxPanel({
  inbox,
  agentLabel,
  now,
  onLeave
}: {
  inbox: NativeChatInbox
  agentLabel: string
  now: number
  onLeave: () => void
}): React.JSX.Element {
  const context: NativeChatInboxRowContext = { inbox, agentLabel, now, onLeave }
  const needsYou = inbox.questions.length + inbox.checks.length
  const isEmpty = needsYou === 0 && inbox.findings.length === 0
  return (
    <div className="flex flex-col" data-native-chat-inbox-panel="true">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">
          {translate('components.native-chat.inbox.title', 'Inbox')}
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {inbox.attentionCount > 0
            ? translate('components.native-chat.inbox.waitingCount', '{{count}} waiting on you', {
                count: inbox.attentionCount
              })
            : translate('components.native-chat.inbox.nothingWaiting', 'Nothing waiting on you')}
        </span>
      </div>
      <div className="scrollbar-sleek max-h-[min(28rem,65vh)] overflow-y-auto pb-1">
        {isEmpty && inbox.history.state !== 'loading' ? (
          <p className="px-3 py-4 text-xs leading-relaxed text-muted-foreground">
            {translate(
              'components.native-chat.inbox.empty',
              'Questions {{agent}} leaves to you, findings it records, and checks still failing when a turn ends show up here.',
              { agent: agentLabel }
            )}
          </p>
        ) : null}
        {needsYou > 0 ? (
          <section>
            <SectionLabel>
              {translate('components.native-chat.inbox.section.needsYou', 'Needs you')}
            </SectionLabel>
            <ul>
              {inbox.questions.map((question) => (
                <NativeChatInboxQuestionRow
                  key={`${question.id}@${question.itemId}`}
                  context={context}
                  question={question}
                />
              ))}
              {inbox.checks.map((check) => (
                <NativeChatInboxCheckRow key={check.itemId} context={context} check={check} />
              ))}
            </ul>
          </section>
        ) : null}
        {inbox.findings.length > 0 ? (
          <section>
            <SectionLabel>
              {translate('components.native-chat.inbox.section.findings', 'Findings')}
            </SectionLabel>
            <ul>
              {inbox.findings.map((finding) => (
                <NativeChatInboxFindingRow key={finding.id} context={context} finding={finding} />
              ))}
            </ul>
          </section>
        ) : null}
        <HistoryStatus inbox={inbox} />
      </div>
    </div>
  )
}
