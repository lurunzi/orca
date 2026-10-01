import { isShellProcess } from '../../shared/shell-process-detection'

/** Only a shell in the foreground is evidence the agent exited; anything else keeps chat. On a
 *  local Windows PTY the shell name is still only a candidate: ConPTY names the spawned shell
 *  whenever it cannot see the foreground, so the PTY job must prove the shell is alone first. */
export function settleForegroundShellExit(args: {
  process: string | undefined
  isLocalWindowsPty: boolean
  confirmShell: (() => Promise<boolean>) | undefined
  isCurrent: () => boolean
  exit: () => void
  keep: () => void
}): void {
  if (!args.process?.trim() || !isShellProcess(args.process)) {
    args.keep()
    return
  }
  if (!args.isLocalWindowsPty || !args.confirmShell) {
    args.exit()
    return
  }
  void args
    .confirmShell()
    .catch(() => false)
    .then((confirmed) => {
      if (args.isCurrent()) {
        ;(confirmed ? args.exit : args.keep)()
      }
    })
}
