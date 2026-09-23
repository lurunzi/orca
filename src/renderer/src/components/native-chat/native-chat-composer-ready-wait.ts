// Holding a launch-draft send until a starting agent TUI has painted its composer.

/** Poll interval and bound for a launch-draft send waiting on a starting agent. */
export const NATIVE_CHAT_COMPOSER_READY_POLL_MS = 100
export const NATIVE_CHAT_COMPOSER_READY_TIMEOUT_MS = 20_000

/**
 * Run `run` once `composerReady` reports true, or after the bound. Polls through
 * the send's own `delay`, so cancelling the send also stops the wait.
 */
export function whenNativeChatComposerReady(
  composerReady: (() => boolean) | undefined,
  delay: (ms: number, fn: () => void) => void,
  run: () => void
): void {
  if (!composerReady) {
    run()
    return
  }
  let waitedMs = 0
  const check = (): void => {
    let ready = true
    try {
      ready = composerReady()
    } catch {
      // An unreadable terminal cannot be waited on; keep the old best-effort send.
    }
    if (ready || waitedMs >= NATIVE_CHAT_COMPOSER_READY_TIMEOUT_MS) {
      run()
      return
    }
    waitedMs += NATIVE_CHAT_COMPOSER_READY_POLL_MS
    delay(NATIVE_CHAT_COMPOSER_READY_POLL_MS, check)
  }
  check()
}
