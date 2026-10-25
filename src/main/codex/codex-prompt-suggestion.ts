import { isProviderRecord as isAppServerRecord } from '../provider-process/provider-json-record'
import { CodexPromptPrediction, supportsCodexPredictionFork } from './codex-prompt-prediction'
import type { CodexAppServerServerRequest } from './app-server/codex-app-server-connection-types'
import { isCodexAppServerRequestError } from './app-server/codex-app-server-request-error'
import {
  isCodexAppServerUnsupportedError,
  isCodexMethodNotFoundError
} from './codex-app-server-session'
import type { CodexSession, CodexStructuredSessionEvent } from './codex-structured-session-state'
import {
  readCodexThreadId,
  readCodexTurnId,
  readCodexTurnStatus
} from './codex-structured-thread-facts'

const PREDICTION_REQUEST = 'thread/prediction/request'

/** Composer metadata owned by the same execution host and connection as the conversation. */
export class CodexPromptSuggestion {
  private text: string | null = null
  private sourceTurnId: string | null = null
  private latestTurnId: string | null = null
  private requestedTurnId: string | null = null
  private unsupported = false
  private revision = 0
  private prediction: CodexPromptPrediction | null = null
  private readonly predictionThreads = new Set<string>()

  constructor(
    private readonly session: CodexSession,
    private readonly publish: () => void
  ) {}

  read(): string | null {
    return this.idle() ? this.text : null
  }

  invalidate(): void {
    this.requestedTurnId = this.latestTurnId
    this.clear()
  }

  private clear(): void {
    this.revision += 1
    this.prediction?.cancel()
    this.prediction = null
    this.sourceTurnId = null
    this.setText(null)
  }

  private idle(): boolean {
    return (
      !this.session.ended &&
      !this.session.orcaClose &&
      !this.session.connection.closed &&
      !this.session.dispatchPending &&
      this.session.dispatchEchoes.size === 0 &&
      !this.session.activeTurnIds?.size
    )
  }

  private setText(text: string | null): void {
    if (text !== this.text) {
      this.text = text
      this.publish()
    }
  }

  observe(event: CodexStructuredSessionEvent): void {
    if (event.type === 'ended') {
      this.invalidate()
      return
    }
    if (
      event.type !== 'notification' ||
      readCodexThreadId(event.params) !== this.session.threadId
    ) {
      return
    }
    if (event.method === 'turn/started') {
      this.latestTurnId = readCodexTurnId(event.params)
      this.clear()
    } else if (event.method === 'thread/reverted' || event.method === 'thread/compacted') {
      this.invalidate()
    } else if (event.method === 'turn/completed') {
      const turnId = readCodexTurnId(event.params)
      if (
        turnId &&
        turnId !== this.requestedTurnId &&
        (!this.latestTurnId || turnId === this.latestTurnId)
      ) {
        this.latestTurnId = turnId
        this.clear()
        if (readCodexTurnStatus(event.params) === 'completed') {
          this.request(turnId)
        }
      }
    } else if (event.method === 'thread/prediction/updated') {
      const params = event.params
      if (
        !this.idle() ||
        !isAppServerRecord(params) ||
        params.sourceTurnId !== this.sourceTurnId ||
        !this.sourceTurnId ||
        !isAppServerRecord(params.result)
      ) {
        return
      }
      const { type, text } = params.result
      if (type === 'failed' || (type === 'completed' && text === null)) {
        this.setText(null)
      } else if (
        type === 'completed' &&
        typeof text === 'string' &&
        text.trim() &&
        text.length <= 4096
      ) {
        this.setText(text)
      }
    }
  }

  async restore(thread: Record<string, unknown> | undefined): Promise<void> {
    if (
      this.latestTurnId ||
      (isAppServerRecord(thread?.status) && thread.status.type === 'active')
    ) {
      return
    }
    const revision = this.revision
    let turn: unknown = Array.isArray(thread?.turns) ? thread.turns.at(-1) : undefined
    if (!turn && this.session.historyMode === 'paginated') {
      try {
        const page = await this.session.connection.request(
          'thread/turns/list',
          {
            threadId: this.session.threadId,
            limit: 1,
            sortDirection: 'desc'
          },
          { timeoutMs: 15_000 }
        )
        turn = isAppServerRecord(page) && Array.isArray(page.data) ? page.data[0] : undefined
      } catch {
        return
      }
    }
    if (revision !== this.revision || this.latestTurnId) {
      return
    }
    if (isAppServerRecord(turn) && turn.status === 'completed' && typeof turn.id === 'string') {
      this.latestTurnId = turn.id
      this.request(turn.id)
    }
  }

  private request(sourceTurnId: string): void {
    if (!this.idle() || this.requestedTurnId === sourceTurnId) {
      return
    }
    this.requestedTurnId = sourceTurnId
    this.sourceTurnId = sourceTurnId
    if (this.unsupported) {
      this.predict(sourceTurnId)
      return
    }
    void this.session.connection
      .request(
        PREDICTION_REQUEST,
        {
          threadId: this.session.threadId,
          sourceTurnId
        },
        { timeoutMs: 15_000 }
      )
      .catch((error: unknown) => {
        // Older Rust dispatchers report an unknown method as an invalid enum variant.
        this.unsupported ||=
          isCodexAppServerUnsupportedError(error) ||
          isCodexMethodNotFoundError(error) ||
          (isCodexAppServerRequestError(error) &&
            error.code === -32600 &&
            error.message.includes('unknown variant `thread/prediction/request`'))
        if (this.sourceTurnId === sourceTurnId) {
          if (this.unsupported) {
            this.predict(sourceTurnId)
          } else {
            this.clear()
          }
        }
      })
  }

  private predict(sourceTurnId: string): void {
    if (!this.idle() || !supportsCodexPredictionFork(this.session.connection.serverVersion)) {
      return
    }
    const revision = this.revision
    this.prediction = new CodexPromptPrediction(
      this.session.connection,
      (threadId) => {
        this.predictionThreads.add(threadId)
        if (this.predictionThreads.size > 32) {
          const oldest = this.predictionThreads.values().next().value
          if (oldest) {
            this.predictionThreads.delete(oldest)
          }
        }
      },
      (text) => {
        if (revision === this.revision && this.sourceTurnId === sourceTurnId && this.idle()) {
          this.setText(text)
        }
      }
    )
    void this.prediction.start(this.session.threadId)
  }

  consume(method: string, params: unknown): boolean {
    const threadId = readCodexThreadId(params)
    if (!threadId || !this.predictionThreads.has(threadId)) {
      return false
    }
    if (this.prediction?.threadId === threadId) {
      this.prediction.observe(method, params)
    }
    return true
  }

  denyRequest(request: CodexAppServerServerRequest): boolean {
    const threadId = readCodexThreadId(request.params)
    if (!threadId || !this.predictionThreads.has(threadId)) {
      return false
    }
    this.session.connection.respondWithError(
      request.id,
      -32601,
      'Prompt predictions cannot request tools or user input'
    )
    if (this.prediction?.threadId === threadId) {
      this.prediction.cancel()
    }
    return true
  }
}
