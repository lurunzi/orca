import { join } from 'node:path'
import { waitForPromiseWithSignal } from '../../shared/abort-signal-reason'
import { requireLegacyAgentSessionAccountHome } from '../../shared/agent-session/lifecycle/agent-session-account-home'
import type { AgentSessionRecord } from '../../shared/agent-session/lifecycle/agent-session-record'
import { parseAgentJournalItemKey } from '../../shared/agent-session/journal/agent-session-journal-item-key'
import { asRecord, parseJsonObject } from '../ai-vault/session-scanner-values'
import { AgentConversationCopyError } from '../native-chat/agent-conversation-copy-error'
import { createLegacyIdentityTracker } from '../native-chat/agent-session-journal/history-import/journal-legacy-identity'
import type { StructuredAgentSessionConversationCopyInput } from '../native-chat/agent-session-wire/providers/structured-agent-session-conversation-copy-input'
import { readCodexLocalHistory } from '../native-chat/codex-local-history'
import { resolveSessionFilePath } from '../native-chat/session-file-resolver'
import { decodeCodexTranscriptLine } from '../native-chat/transcript-line-decoders-codex'

type Root = { id?: string; terminal: boolean; prompt: boolean }

export function codexForkBoundaryUnavailable(): never {
  throw new AgentConversationCopyError(
    'Codex could not locate an exact saved boundary in this older chat. Fork a response in a newer chat.'
  )
}

/** Use the importer's physical lineage and identity accounting, including discarded window rows. */
export async function codexForkHistory(input: {
  path: string
  roots: string[]
  selectedItemId: string
  turnId?: string
  sessionId: string
  signal?: AbortSignal
}) {
  input.signal?.throwIfAborted()
  const identity = parseAgentJournalItemKey(input.selectedItemId)
  const tracker = createLegacyIdentityTracker({
    transcriptAgent: 'codex',
    agent: 'codex',
    sessionId: input.sessionId
  })
  const roots: Root[] = []
  let selected: Root | undefined
  let lineIndex = 0
  await waitForPromiseWithSignal(
    readCodexLocalHistory({
      filePath: input.path,
      roots: input.roots,
      visit: (line, fallbackId, _selected, recordId) => {
        input.signal?.throwIfAborted()
        const tracked = tracker.identify(line, lineIndex++)
        const raw = parseJsonObject(line)
        const payload = asRecord(raw?.payload)
        if (
          raw?.type === 'event_msg' &&
          payload?.type === 'thread_rolled_back' &&
          typeof payload.num_turns === 'number'
        ) {
          roots.splice(Math.max(0, roots.length - payload.num_turns))
          return
        }
        if (raw?.type === 'event_msg' && payload?.type === 'task_started') {
          roots.push({
            id: typeof payload.turn_id === 'string' ? payload.turn_id : undefined,
            terminal: false,
            prompt: false
          })
        }
        const message = decodeCodexTranscriptLine(line, fallbackId, { historyImport: true })
        if (message?.role === 'user') {
          const previous = roots.at(-1)
          if (!previous || (previous.prompt && (!previous.id || previous.terminal))) {
            roots.push({ terminal: false, prompt: true })
          } else {
            previous.prompt = true
          }
        }
        const root = roots.at(-1)
        if (
          root &&
          raw?.type === 'event_msg' &&
          (payload?.type === 'task_complete' || payload?.type === 'turn_aborted') &&
          (!payload.turn_id || payload.turn_id === root.id)
        ) {
          root.terminal = true
        }
        const importedMatch =
          identity?.provider === 'legacy' &&
          identity.recordId ===
            (recordId ?? (tracked.provider === 'legacy' ? tracked.recordId : undefined))
        if (
          root &&
          ((importedMatch && message?.role === 'assistant') ||
            (input.turnId && root.id === input.turnId))
        ) {
          if (selected && selected !== root) {
            return codexForkBoundaryUnavailable()
          }
          selected = root
        }
      }
    }),
    input.signal
  )
  input.signal?.throwIfAborted()
  const index = selected ? roots.indexOf(selected) : -1
  if (index < 0) {
    return codexForkBoundaryUnavailable()
  }
  return { roots, index, selected: roots[index] }
}

export async function prepareCodexCopyBoundary(input: {
  record: AgentSessionRecord
  checkpoint: NonNullable<StructuredAgentSessionConversationCopyInput['checkpoint']>
  providerSessionId: string
  signal?: AbortSignal
}) {
  input.signal?.throwIfAborted()
  const home = requireLegacyAgentSessionAccountHome(input.record.accountHome).path
  const stores = [join(home, 'sessions'), join(home, 'archived_sessions')]
  const find = async (id: string) => {
    input.signal?.throwIfAborted()
    return (
      (await resolveSessionFilePath(
        'codex',
        id,
        { codexSessionsDirs: stores, strictErrors: true },
        input.signal
      )) ?? codexForkBoundaryUnavailable()
    )
  }
  const history = await codexForkHistory({
    path: await find(input.providerSessionId),
    roots: stores,
    selectedItemId: input.checkpoint.selectedItemId,
    turnId: input.checkpoint.turnId,
    sessionId: input.providerSessionId,
    signal: input.signal
  })
  const beforeTurnId = history.roots[history.index + 1]?.id
  const lastTurnId = history.selected.id
  if (!input.checkpoint.settled && !history.selected.terminal && !beforeTurnId) {
    throw new AgentConversationCopyError(
      "Codex hasn't finished this response yet. Wait for it to finish, then try again."
    )
  }
  return { stores, find, lastTurnId, beforeTurnId, signal: input.signal }
}
