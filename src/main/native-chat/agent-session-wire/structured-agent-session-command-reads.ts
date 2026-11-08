import { AT_REST_COMMANDS_READ_BUDGET_MS } from './options/at-rest-command-catalog'
import type { StructuredAgentSessionHostDeps } from './host/structured-agent-session-host-types'

type CommandReadDeps = Pick<StructuredAgentSessionHostDeps, 'adapter' | 'store'>

export function readStructuredAgentSessionCommands(
  { adapter, store }: CommandReadDeps,
  sessionId: string,
  commandsOnRequest = false
) {
  const live = adapter.readCommands?.(sessionId)
  if (live !== undefined) {
    return live
  }
  const record = store.getRecord(sessionId)
  return record
    ? commandsOnRequest
      ? adapter.atRestCommands?.snapshot?.(record).commands
      : adapter.atRestCommands?.read(record)
    : undefined
}

/** Wait briefly for scans because one-shot menu readers do not receive later updates. */
export async function readStructuredAgentSessionCommandsSettled(
  { adapter, store }: CommandReadDeps,
  sessionId: string,
  commandsOnRequest = false
) {
  const live = adapter.readCommands?.(sessionId)
  const record = store.getRecord(sessionId)
  if (live !== undefined || !record) {
    return { commands: live, ...(commandsOnRequest ? { commandsPending: false } : {}) }
  }
  const commands = adapter.atRestCommands?.settled
    ? await adapter.atRestCommands.settled(
        record,
        AT_REST_COMMANDS_READ_BUDGET_MS,
        commandsOnRequest
      )
    : adapter.atRestCommands?.read(record)
  const current = adapter.readCommands?.(sessionId)
  const snapshot = commandsOnRequest ? adapter.atRestCommands?.snapshot?.(record) : undefined
  if (current === undefined && snapshot?.retryableFailure) {
    throw new Error('Command discovery unavailable')
  }
  return {
    commands: current ?? (snapshot ? snapshot.commands : commands),
    ...(commandsOnRequest
      ? {
          commandsPending: current === undefined && (snapshot?.commandsPending ?? false)
        }
      : {})
  }
}
