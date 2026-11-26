import { isMsysExecShellProcess } from '../../../../shared/agent-status/process/shell-process-detection'
import type { WindowsPaneProcessInventory, WindowsProcessCandidate } from './process-rows'

type ConsoleAttachedProcessIdsRead = () => Promise<ReadonlySet<number> | null>

/** The orphan scan and the console filter may both ask; spawn the console-list helper once. */
export function memoizedConsoleRead(
  read: ConsoleAttachedProcessIdsRead | undefined
): ConsoleAttachedProcessIdsRead | undefined {
  if (!read) {
    return undefined
  }
  let pending: Promise<ReadonlySet<number> | null> | undefined
  return () => (pending ??= read())
}

/** MSYS exec lets the fork stub exit, so a script-launched agent is linked to its pane only by the console. */
export async function withMsysConsoleOrphans(
  inventory: WindowsPaneProcessInventory,
  fallbackProcess: string,
  readConsoleAttachedProcessIds: ConsoleAttachedProcessIdsRead | undefined,
  hasRecognizedAgent: (candidates: readonly WindowsProcessCandidate[]) => boolean
): Promise<WindowsProcessCandidate[]> {
  const { candidates } = inventory
  if (
    !readConsoleAttachedProcessIds ||
    !isMsysExecShellProcess(fallbackProcess) ||
    hasRecognizedAgent(candidates)
  ) {
    return candidates
  }
  const consoleProcessIds = (await readConsoleAttachedProcessIds()) ?? new Set<number>()
  return [...candidates, ...inventory.collectConsoleOrphans(consoleProcessIds)]
}
