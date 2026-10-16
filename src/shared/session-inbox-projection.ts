// The session inbox as a projection of the journal: what the agent recorded through the inbox
// tools, and how the checks it ran through Bash last ended. Nothing here is stored, so every
// client, a resumed conversation and a remote one all read the same inbox from the same rows.

import type { AgentJournalRenderItem } from './agent-session-journal-types'
import { checkRun, isTemporary, resolvePath } from './session-inbox-check-commands'
import { readCheckOutcome } from './session-inbox-check-output'
import {
  recordSessionInboxCheck,
  sessionInboxCheckKey,
  sessionInboxChecksAfterEdit,
  sessionInboxSamePath
} from './session-inbox-check-tracking'
import {
  SESSION_INBOX_EDIT_TOOLS,
  readSessionInboxTurns,
  sessionInboxBashCommand,
  sessionInboxEditedPath,
  sessionInboxJournalOrder
} from './session-inbox-journal-items'
import {
  readSessionInboxToolCall,
  sessionInboxItemId,
  type SessionInboxToolCall
} from './session-inbox-tool-contract'
import type {
  SessionInboxCheck,
  SessionInboxFinding,
  SessionInboxProjection,
  SessionInboxQuestion,
  SessionInboxSource
} from './session-inbox-types'

/** User prompts after which an unanswered question is dropped as moot. */
const QUESTION_EXPIRY_PROMPTS = 12
const MAX_QUESTIONS = 20
const MAX_FINDINGS = 30
/** Where `~` points is the host's business; the stand-in only keeps such folders distinct. */
const HOME_STAND_IN = '~'
/** The session folder when the reader does not know it. */
const UNKNOWN_ROOT = '/'

export type SessionInboxProjectionContext = {
  /** The session's folder on its host; null when the reader does not know it. */
  root: string | null
  /** The session is mid-turn; only used where the journal states no turn for a row. */
  isWorking: boolean
}

type Position = { turnItemId: string | null; index: number }

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * The option a recommendation names: itself, or the longest option whose words all appear in it.
 * Null when it names none. From petekp/inbox `hooks/ledger.ts` (MIT, see the license file).
 */
export function sessionInboxRecommendedOption(
  options: readonly string[],
  recommended: string | null
): string | null {
  if (!recommended) {
    return null
  }
  if (options.includes(recommended)) {
    return recommended
  }
  const named = new Set(words(recommended))
  let best: string | null = null
  for (const option of options) {
    const optionWords = words(option)
    if (
      optionWords.length > words(best ?? '').length &&
      optionWords.every((word) => named.has(word))
    ) {
      best = option
    }
  }
  return best
}

type OpenItems = {
  findings: Map<string, SessionInboxFinding>
  questions: Map<string, SessionInboxQuestion & { askedAtPrompt: number }>
}

function applyInboxCall(
  open: OpenItems,
  call: SessionInboxToolCall,
  source: SessionInboxSource,
  prompts: number
): void {
  if (call.tool === 'record_finding') {
    const id = sessionInboxItemId('finding', call.input.title)
    open.findings.delete(id)
    open.findings.set(id, {
      ...source,
      id,
      kind: call.input.kind,
      title: call.input.title,
      detail: call.input.detail,
      path: call.input.path || null
    })
  } else if (call.tool === 'record_question') {
    const id = sessionInboxItemId('question', call.input.question)
    const options = [...new Set(call.input.options ?? [])]
    open.questions.delete(id)
    open.questions.set(id, {
      ...source,
      id,
      question: call.input.question,
      options,
      recommended: sessionInboxRecommendedOption(options, call.input.recommended ?? null),
      askedAtPrompt: prompts
    })
  } else {
    open.findings.delete(call.input.id)
    open.questions.delete(call.input.id)
  }
}

type CheckReading = Omit<SessionInboxCheck, keyof SessionInboxSource>

// Rows keep their identity until revised, so a streaming turn re-parses only the rows it changed.
const checkReadings = new WeakMap<
  AgentJournalRenderItem,
  { root: string | null; reading: CheckReading | null }
>()

