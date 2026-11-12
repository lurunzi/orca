import { isMsysExecShellProcess } from '../../shared/agent-status/process/shell-process-detection'
import type {
  WindowsPaneProcessInventory,
  WindowsProcessCandidate
} from './windows-foreground-process-rows'

/** MSYS exec lets the fork stub exit, so a script-launched agent is linked to its pane only by the console. */
export async function withMsysConsoleOrphans(args: {
  inventory: WindowsPaneProcessInventory
  fallbackProcess: string
  readConsoleAttachedProcessIds: (() => Promise<ReadonlySet<number> | null>) | undefined
  hasRecognizedAgent: (candidates: readonly WindowsProcessCandidate[]) => boolean
}): Promise<WindowsProcessCandidate[]> {
  const { candidates } = args.inventory
  if (
    !args.readConsoleAttachedProcessIds ||
    !isMsysExecShellProcess(args.fallbackProcess) ||
    args.hasRecognizedAgent(candidates)
  ) {
    return candidates
  }
  const consoleProcessIds = (await args.readConsoleAttachedProcessIds()) ?? new Set<number>()
  return [...candidates, ...args.inventory.collectConsoleOrphans(consoleProcessIds)]
}
