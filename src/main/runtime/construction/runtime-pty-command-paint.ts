import { hasTerminalCommandPainted } from '../terminal/input/terminal-command-paint'
import type { RuntimePtyWorktreeRecord } from '../terminal/records/runtime-terminal-state-records'

/** A PTY that is gone has nothing left to paint, so it never holds a wait back. */
export function hasRuntimePtyCommandPainted(
  ptysById: ReadonlyMap<string, RuntimePtyWorktreeRecord>,
  ptyId: string
): boolean {
  const pty = ptysById.get(ptyId)
  return pty === undefined || hasTerminalCommandPainted(pty)
}
