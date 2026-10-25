import { afterEach, expect, it, vi } from 'vitest'
import { initializeCodexAppServerConnection } from './app-server/codex-app-server-handshake'
import { CodexAppServerUnsupportedError } from './codex-app-server-session'
import type { CodexStructuredSessionEvent } from './codex-structured-session-state'
import { supportsCodexPredictionFork } from './codex-prompt-prediction'
import {
  acquired,
  fakeCodex,
  THREAD_ID,
  USER_MESSAGE
} from './codex-structured-session-adapter-fixture'

afterEach(() => vi.useRealTimers())

async function setup(version = '0.162.0-alpha.17.2') {
  const codex = fakeCodex({
    'thread/prediction/request': () => {
      throw new CodexAppServerUnsupportedError('not implemented yet')
    },
    'thread/fork': () => ({ thread: { id: 'prediction' } }),
    'turn/start': () => ({ turn: { id: 'prediction-turn' } })
  })
  const events: CodexStructuredSessionEvent[] = []
  const adapter = await acquired(codex, {}, events)
  const connection = codex.connections[0]
  Object.defineProperty(connection, 'serverVersion', { value: version })
  const notify = (method: string, params: unknown) =>
    connection.handlers.onNotification?.(method, params)
  const start = async () => {
    notify('turn/started', { threadId: THREAD_ID, turn: { id: 'source' } })
    notify('turn/completed', { threadId: THREAD_ID, turn: { id: 'source', status: 'completed' } })
    await vi.waitFor(() =>
      expect(connection.calls.some((call) => call.method === 'thread/fork')).toBe(true)
    )
    await Promise.resolve()
    await Promise.resolve()
  }
  const complete = (text = '{"suggestion":"添加测试"}') => {
    notify('item/completed', { threadId: 'prediction', item: { type: 'agentMessage', text } })
    notify('turn/completed', {
      threadId: 'prediction',
      turn: { id: 'prediction-turn', status: 'completed' }
    })
  }
  return {
    codex,
    events,
    connection,
    adapter,
    start,
    notify,
    complete,
    read: () => adapter.readPromptSuggestion('session-1')
  }
}

it.each([
  ['0.155.1', false],
  ['0.162.0-alpha.17', false],
  ['0.162.0-alpha.17.2', true],
  ['0.162.0-alpha.19', false],
  ['0.162.0-alpha.20', true],
  ['0.162.0', true],
  ['bad', false]
])('gates the special fork on verified host version %s', (version, expected) => {
  expect(supportsCodexPredictionFork(version)).toBe(expected)
})

it('captures the execution host version from its initialize response', async () => {
  const codex = fakeCodex({
    initialize: () => ({ userAgent: 'codex_vscode/0.162.0-alpha.17.2 (Windows 11)' })
  })
  await acquired(codex)
  expect(await initializeCodexAppServerConnection(codex.connections[0], null)).toBe(
    '0.162.0-alpha.17.2'
  )
})

it('uses a temporary prediction fork, publishes only the suggested text and releases the fork', async () => {
  const f = await setup()
  await f.start()
  expect(f.connection.calls.find((call) => call.method === 'thread/fork')?.params).toEqual({
    threadId: THREAD_ID,
    experimentalPredictionMode: true,
    ephemeral: true,
    excludeTurns: true,
    threadSource: 'composer_predictions'
  })
  expect(f.connection.calls.find((call) => call.method === 'turn/start')?.params).toMatchObject({
    threadId: 'prediction',
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
    approvalPolicy: 'never'
  })
  f.complete()
  expect(f.read()).toBe('添加测试')
  expect(
    f.events.filter((event) => 'threadId' in event && event.threadId === 'prediction')
  ).toEqual([])
  expect(f.connection.calls.at(-1)).toEqual({
    method: 'thread/unsubscribe',
    params: { threadId: 'prediction' }
  })
})

it('interrupts and releases prediction work when a new user message arrives', async () => {
  const f = await setup()
  await f.start()
  await f.adapter.dispatch({
    sessionId: 'session-1',
    fence: 7,
    clientMessageId: 'next',
    body: USER_MESSAGE
  })
  f.complete()
  expect(f.read()).toBeNull()
  expect(f.connection.calls).toContainEqual({
    method: 'turn/interrupt',
    params: { threadId: 'prediction', turnId: 'prediction-turn' }
  })
  expect(f.connection.calls).toContainEqual({
    method: 'thread/unsubscribe',
    params: { threadId: 'prediction' }
  })
})

it('does not start a prediction if its fork finishes after cancellation', async () => {
  const f = await setup()
  let resolveFork: (result: unknown) => void = () => {}
  f.codex.routes['thread/fork'] = () =>
    new Promise((resolve) => {
      resolveFork = resolve
    })
  await f.start()
  await f.adapter.cancelTurn({ sessionId: 'session-1', fence: 7 })
  resolveFork({ thread: { id: 'prediction' } })
  await Promise.resolve()
  await Promise.resolve()
  expect(f.connection.calls.filter((call) => call.method === 'turn/start')).toHaveLength(0)
  expect(f.connection.calls.at(-1)?.method).toBe('thread/unsubscribe')
})

it('denies requests from prediction threads and does not present them as user questions', async () => {
  const f = await setup()
  await f.start()
  f.connection.handlers.onServerRequest?.({
    id: 42,
    method: 'item/tool/requestUserInput',
    params: { threadId: 'prediction', questions: [] }
  })
  expect(f.connection.replies.at(-1)).toMatchObject({ id: 42, code: -32601 })
  f.complete()
  expect(f.read()).toBeNull()
})

it.each(['not JSON', '{"suggestion":null}', '{"suggestion":42}'])(
  'rejects unusable prediction output %s',
  async (text) => {
    const f = await setup()
    await f.start()
    f.complete(text)
    expect(f.read()).toBeNull()
  }
)

it('bounds prediction lifetime and interrupts only the temporary turn', async () => {
  const f = await setup()
  await f.start()
  vi.useFakeTimers()
  // A second prediction establishes the timer under the fake clock.
  f.complete()
  f.notify('turn/started', { threadId: THREAD_ID, turn: { id: 'second' } })
  f.notify('turn/completed', { threadId: THREAD_ID, turn: { id: 'second', status: 'completed' } })
  await Promise.resolve()
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(30_001)
  expect(f.read()).toBeNull()
  expect(
    f.connection.calls
      .filter((call) => call.method === 'turn/interrupt')
      .every((call) => call.params?.threadId === 'prediction')
  ).toBe(true)
  expect(f.connection.calls.at(-1)?.method).toBe('thread/unsubscribe')
})
