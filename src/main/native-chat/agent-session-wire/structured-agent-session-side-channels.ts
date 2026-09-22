// Session facts that ride beside journal events without being journal rows: the
// provider's `/` catalog and its context-window report. A subscriber remembers
// what it last sent so a batch only restates a field that changed, while a
// snapshot or reset always carries the current value.

import type {
  AgentSessionContextUsage,
  AgentSessionSlashCommand,
  AgentSessionSubscribeEvent
} from '../../../shared/agent-session-wire'

export type AgentSessionSideChannels = {
  commands?: AgentSessionSlashCommand[] | null
  contextUsage?: AgentSessionContextUsage | null
}

export type AgentSessionSideChannelReaders = {
  readCommands?: (sessionId: string) => AgentSessionSlashCommand[] | undefined
  readContextUsage?: (sessionId: string) => AgentSessionContextUsage | undefined
}

/** Current values for every reader the host wired; absent readers stay absent. */
function readSideChannels(
  readers: AgentSessionSideChannelReaders,
  sessionId: string
): AgentSessionSideChannels {
  return {
    ...(readers.readCommands ? { commands: readers.readCommands(sessionId) ?? null } : {}),
    ...(readers.readContextUsage
      ? { contextUsage: readers.readContextUsage(sessionId) ?? null }
      : {})
  }
}

/** A field the subscriber has never been sent counts as changed, so a fresh
 *  subscriber learns even a null value on its first frame. */
function changed(
  key: keyof AgentSessionSideChannels,
  current: AgentSessionSideChannels,
  remembered: AgentSessionSideChannels
): boolean {
  return key in current && (!(key in remembered) || current[key] !== remembered[key])
}

/** A subscriber's memory of what it last sent; a key it never sent is absent. */
export type AgentSessionSideChannelMemo = {
  sessionId: string
  sideChannels: AgentSessionSideChannels
}

/** Whether any wired reader answers differently from what the subscriber last sent. */
export function agentSessionSideChannelsChanged(
  readers: AgentSessionSideChannelReaders,
  memo: AgentSessionSideChannelMemo
): boolean {
  const current = readSideChannels(readers, memo.sessionId)
  return (
    changed('commands', current, memo.sideChannels) ||
    changed('contextUsage', current, memo.sideChannels)
  )
}

/** The fields to attach to one event, remembering them on the memo: every
 *  wired field on a snapshot or reset, only changed fields on a batch, nothing
 *  on an end. */
export function applyAgentSessionSideChannels(
  readers: AgentSessionSideChannelReaders,
  memo: AgentSessionSideChannelMemo,
  event: AgentSessionSubscribeEvent
): AgentSessionSideChannels {
  const current = readSideChannels(readers, memo.sessionId)
  const remembered = memo.sideChannels
  memo.sideChannels = current
  if (event.type === 'end') {
    return {}
  }
  const restate = event.type !== 'batch'
  const include = (key: keyof AgentSessionSideChannels): boolean =>
    key in current && (restate || changed(key, current, remembered))
  return {
    ...(include('commands') ? { commands: current.commands ?? null } : {}),
    ...(include('contextUsage') ? { contextUsage: current.contextUsage ?? null } : {})
  }
}
