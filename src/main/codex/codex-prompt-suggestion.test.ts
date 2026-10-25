import { describe, expect, it, vi } from 'vitest'
import { CodexAppServerRequestError } from './app-server/codex-app-server-request-error'
import { CodexAppServerUnsupportedError } from './codex-app-server-session'
import {
  acquireReadyCodexForTest,
  acquired,
  adapterFor,
  fakeCodex,
  identityFor,
  THREAD_ID,
  USER_MESSAGE
} from './codex-structured-session-adapter-fixture'

const REQUEST = 'thread/prediction/request'
const UPDATED = 'thread/prediction/updated'

async function fixture(codex = fakeCodex()) {
  const adapter = await acquired(codex)
  const connection = codex.connections[0]
  const notify = (method: string, params: unknown) =>
    connection.handlers.onNotification?.(method, params)
  const turn = (id: string, status = 'completed', threadId = THREAD_ID) => {
    notify('turn/started', { threadId, turn: { id, status: 'inProgress' } })
    notify('turn/completed', { threadId, turn: { id, status } })
  }
  const suggest = (sourceTurnId: string, text: unknown, threadId = THREAD_ID) =>
    notify(UPDATED, { threadId, sourceTurnId, result: { type: 'completed', text } })
  return {
    adapter,
    connection,
    notify,
    turn,
    suggest,
    read: () => adapter.readPromptSuggestion('session-1')
  }
}

