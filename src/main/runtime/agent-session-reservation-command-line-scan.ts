/**
 * Windows absence proof for a processless reservation.
 *
 * The spawn-token scan reads child environments, which only Linux exposes, so on Windows every
 * reservation latched into manual recovery. The children a reservation can launch carry the
 * provider session id in argv instead (Claude `--session-id=`/`--resume`, Codex TUI `resume`),
 * and the kernel hands out command lines. A readable table with no mention of any id the
 * reservation could have launched is the same "absent" answer the Linux scan gives.
 */

import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { claudeSessionIdForOrcaSession } from '../claude/claude-structured-launch-resolution'
import {
  readWindowsProcessTableFresh,
  type WindowsProcessRow
} from '../windows/windows-process-table'
import { findAgentSessionSpawnTokenProcesses } from './agent-session-spawn-token-process-scan'

export type AgentSessionReservationCommandLineScanDeps = {
  platform?: NodeJS.Platform
  readProcessTable?: () => Promise<WindowsProcessRow[]>
}

const ID_CHARACTER = /[A-Za-z0-9]/

/** Whole-id match; quotes, `=`, `-` and whitespace all bound it, so a wrapped argv still matches. */
export function commandLineMentionsAgentSessionId(commandLine: string, id: string): boolean {
  if (id.length === 0) {
    return false
  }
  // Case-folded: a spurious match only keeps the reservation unverifiable.
  const haystack = commandLine.toLowerCase()
  const needle = id.toLowerCase()
  for (
    let index = haystack.indexOf(needle);
    index !== -1;
    index = haystack.indexOf(needle, index + 1)
  ) {
    const before = haystack[index - 1]
    const after = haystack[index + needle.length]
    if (
      (before === undefined || !ID_CHARACTER.test(before)) &&
      (after === undefined || !ID_CHARACTER.test(after))
    ) {
      return true
    }
  }
  return false
}

/** Every provider id a child launched for this reservation could carry in argv, or null if none. */
export function agentSessionReservationCommandLineIds(record: AgentSessionRecord): string[] | null {
  // Only this machine's process table can speak for a child; WSL and SSH children are not in it.
  if (
    record.location.executionHostId !== LOCAL_EXECUTION_HOST_ID ||
    record.location.wslDistro !== null
  ) {
    return null
  }
  const ids = new Set<string>()
  if (record.provider === 'claude') {
    ids.add(claudeSessionIdForOrcaSession(record.sessionId))
    for (const link of record.providerHandleChain) {
      if (link.handle.provider === 'claude') {
        ids.add(link.handle.sessionId)
      }
    }
  } else if (record.lease.runtimeKind === 'tui') {
    for (const link of record.providerHandleChain) {
      if (link.handle.provider === 'codex') {
        ids.add(link.handle.threadId)
      }
    }
  }
  // Codex native runs `app-server`, whose argv names no thread, so it has no argv proof.
  return ids.size > 0 ? [...ids] : null
}

/** Pids whose command line names the reservation's provider session, or null when unprovable. */
export async function findAgentSessionReservationCommandLineProcesses(
  record: AgentSessionRecord,
  deps: AgentSessionReservationCommandLineScanDeps = {}
): Promise<number[] | null> {
  if ((deps.platform ?? process.platform) !== 'win32') {
    return null
  }
  const ids = agentSessionReservationCommandLineIds(record)
  if (ids === null) {
    return null
  }
  let rows: WindowsProcessRow[]
  try {
    // Fresh: a cached snapshot can predate the child it is asked to rule out.
    rows = await (deps.readProcessTable ?? readWindowsProcessTableFresh)()
  } catch {
    return null
  }
  // A table without a single command line is a degraded read, not an empty host.
  if (!rows.some((row) => row.command.length > 0)) {
    return null
  }
  // A row that denied its query handle is skipped, as the Linux scan skips an unreadable environ.
  return rows
    .filter((row) => ids.some((id) => commandLineMentionsAgentSessionId(row.command, id)))
    .map((row) => row.pid)
}

/** Env-token scan where the host supports it, argv scan on Windows, null everywhere else. */
export async function findAgentSessionReservationProcesses(
  spawnToken: string,
  record: AgentSessionRecord,
  deps: AgentSessionReservationCommandLineScanDeps & {
    findSpawnTokenProcesses?: (spawnToken: string) => Promise<number[] | null>
  } = {}
): Promise<number[] | null> {
  const byToken = await (deps.findSpawnTokenProcesses ?? findAgentSessionSpawnTokenProcesses)(
    spawnToken
  )
  return byToken ?? findAgentSessionReservationCommandLineProcesses(record, deps)
}
