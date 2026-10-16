import { useMemo } from 'react'
import type { AgentJournalRenderItem } from '../../../../shared/agent-session-journal-types'
import { projectSessionInbox } from '../../../../shared/session-inbox-projection'
import type {
  SessionInboxCheck,
  SessionInboxFinding,
  SessionInboxQuestion,
  SessionInboxSource
} from '../../../../shared/session-inbox-types'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import {
  nativeChatInboxScopeKey,
  setNativeChatInboxMark,
  useNativeChatInboxMarks,
  type NativeChatInboxMark
} from './native-chat-inbox-marks'
import {
  nativeChatInboxAnswerRequest,
  nativeChatInboxFindingRequest,
  nativeChatInboxFixRequest,
  nativeChatInboxReplyPrefix
} from './native-chat-inbox-requests'
import {
  useNativeChatInboxHistory,
  type NativeChatInboxHistory
} from './use-native-chat-inbox-history'

export type NativeChatInboxCheckEntry = SessionInboxCheck & { fixSent: boolean }
export type NativeChatInboxFindingEntry = SessionInboxFinding & { sent: boolean }

export type NativeChatInbox = {
  questions: readonly SessionInboxQuestion[]
  checks: readonly NativeChatInboxCheckEntry[]
  findings: readonly NativeChatInboxFindingEntry[]
  /** What waits on the user: open questions, and failing checks no fix was asked for. */
  attentionCount: number
  root: string | null
  history: NativeChatInboxHistory
  answer: (question: SessionInboxQuestion, answer: string) => void
  /** Starts a typed reply in the composer; false when the composer is not showing. */
  reply: (question: SessionInboxQuestion) => boolean
  fix: (check: SessionInboxCheck) => void
  sendFinding: (finding: SessionInboxFinding, how: 'address' | 'discuss') => void
  dismiss: (entry: NativeChatInboxEntryRef) => void
  /** Jumps the transcript to the turn the entry came from; false when it names none. */
  jump: (entry: SessionInboxSource) => boolean
}

export type NativeChatInboxEntryRef =
  | { kind: 'question'; entry: SessionInboxQuestion }
  | { kind: 'check'; entry: SessionInboxCheck }
  | { kind: 'finding'; entry: SessionInboxFinding }

/** A question's mark lapses when the agent records it again; a finding's holds for its text. */
function markKey(ref: NativeChatInboxEntryRef): string {
  switch (ref.kind) {
    case 'question':
      return `question:${ref.entry.id}@${ref.entry.itemId}`
    case 'check':
      return `check:${ref.entry.itemId}`
    case 'finding':
      return `finding:${ref.entry.id}`
  }
}

const NO_ITEMS: readonly AgentJournalRenderItem[] = []

export function useNativeChatInbox(args: {
  /** Off for agents the inbox does not serve yet: nothing is projected or read. */
  enabled: boolean
  sessionId: string
  epoch?: string | null
  target: RuntimeClientTarget
  journalItems: readonly AgentJournalRenderItem[]
  /** The chat's window does not reach the journal's start. */
  hasOlder: boolean
  isWorking: boolean
  /** The session's folder on its host, when known. */
  root: string | null
  send: (text: string) => boolean
  insertIntoComposer: (text: string) => boolean
  jumpToMessage: (messageId: string) => void
}): NativeChatInbox {
  const { enabled, sessionId, target, hasOlder, isWorking, root, epoch } = args
  const journalItems = enabled ? args.journalItems : NO_ITEMS
  const scopeKey = nativeChatInboxScopeKey(target, sessionId, epoch)
  const marks = useNativeChatInboxMarks(scopeKey)
  const history = useNativeChatInboxHistory({
    sessionId,
    target,
    epoch,
    hasOlder: enabled && hasOlder
  })
  const projection = useMemo(
    () =>
      projectSessionInbox(
        history.items.length > 0 ? [...history.items, ...journalItems] : journalItems,
        { root, isWorking }
      ),
    [history.items, isWorking, journalItems, root]
  )
  const markOf = (ref: NativeChatInboxEntryRef): NativeChatInboxMark | undefined =>
    marks.get(markKey(ref))
  const questions = projection.questions.filter(
    (entry) => markOf({ kind: 'question', entry }) === undefined
  )
  const checks = projection.checks.flatMap((entry): NativeChatInboxCheckEntry[] => {
    const mark = markOf({ kind: 'check', entry })
    return entry.isLeftFailing && mark !== 'dismissed'
      ? [{ ...entry, fixSent: mark === 'sent' }]
      : []
  })
  const findings = projection.findings.flatMap((entry): NativeChatInboxFindingEntry[] => {
    const mark = markOf({ kind: 'finding', entry })
    return mark === 'dismissed' ? [] : [{ ...entry, sent: mark === 'sent' }]
  })
  const setMark = (ref: NativeChatInboxEntryRef, mark: NativeChatInboxMark): void =>
    setNativeChatInboxMark(scopeKey, markKey(ref), mark)
  return {
    questions,
    checks,
    findings,
    attentionCount: questions.length + checks.filter((check) => !check.fixSent).length,
    root,
    history,
    answer: (question, answer) => {
      if (args.send(nativeChatInboxAnswerRequest(question, answer))) {
        setMark({ kind: 'question', entry: question }, 'answered')
      }
    },
    reply: (question) => args.insertIntoComposer(nativeChatInboxReplyPrefix(question)),
    fix: (check) => {
      if (args.send(nativeChatInboxFixRequest(check))) {
        setMark({ kind: 'check', entry: check }, 'sent')
      }
    },
    sendFinding: (finding, how) => {
      if (args.send(nativeChatInboxFindingRequest(finding, how))) {
        setMark({ kind: 'finding', entry: finding }, 'sent')
      }
    },
    dismiss: (ref) => setMark(ref, 'dismissed'),
    jump: (entry) => {
      if (!entry.turnUserItemId) {
        return false
      }
      args.jumpToMessage(entry.turnUserItemId)
      return true
    }
  }
}
