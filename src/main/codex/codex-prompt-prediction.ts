import { hasReachedAppVersion } from '../../shared/app-version'
import type { CodexAppServerConnection } from './app-server/codex-app-server-connection-types'
import { isProviderRecord as isAppServerRecord } from '../provider-process/provider-json-record'
import {
  readCodexThreadId,
  readCodexTurnId,
  readCodexTurnStatus
} from './codex-structured-thread-facts'

export function supportsCodexPredictionFork(version: string | null | undefined): boolean {
  return (
    version === '0.162.0-alpha.17.2' ||
    (version != null && hasReachedAppVersion(version, '0.162.0-alpha.20'))
  )
}

const PROMPT =
  'Suggest the short message the user is most likely to type next in this conversation. ' +
  "Write from the user's perspective, in their language and style. Do not answer the conversation, " +
  'perform work, or use tools. Do not invent facts or offer unrequested new work. ' +
  'If no obvious follow-up exists, return null. Return only JSON: {"suggestion": "message"} or {"suggestion": null}.'

/** A disposable prediction fork; none of its messages belong in the user's conversation. */
export class CodexPromptPrediction {
  threadId: string | null = null
  private turnId: string | null = null
  private text = ''
  private done = false
  private interrupted = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly connection: CodexAppServerConnection,
    private readonly onThread: (threadId: string) => void,
    private readonly onResult: (text: string | null) => void
  ) {}

  async start(parentThreadId: string): Promise<void> {
    this.timer = setTimeout(() => this.cancel(), 30_000)
    this.timer.unref?.()
    try {
      const fork = await this.connection.request(
        'thread/fork',
        {
          threadId: parentThreadId,
          experimentalPredictionMode: true,
          ephemeral: true,
          excludeTurns: true,
          threadSource: 'composer_predictions'
        },
        { timeoutMs: 15_000 }
      )
      this.threadId = readCodexThreadId(fork)
      if (!this.threadId || this.threadId === parentThreadId) {
        this.threadId = null
        this.finish(null)
        return
      }
      this.onThread(this.threadId)
      if (this.done) {
        this.unsubscribe()
        return
      }
      const result = await this.connection.request(
        'turn/start',
        {
          threadId: this.threadId,
          turnTrigger: 'composer_predictions',
          effort: 'low',
          approvalPolicy: 'never',
          sandboxPolicy: { type: 'readOnly', networkAccess: false },
          input: [{ type: 'text', text: PROMPT }],
          outputSchema: {
            type: 'object',
            properties: { suggestion: { type: ['string', 'null'] } },
            required: ['suggestion'],
            additionalProperties: false
          }
        },
        { timeoutMs: 15_000 }
      )
      this.turnId ??= readCodexTurnId(result)
      if (this.interrupted) {
        this.interrupt()
      }
    } catch {
      this.cancel()
    }
  }

  observe(method: string, params: unknown): void {
    if (this.done || !isAppServerRecord(params)) {
      return
    }
    if (method === 'turn/started') {
      this.turnId = readCodexTurnId(params)
    } else if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
      this.text += params.delta
      if (this.text.length > 16_384) {
        this.cancel()
      }
    } else if (
      method === 'item/completed' &&
      isAppServerRecord(params.item) &&
      params.item.type === 'agentMessage' &&
      typeof params.item.text === 'string'
    ) {
      this.text = params.item.text
      if (this.text.length > 16_384) {
        this.cancel()
      }
    } else if (method === 'turn/completed') {
      if (readCodexTurnStatus(params) !== 'completed') {
        this.finish(null)
        return
      }
      let result: unknown
      try {
        result = JSON.parse(this.text)
      } catch {
        result = null
      }
      const suggestion = isAppServerRecord(result) ? result.suggestion : null
      this.finish(
        typeof suggestion === 'string' && suggestion.trim() && suggestion.length <= 4096
          ? suggestion
          : null
      )
    } else if (method === 'error') {
      this.cancel()
    }
  }

  cancel(): void {
    if (this.done) {
      return
    }
    this.interrupted = true
    this.interrupt()
    this.finish(null)
  }

  private interrupt(): void {
    if (this.threadId && this.turnId && !this.connection.closed) {
      void this.connection
        .request(
          'turn/interrupt',
          {
            threadId: this.threadId,
            turnId: this.turnId
          },
          { timeoutMs: 5_000 }
        )
        .catch(() => {})
    }
  }

  private unsubscribe(): void {
    if (this.threadId && !this.connection.closed) {
      void this.connection
        .request(
          'thread/unsubscribe',
          {
            threadId: this.threadId
          },
          { timeoutMs: 5_000 }
        )
        .catch(() => {})
    }
  }

  private finish(text: string | null): void {
    if (this.done) {
      return
    }
    this.done = true
    clearTimeout(this.timer)
    this.onResult(text)
    this.unsubscribe()
  }
}
