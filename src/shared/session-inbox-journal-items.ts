// The journal rows the session inbox reads, and the fields it reads from them.

import type { AgentJournalRenderItem } from './agent-session-journal-types'
import { compareAgentJournalItems } from './agent-session-journal-position'
import { checksIn } from './session-inbox-check-commands'
import { readSessionInboxToolCall } from './session-inbox-tool-contract'

export const SESSION_INBOX_EDIT_TOOLS: ReadonlySet<string> = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit'
])

/** One row per item, at its newest revision, in journal order. */
export function sessionInboxJournalOrder(
  items: readonly AgentJournalRenderItem[]
): AgentJournalRenderItem[] {
  const newest = new Map<string, AgentJournalRenderItem>()
  for (const item of items) {
    const held = newest.get(item.itemId)
    if (!held || held.revision <= item.revision) {
      newest.set(item.itemId, item)
    }
  }
  return [...newest.values()].sort(compareAgentJournalItems)
}

export type SessionInboxTurns = {
  /** The user message that opened each turn, by the turn's item id. */
  userItemIds: Map<string, string>
  states: Map<string, string>
}

export function readSessionInboxTurns(items: readonly AgentJournalRenderItem[]): SessionInboxTurns {
  const turns: SessionInboxTurns = { userItemIds: new Map(), states: new Map() }
  for (const item of items) {
    if (item.body.kind !== 'turn') {
      continue
    }
    turns.states.set(item.itemId, item.body.state)
    if (item.body.userItemId) {
      turns.userItemIds.set(item.itemId, item.body.userItemId)
    }
  }
  return turns
}

/** A foreground Bash command; a backgrounded one reports only that it started. */
export function sessionInboxBashCommand(input: unknown): string | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  if ('run_in_background' in input && input.run_in_background === true) {
    return null
  }
  return 'command' in input && typeof input.command === 'string' ? input.command : null
}

export function sessionInboxEditedPath(input: unknown): string | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  if ('file_path' in input && typeof input.file_path === 'string') {
    return input.file_path
  }
  return 'notebook_path' in input && typeof input.notebook_path === 'string'
    ? input.notebook_path
    : null
}

/**
 * An older row as the inbox keeps it, or null when the inbox never reads it. Only a check's
 * output is read, so every other tool row drops its output to keep a long history small.
 */
export function sessionInboxHistoryItem(
  item: AgentJournalRenderItem
): AgentJournalRenderItem | null {
  const body = item.body
  if (body.kind === 'turn' || (body.kind === 'message' && body.role === 'user')) {
    return item
  }
  if (body.kind !== 'tool-call') {
    return null
  }
  if (readSessionInboxToolCall(body.name, body.input)) {
    return item
  }
  if (item.agentId !== undefined) {
    return null
  }
  const command = body.name === 'Bash' ? sessionInboxBashCommand(body.input) : null
  if (command !== null && checksIn(command).length > 0) {
    return item
  }
  if (SESSION_INBOX_EDIT_TOOLS.has(body.name)) {
    const { output: _output, ...rest } = body
    return { ...item, body: rest }
  }
  return null
}