/** How the run ended, or null when nothing it printed or returned says. */
function readCheck(
  item: AgentJournalRenderItem,
  command: string,
  root: string | null
): CheckReading | null {
  if (item.body.kind !== 'tool-call' || item.body.state === 'running') {
    return null
  }
  const sessionFolder = root ?? UNKNOWN_ROOT
  const run = checkRun(command, sessionFolder, HOME_STAND_IN)
  // A throwaway copy in a temp folder says nothing about the session's work, unless the session is one.
  if (
    !run ||
    run.hasMultipleChecks ||
    (run.folder !== null && isTemporary(run.folder) && !isTemporary(sessionFolder))
  ) {
    return null
  }
  const outcome = readCheckOutcome(
    item.body.output?.head ?? '',
    item.body.state === 'failed',
    run.exitIsCheck,
    item.body.output?.truncated ?? false
  )
  if (!outcome) {
    return null
  }
  const folder =
    run.folder !== null && sessionInboxSamePath(run.folder, sessionFolder) ? null : run.folder
  const identity = { folder, name: run.call.name, target: run.target }
  return {
    ...identity,
    ...outcome,
    key: sessionInboxCheckKey(identity),
    kind: run.call.kind,
    command: run.command,
    isStale: false,
    isLeftFailing: false
  }
}

function checkResult(
  item: AgentJournalRenderItem,
  command: string,
  source: SessionInboxSource,
  root: string | null
): SessionInboxCheck | null {
  let cached = checkReadings.get(item)
  if (!cached || cached.root !== root) {
    cached = { root, reading: readCheck(item, command, root) }
    checkReadings.set(item, cached)
  }
  return cached.reading ? { ...source, ...cached.reading } : null
}

export function projectSessionInbox(
  items: readonly AgentJournalRenderItem[],
  context: SessionInboxProjectionContext
): SessionInboxProjection {
  const ordered = sessionInboxJournalOrder(items)
  const turns = readSessionInboxTurns(ordered)
  const root = context.root === null ? null : resolvePath(UNKNOWN_ROOT, context.root)
  const open: OpenItems = { findings: new Map(), questions: new Map() }
  const positions = new Map<string, Position>()
  let checks: SessionInboxCheck[] = []
  let prompts = 0
  let lastUserItemId: string | null = null
  let lastUserIndex = -1
  ordered.forEach((item, index) => {
    const body = item.body
    if (body.kind === 'message' && body.role === 'user') {
      prompts += 1
      lastUserItemId = item.itemId
      lastUserIndex = index
      return
    }
    if (body.kind !== 'tool-call') {
      return
    }
    const turnItemId = item.turnScope?.kind === 'turn' ? item.turnScope.turnItemId : null
    const source: SessionInboxSource = {
      itemId: item.itemId,
      turnUserItemId: (turnItemId && turns.userItemIds.get(turnItemId)) || lastUserItemId,
      at: item.observedAt
    }
    const call = readSessionInboxToolCall(body.name, body.input)
    if (call) {
      // Wait for the server to accept the call before recording or closing an entry.
      if (body.state === 'completed') {
        applyInboxCall(open, call, source, prompts)
      }
      return
    }
    // A subagent's commands and edits belong to its own task, not to the session's checks.
    if (item.agentId !== undefined) {
      return
    }
    const command = body.name === 'Bash' ? sessionInboxBashCommand(body.input) : null
    const result = command === null ? null : checkResult(item, command, source, root)
    if (result) {
      checks = recordSessionInboxCheck(checks, result)
      positions.set(result.itemId, { turnItemId, index })
      return
    }
    const edited = SESSION_INBOX_EDIT_TOOLS.has(body.name)
      ? sessionInboxEditedPath(body.input)
      : null
    if (edited && body.state !== 'failed') {
      checks = sessionInboxChecksAfterEdit(checks, resolvePath(root ?? UNKNOWN_ROOT, edited), root)
    }
  })
  const turnEnded = (position: Position | undefined): boolean => {
    const state = position?.turnItemId ? turns.states.get(position.turnItemId) : undefined
    return state !== undefined
      ? state !== 'running'
      : !context.isWorking || (position?.index ?? -1) < lastUserIndex
  }
  return {
    questions: [...open.questions.values()]
      .filter((question) => prompts - question.askedAtPrompt <= QUESTION_EXPIRY_PROMPTS)
      .slice(-MAX_QUESTIONS)
      .map(({ askedAtPrompt: _askedAtPrompt, ...question }) => question),
    findings: [...open.findings.values()].slice(-MAX_FINDINGS),
    checks: checks.map((check) => ({
      ...check,
      isLeftFailing: check.result === 'fail' && turnEnded(positions.get(check.itemId))
    }))
  }
}
