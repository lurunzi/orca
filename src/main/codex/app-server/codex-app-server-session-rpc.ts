import type { PipedChildProcess } from '@orca/process-host/process-spec'
import { createProviderRecordReader } from '../../provider-process/provider-record-reader'

export type CodexAppServerRpc = {
  signal?: AbortSignal
  /** Per-call deadline within the session deadline; absent/null uses only the session deadline. */
  request: (
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number | null }
  ) => Promise<unknown>
  notify: (method: string, params?: Record<string, unknown>) => void
}

export type CodexAppServerSessionRpc = CodexAppServerRpc & {
  readonly pid: number | undefined
  readonly closed: boolean
  signal: AbortSignal
  respond: (id: string | number, result: unknown) => void
  respondWithError: (id: string | number, code: number, message: string) => void
}

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

/** Missing app-server subcommand or RPC method; only this class marks capability caches unsupported. */
export class CodexAppServerUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexAppServerUnsupportedError'
  }
}

export class CodexAppServerTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexAppServerTimeoutError'
  }
}

export function isCodexAppServerUnsupportedError(error: unknown): boolean {
  return error instanceof Error && error.name === 'CodexAppServerUnsupportedError'
}

const JSON_RPC_METHOD_NOT_FOUND = -32601

// Only method-not-found responses prove absence rather than a transient failure.
export function isCodexMethodNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const { code, message } = error as { code?: unknown; message?: unknown }
  return (
    code === JSON_RPC_METHOD_NOT_FOUND ||
    /method not found/i.test(typeof message === 'string' ? message : '')
  )
}

type JsonRpcResponse = {
  id?: number
  result?: unknown
  error?: { code?: number; message?: string }
}

export function createCodexAppServerSessionRpc(input: {
  child: PipedChildProcess
  signal: AbortSignal
  hooks: CodexAppServerSessionHooks
  fail: (error: Error) => void
}): CodexAppServerSessionRpc {
  const { child, signal, hooks } = input
  let nextRequestId = 1
  const pending = new Map<
    number,
    { resolve: (response: JsonRpcResponse) => void; reject: (error: Error) => void }
  >()

  const failPending = (): void => {
    for (const waiter of pending.values()) {
      waiter.reject(signal.reason)
    }
    pending.clear()
  }
  signal.addEventListener('abort', failPending, { once: true })

  function sendLine(payload: Record<string, unknown>): void {
    signal.throwIfAborted()
    child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  function writeUnawaited(payload: Record<string, unknown>): void {
    if (signal.aborted) {
      return
    }
    try {
      sendLine(payload)
    } catch (error) {
      input.fail(asError(error))
    }
  }

  async function request(
    method: string,
    params?: Record<string, unknown>,
    options: { timeoutMs?: number | null } = {}
  ): Promise<unknown> {
    signal.throwIfAborted()
    const id = nextRequestId++
    let requestTimer: ReturnType<typeof setTimeout> | undefined
    const response = await new Promise<JsonRpcResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      const { timeoutMs } = options
      if (typeof timeoutMs === 'number') {
        requestTimer = setTimeout(() => {
          pending.delete(id)
          reject(
            new CodexAppServerTimeoutError(`codex app-server ${method} exceeded ${timeoutMs}ms`)
          )
        }, timeoutMs)
      }
      try {
        sendLine({ method, id, ...(params !== undefined ? { params } : {}) })
      } catch (error) {
        pending.delete(id)
        reject(asError(error))
      }
    }).finally(() => clearTimeout(requestTimer))
    signal.throwIfAborted()
    if (response.error) {
      if (isCodexMethodNotFoundError(response.error)) {
        throw new CodexAppServerUnsupportedError(
          `codex app-server does not support ${method}: ${response.error.message ?? 'method not found'}`
        )
      }
      throw new Error(
        `codex app-server ${method} failed: ${response.error.message ?? 'unknown error'}`
      )
    }
    return response.result
  }

  const rpc: CodexAppServerSessionRpc = {
    get pid() {
      return child.pid
    },
    get closed() {
      return signal.aborted
    },
    signal,
    request,
    notify: (method, params) =>
      writeUnawaited({ method, ...(params !== undefined ? { params } : {}) }),
    respond: (id, result) => writeUnawaited({ id, result }),
    respondWithError: (id, code, message) => writeUnawaited({ id, error: { code, message } })
  }

  createProviderRecordReader({
    stdout: child.stdout,
    onRecord: (parsed) => {
      if (
        signal.aborted ||
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return
      }
      const message = parsed as Record<string, unknown>
      if (typeof message.method === 'string') {
        let handled: void | Promise<void>
        try {
          handled =
            typeof message.id === 'string' || typeof message.id === 'number'
              ? hooks.onServerRequest?.(
                  { id: message.id, method: message.method, params: message.params },
                  rpc
                )
              : hooks.onNotification?.(message.method, message.params, rpc)
        } catch (error) {
          input.fail(asError(error))
          return
        }
        void Promise.resolve(handled).catch((error: unknown) => input.fail(asError(error)))
        return
      }
      if (typeof message.id !== 'number') {
        return
      }
      const waiter = pending.get(message.id)
      if (waiter) {
        pending.delete(message.id)
        waiter.resolve(message as JsonRpcResponse)
      }
    },
    onRejected: () => undefined,
    onFatal: input.fail
  })
  return rpc
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
