import { Bug, CircleHelp, CircleX, Lightbulb, LocateFixed, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTime } from '@/i18n/relative-time-format'
import { failureList } from '../../../../shared/session-inbox-check-output'
import type {
  SessionInboxQuestion,
  SessionInboxSource
} from '../../../../shared/session-inbox-types'
import { nativeChatInboxCheckName, nativeChatInboxCheckOutcome } from './native-chat-inbox-labels'
import type {
  NativeChatInbox,
  NativeChatInboxCheckEntry,
  NativeChatInboxFindingEntry
} from './use-native-chat-inbox'

type RowContext = {
  inbox: NativeChatInbox
  agentLabel: string
  /** When the panel opened; ages are read against it so a render stays pure. */
  now: number
  /** Closes the panel after an action that moves the reader away from it. */
  onLeave: () => void
}

function IconAction({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Go to the entry's turn, then drop it: the two quiet actions every row ends with. */
function TrailingActions({
  context,
  source,
  onDismiss
}: {
  context: RowContext
  source: SessionInboxSource
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <div className="ml-auto flex items-center">
      {source.turnUserItemId ? (
        <IconAction
          label={translate('components.native-chat.inbox.action.jump', 'Go to turn')}
          onClick={() => {
            if (context.inbox.jump(source)) {
              context.onLeave()
            }
          }}
        >
          <LocateFixed />
        </IconAction>
      ) : null}
      <IconAction
        label={translate('components.native-chat.inbox.action.dismiss', 'Dismiss')}
        onClick={onDismiss}
      >
        <X />
      </IconAction>
    </div>
  )
}

export function NativeChatInboxQuestionRow({
  context,
  question
}: {
  context: RowContext
  question: SessionInboxQuestion
}): React.JSX.Element {
  const { inbox } = context
  return (
    <li className="flex gap-2 px-3 py-2" data-native-chat-inbox-entry="question">
      <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-[13px] leading-snug break-words">{question.question}</p>
        {question.recommended ? (
          <p className="text-xs text-muted-foreground">
            {translate(
              'components.native-chat.inbox.question.recommended',
              '{{agent}} recommends: {{option}}',
              { agent: context.agentLabel, option: question.recommended }
            )}
          </p>
        ) : null}
        {question.options.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {question.options.map((option) => (
              <Button
                key={option}
                type="button"
                variant="outline"
                size="xs"
                className="max-w-full"
                aria-label={translate(
                  'components.native-chat.inbox.question.answerWith',
                  'Answer: {{option}}',
                  { option }
                )}
                onClick={() => inbox.answer(question, option)}
              >
                <span className="truncate">{option}</span>
              </Button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => {
              if (inbox.reply(question)) {
                context.onLeave()
              }
            }}
          >
            {translate('components.native-chat.inbox.question.reply', 'Reply…')}
          </Button>
          <TrailingActions
            context={context}
            source={question}
            onDismiss={() => inbox.dismiss({ kind: 'question', entry: question })}
          />
        </div>
      </div>
    </li>
  )
}

export function NativeChatInboxCheckRow({
  context,
  check
}: {
  context: RowContext
  check: NativeChatInboxCheckEntry
}): React.JSX.Element {
  const { inbox } = context
  const failures = failureList(check.failures)
  const ranAgo = formatUiRelativeTime(check.at - context.now)
  return (
    <li className="flex gap-2 px-3 py-2" data-native-chat-inbox-entry="check">
      <CircleX className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[13px] leading-snug break-words">
          {nativeChatInboxCheckName(check, inbox.root)}
          <span className="text-muted-foreground"> · {nativeChatInboxCheckOutcome(check)}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {check.isStale
            ? translate(
                'components.native-chat.inbox.check.ranBeforeEdit',
                '{{ago}}, before the last edit',
                { ago: ranAgo }
              )
            : ranAgo}
        </p>
        {failures.length > 0 ? (
          <ul className="flex flex-col gap-0.5 font-mono text-xs text-muted-foreground">
            {failures.map((failure) => (
              <li key={`${failure.file ?? ''}:${failure.text}`} className="break-words">
                {failure.file ? `${failure.file} ` : ''}
                {failure.text}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="truncate font-mono text-xs text-muted-foreground">$ {check.command}</p>
        <div className="flex items-center gap-1">
          {check.fixSent ? (
            <span className="text-xs text-muted-foreground">
              {translate('components.native-chat.inbox.check.fixSent', 'Fix requested')}
            </span>
          ) : (
            <Button type="button" variant="outline" size="xs" onClick={() => inbox.fix(check)}>
              {translate('components.native-chat.inbox.check.fix', 'Ask to fix')}
            </Button>
          )}
          <TrailingActions
            context={context}
            source={check}
            onDismiss={() => inbox.dismiss({ kind: 'check', entry: check })}
          />
        </div>
      </div>
    </li>
  )
}

export function NativeChatInboxFindingRow({
  context,
  finding
}: {
  context: RowContext
  finding: NativeChatInboxFindingEntry
}): React.JSX.Element {
  const { inbox } = context
  const kindLabel =
    finding.kind === 'issue'
      ? translate('components.native-chat.inbox.finding.issue', 'Issue')
      : translate('components.native-chat.inbox.finding.opportunity', 'Opportunity')
  return (
    <li className="flex gap-2 px-3 py-2" data-native-chat-inbox-entry="finding">
      {finding.kind === 'issue' ? (
        <Bug className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label={kindLabel} />
      ) : (
        <Lightbulb
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-label={kindLabel}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-[13px] leading-snug break-words">{finding.title}</p>
        <p className="text-xs leading-snug break-words text-muted-foreground">{finding.detail}</p>
        {finding.path ? (
          <p className="truncate font-mono text-xs text-muted-foreground">{finding.path}</p>
        ) : null}
        <div className="flex items-center gap-1">
          {finding.sent ? (
            <span className="text-xs text-muted-foreground">
              {translate('components.native-chat.inbox.finding.sent', 'Sent to {{agent}}', {
                agent: context.agentLabel
              })}
            </span>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => inbox.sendFinding(finding, 'address')}
              >
                {translate('components.native-chat.inbox.finding.address', 'Address')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => inbox.sendFinding(finding, 'discuss')}
              >
                {translate('components.native-chat.inbox.finding.discuss', 'Discuss')}
              </Button>
            </>
          )}
          <TrailingActions
            context={context}
            source={finding}
            onDismiss={() => inbox.dismiss({ kind: 'finding', entry: finding })}
          />
        </div>
      </div>
    </li>
  )
}

export type { RowContext as NativeChatInboxRowContext }
