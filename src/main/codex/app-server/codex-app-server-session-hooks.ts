import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { CodexAppServerRpc } from './codex-app-server-session'

export type CodexAppServerSessionRpc = CodexAppServerRpc & {
  readonly pid: number | undefined
  readonly closed: boolean
  signal: AbortSignal
  respond: (id: string | number, result: unknown) => void
  respondWithError: (id: string | number, code: number, message: string) => void
}

/** Opt-in server-message handling; absent hooks keep the plain response-only session. */
export type CodexAppServerSessionHooks = {
  onNotification?: (
    method: string,
    params: unknown,
    rpc: CodexAppServerSessionRpc
  ) => void | Promise<void>
  onServerRequest?: (
    request: { id: string | number; method: string; params: unknown },
    rpc: CodexAppServerSessionRpc
  ) => void | Promise<void>
  onInitialized?: (rpc: CodexAppServerSessionRpc, result: unknown) => void | Promise<void>
}

/** Inert without hooks; with them the session also ends on exit, since a hook may await other work. */
export function attach(
  hooks: CodexAppServerSessionHooks | undefined,
  child: ChildProcessWithoutNullStreams,
  lifetime: AbortController,
  request: CodexAppServerRpc['request'],
  exitError: () => Error
) {
  if (!hooks) {
    return undefined
  }
  const own = new AbortController()
  const signal = AbortSignal.any([lifetime.signal, own.signal])
  let rejectEnded: (error: Error) => void = () => {}
  const ended = new Promise<never>((_resolve, reject) => {
    rejectEnded = reject
  })
  const fail = (error: unknown): void => {
    if (signal.aborted) {
      return
    }
    const reason = error instanceof Error ? error : new Error(String(error))
    own.abort(reason)
    rejectEnded(reason)
  }
  const write = (payload: Record<string, unknown>): void => {
    if (signal.aborted) {
      return
    }
    try {
      child.stdin.write(`${JSON.stringify(payload)}
`)
    } catch (error) {
      fail(error)
    }
  }
  child.on('close', () => fail(exitError()))
  child.on('error', fail)
  child.stdin.on('error', fail)

  const rpc: CodexAppServerSessionRpc = {
    get pid() {
      return child.pid
    },
    get closed() {
      return signal.aborted
    },
    signal,
    request: async (method, params, options) => {
      signal.throwIfAborted()
      return request(method, params, options)
    },
    notify: (method, params) => write({ method, ...(params !== undefined ? { params } : {}) }),
    respond: (id, result) => write({ id, result }),
    respondWithError: (id, code, message) => write({ id, error: { code, message } })
  }

  return {
    ended,
    /** Claims server requests and notifications, including ones reusing a pending response id. */
    dispatch(message: { id?: unknown; method?: unknown; params?: unknown }): boolean {
      if (typeof message.method !== 'string') {
        return false
      }
      if (signal.aborted) {
        return true
      }
      try {
        const handled =
          typeof message.id === 'string' || typeof message.id === 'number'
            ? hooks.onServerRequest?.(
                { id: message.id, method: message.method, params: message.params },
                rpc
              )
            : hooks.onNotification?.(message.method, message.params, rpc)
        void Promise.resolve(handled).catch(fail)
      } catch (error) {
        fail(error)
      }
      return true
    },
    async initialized(result: unknown): Promise<void> {
      signal.throwIfAborted()
      await hooks.onInitialized?.(rpc, result)
      signal.throwIfAborted()
    }
  }
}