describe('Codex prompt suggestions', () => {
  it('requests once after a successful turn and accepts only its matching suggestion', async () => {
    const f = await fixture()
    f.suggest('one', 'too early')
    expect(f.read()).toBeNull()
    f.turn('one')
    expect(f.connection.calls.at(-1)).toEqual({
      method: REQUEST,
      params: { threadId: THREAD_ID, sourceTurnId: 'one' }
    })
    f.suggest('other', 'stale')
    f.suggest('one', 'foreign', 'child-thread')
    expect(f.read()).toBeNull()
    f.suggest('one', '添加测试')
    expect(f.read()).toBe('添加测试')
    f.notify('turn/completed', { threadId: THREAD_ID, turn: { id: 'one', status: 'completed' } })
    expect(f.read()).toBe('添加测试')
    expect(f.connection.calls.filter((call) => call.method === REQUEST)).toHaveLength(1)
  })

  it('clears on the next turn and ignores late completions and predictions from the old turn', async () => {
    const f = await fixture()
    f.turn('one')
    f.suggest('one', 'old')
    f.notify('turn/started', { threadId: THREAD_ID, turn: { id: 'two' } })
    expect(f.read()).toBeNull()
    f.notify('turn/completed', { threadId: THREAD_ID, turn: { id: 'one', status: 'completed' } })
    f.suggest('one', 'late')
    expect(f.read()).toBeNull()
    f.notify('turn/completed', { threadId: THREAD_ID, turn: { id: 'two', status: 'completed' } })
    f.suggest('two', 'new')
    expect(f.read()).toBe('new')
  })

  it.each(['failed', 'interrupted'])(
    'does not request for a %s turn or child thread',
    async (status) => {
      const f = await fixture()
      f.turn('child', 'completed', 'child-thread')
      f.turn('one', status)
      expect(f.connection.calls.filter((call) => call.method === REQUEST)).toHaveLength(0)
    }
  )

  it('invalidates suggestions before a new dispatch reaches the provider', async () => {
    const f = await fixture()
    f.turn('one')
    f.suggest('one', 'old')
    await f.adapter.dispatch({
      sessionId: 'session-1',
      fence: 7,
      clientMessageId: 'send-1',
      body: USER_MESSAGE,
      beforeDispatch: async () => {
        expect(f.read()).toBeNull()
        f.suggest('one', 'late')
        expect(f.read()).toBeNull()
      }
    })
    f.suggest('one', 'late again')
    expect(f.read()).toBeNull()
  })

  it.each([null, '', ' ', 42, 'x'.repeat(4097)])(
    'ignores invalid suggestion text (%#)',
    async (text) => {
      const f = await fixture()
      f.turn('one')
      f.suggest('one', text)
      expect(f.read()).toBeNull()
    }
  )

  it('clears failed predictions without adding a conversation row', async () => {
    const codex = fakeCodex()
    const adapter = adapterFor(codex)
    const sink = { appendItem: vi.fn(), appendTombstone: vi.fn(), publish: vi.fn() }
    await acquireReadyCodexForTest(adapter, {
      identity: identityFor('session-1'),
      fence: 7,
      spawnToken: 'spawn-9',
      events: sink
    })
    const notify = codex.connections[0].handlers.onNotification
    notify?.('turn/started', { threadId: THREAD_ID, turn: { id: 'one' } })
    notify?.('turn/completed', { threadId: THREAD_ID, turn: { id: 'one', status: 'completed' } })
    sink.appendItem.mockClear()
    sink.publish.mockClear()
    notify?.(UPDATED, {
      threadId: THREAD_ID,
      sourceTurnId: 'one',
      result: { type: 'completed', text: 'Add tests' }
    })
    expect(adapter.readPromptSuggestion('session-1')).toBe('Add tests')
    expect(sink.publish).toHaveBeenCalledOnce()
    notify?.(UPDATED, { threadId: THREAD_ID, sourceTurnId: 'one', result: { type: 'failed' } })
    expect(adapter.readPromptSuggestion('session-1')).toBeNull()
    expect(sink.appendItem).not.toHaveBeenCalled()
  })

  it.each([
    new CodexAppServerUnsupportedError('method not found'),
    new CodexAppServerRequestError(REQUEST, -32600, 'unknown variant `thread/prediction/request`')
  ])(
    'stops probing an unsupported connection but does not disable another connection (%#)',
    async (error) => {
      const route = vi.fn(() => {
        throw error
      })
      const f = await fixture(fakeCodex({ [REQUEST]: route }))
      f.turn('one')
      await Promise.resolve()
      f.turn('two')
      expect(route).toHaveBeenCalledTimes(1)
      expect(f.read()).toBeNull()
      const other = await fixture()
      other.turn('one')
      other.suggest('one', 'supported')
      expect(other.read()).toBe('supported')
    }
  )

  it('retries transient request errors on the next turn, never using an older result', async () => {
    let reject: (error: Error) => void = () => {}
    const route = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, rejectRequest) => {
            reject = rejectRequest
          })
      )
      .mockResolvedValue({})
    const f = await fixture(fakeCodex({ [REQUEST]: route }))
    f.turn('one')
    f.turn('two')
    f.suggest('two', 'current')
    reject(new Error('timeout'))
    await Promise.resolve()
    await Promise.resolve()
    expect(f.read()).toBe('current')
    expect(route).toHaveBeenCalledTimes(2)
  })

  it('requests a fresh suggestion when resuming at a completed turn', async () => {
    const codex = fakeCodex({
      'thread/resume': () => ({
        thread: { id: THREAD_ID, turns: [{ id: 'saved', status: 'completed', items: [] }] }
      })
    })
    const adapter = await acquired(codex, { resumeThreadId: THREAD_ID })
    expect(codex.connections[0].calls.filter((call) => call.method === REQUEST)).toEqual([
      {
        method: REQUEST,
        params: { threadId: THREAD_ID, sourceTurnId: 'saved' }
      }
    ])
    codex.connections[0].handlers.onNotification?.(UPDATED, {
      threadId: THREAD_ID,
      sourceTurnId: 'saved',
      result: { type: 'completed', text: 'Resume work' }
    })
    expect(adapter.readPromptSuggestion('session-1')).toBe('Resume work')
  })

  it('does not resurrect suggestions after the connection is closed', async () => {
    const f = await fixture()
    f.turn('one')
    f.connection.closed = true
    f.suggest('one', 'late')
    expect(f.read()).toBeNull()
  })

  it('ignores a successful completion and late suggestion after cancellation', async () => {
    const f = await fixture()
    f.notify('turn/started', { threadId: THREAD_ID, turn: { id: 'one' } })
    await f.adapter.cancelTurn({ sessionId: 'session-1', fence: 7 })
    f.notify('turn/completed', { threadId: THREAD_ID, turn: { id: 'one', status: 'completed' } })
    f.suggest('one', 'cancelled')
    expect(f.read()).toBeNull()
    expect(f.connection.calls.filter((call) => call.method === REQUEST)).toHaveLength(0)
  })

  it.each([false, true])(
    'restores paginated history without racing a new turn (race=%s)',
    async (race) => {
      let resolveHistory: (value: unknown) => void = () => {}
      const codex = fakeCodex({
        'thread/resume': () => ({ thread: { id: THREAD_ID, historyMode: 'paginated' } }),
        'thread/turns/list': () =>
          new Promise((resolve) => {
            resolveHistory = resolve
          })
      })
      const adapter = await acquired(codex, { resumeThreadId: THREAD_ID })
      const connection = codex.connections[0]
      expect(connection.calls.filter((call) => call.method === 'thread/turns/list')).toEqual([
        {
          method: 'thread/turns/list',
          params: { threadId: THREAD_ID, limit: 1, sortDirection: 'desc' }
        }
      ])
      if (race) {
        connection.handlers.onNotification?.('turn/started', {
          threadId: THREAD_ID,
          turn: { id: 'new' }
        })
      }
      resolveHistory({ data: [{ id: 'saved', status: 'completed' }] })
      await Promise.resolve()
      await Promise.resolve()
      expect(connection.calls.filter((call) => call.method === REQUEST)).toHaveLength(race ? 0 : 1)
      connection.handlers.onNotification?.(UPDATED, {
        threadId: THREAD_ID,
        sourceTurnId: 'saved',
        result: { type: 'completed', text: 'restored' }
      })
      expect(adapter.readPromptSuggestion('session-1')).toBe(race ? null : 'restored')
    }
  )
})
