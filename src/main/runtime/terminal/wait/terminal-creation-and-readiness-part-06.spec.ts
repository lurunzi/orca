import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import '../../construction/test-context/runtime-test-module-registration.spec'
import { OrcaRuntimeService } from '../../orca-runtime'
import {
  TEST_WORKTREE_ID,
  TEST_WORKTREE_PATH,
  store
} from '../../construction/test-context/orca-runtime-test-fixtures.spec'

const antigravityCapturedReady = readFileSync(
  join(__dirname, '..', '..', '__fixtures__', 'antigravity-ready-default-127.txt'),
  'utf8'
)

describe('OrcaRuntimeService', () => {
  it('does not treat a Codex launch title as tui-idle readiness', async () => {
    vi.useFakeTimers()
    try {
      const runtime = new OrcaRuntimeService(store)
      const serializeProviderBuffer = vi.fn().mockResolvedValue({
        data: 'OpenAI Codex\r\nmodel: gpt-5.5\r\ndirectory: /repo\r\n',
        cols: 80,
        rows: 24,
        seq: 1
      })
      runtime.setPtyController({
        spawn: vi.fn().mockResolvedValue({ id: 'pty-bg' }),
        write: () => true,
        kill: () => true,
        getForegroundProcess: async () => null,
        serializeProviderBuffer
      })
      const { handle } = await runtime.createTerminal(`path:${TEST_WORKTREE_PATH}`)

      runtime.attachWindow(1)
      await runtime.syncWindowGraph(1, {
        tabs: [
          {
            tabId: 'tab-bg',
            worktreeId: TEST_WORKTREE_ID,
            title: 'Codex YOLO',
            activeLeafId: 'pane-bg',
            layout: null
          }
        ],
        leaves: [
          {
            tabId: 'tab-bg',
            worktreeId: TEST_WORKTREE_ID,
            leafId: 'pane-bg',
            paneRuntimeId: 1,
            ptyId: 'pty-bg',
            paneTitle: null
          }
        ]
      })

      const waitPromise = runtime.waitForTerminal(handle, {
        condition: 'tui-idle',
        timeoutMs: 1_000
      })
      const timeoutAssertion = expect(waitPromise).rejects.toThrow('timeout')

      await vi.advanceTimersByTimeAsync(2_000)

      await timeoutAssertion
      expect(serializeProviderBuffer).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves tui-idle from an Antigravity ready prompt preview', async () => {
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({
      spawn: vi.fn().mockResolvedValue({ id: 'pty-bg' }),
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })
    const { handle } = await runtime.createTerminal(`path:${TEST_WORKTREE_PATH}`)
    runtime.seedHeadlessTerminal('pty-bg', '\x1b[0m', { cols: 120, rows: 40 })
    runtime.onPtyData('pty-bg', antigravityCapturedReady, Date.now())

    await expect(
      runtime.waitForTerminal(handle, { condition: 'tui-idle', timeoutMs: 3_500 })
    ).resolves.toMatchObject({
      handle,
      condition: 'tui-idle',
      status: 'running'
    })
  })

  it('resolves Antigravity ready prompts with newline-heavy pasted tails without splitting', async () => {
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({
      spawn: vi.fn().mockResolvedValue({ id: 'pty-bg' }),
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })
    const { handle } = await runtime.createTerminal(`path:${TEST_WORKTREE_PATH}`)
    let pastedTail = ''
    for (let index = 0; index < 90; index += 1) {
      pastedTail += `${'pasted text '.repeat(25)}${index}\n`
    }
    const splitSpy = vi.spyOn(String.prototype, 'split')

    runtime.seedHeadlessTerminal('pty-bg', '\x1b[0m', { cols: 120, rows: 40 })
    runtime.onPtyData('pty-bg', [pastedTail, antigravityCapturedReady].join(''), Date.now())

    await expect(
      runtime.waitForTerminal(handle, { condition: 'tui-idle', timeoutMs: 3_500 })
    ).resolves.toMatchObject({
      handle,
      condition: 'tui-idle',
      satisfied: true,
      status: 'running'
    })
    const splitReadyTail = splitSpy.mock.contexts.some((context) => {
      const value = typeof context === 'string' ? context : String(context)
      return (
        value.toLowerCase().includes('antigravity cli') && value.includes('pasted text pasted text')
      )
    })
    expect(splitReadyTail).toBe(false)
  })

  it('resolves tui-idle after retained trust text is replaced by a captured Antigravity screen', async () => {
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({
      spawn: vi.fn().mockResolvedValue({ id: 'pty-bg' }),
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })
    const { handle } = await runtime.createTerminal(`path:${TEST_WORKTREE_PATH}`)
    runtime.seedHeadlessTerminal('pty-bg', '\x1b[0m', { cols: 120, rows: 40 })
    runtime.onPtyData(
      'pty-bg',
      [
        'Do you trust this workspace directory?\n',
        'Press t to trust\n',
        antigravityCapturedReady
      ].join(''),
      Date.now()
    )

    await expect(
      runtime.waitForTerminal(handle, { condition: 'tui-idle', timeoutMs: 3_500 })
    ).resolves.toMatchObject({
      handle,
      condition: 'tui-idle',
      satisfied: true,
      status: 'running'
    })
  })

  it('resolves live-leaf tui-idle from an Antigravity ready prompt preview', async () => {
    const runtime = new OrcaRuntimeService(store)
    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, {
      tabs: [
        {
          tabId: 'tab-1',
          worktreeId: TEST_WORKTREE_ID,
          title: 'Terminal',
          activeLeafId: 'pane:1',
          layout: null
        }
      ],
      leaves: [
        {
          tabId: 'tab-1',
          worktreeId: TEST_WORKTREE_ID,
          leafId: 'pane:1',
          paneRuntimeId: 1,
          ptyId: 'pty-1',
          paneTitle: null
        }
      ]
    })
    runtime.seedHeadlessTerminal('pty-1', '\x1b[0m', { cols: 120, rows: 40 })
    runtime.onPtyData('pty-1', antigravityCapturedReady, Date.now())
    const [terminal] = (await runtime.listTerminals()).terminals

    await expect(
      runtime.waitForTerminal(terminal.handle, { condition: 'tui-idle', timeoutMs: 3_500 })
    ).resolves.toMatchObject({
      handle: terminal.handle,
      condition: 'tui-idle',
      status: 'running'
    })
  })

  it('resolves tui-idle when a stale Codex prompt is followed by Antigravity readiness', async () => {
    const runtime = new OrcaRuntimeService(store)
    runtime.setPtyController({
      spawn: vi.fn().mockResolvedValue({ id: 'pty-bg' }),
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })
    const { handle } = await runtime.createTerminal(`path:${TEST_WORKTREE_PATH}`)
    runtime.seedHeadlessTerminal('pty-bg', '\x1b[0m', { cols: 120, rows: 40 })
    runtime.onPtyData(
      'pty-bg',
      [
        'Do you trust this workspace directory?\n',
        'Press t to trust\n',
        antigravityCapturedReady,
        '\n'
      ].join(''),
      Date.now()
    )

    await expect(
      runtime.waitForTerminal(handle, { condition: 'tui-idle', timeoutMs: 3_500 })
    ).resolves.toMatchObject({
      handle,
      condition: 'tui-idle',
      satisfied: true,
      status: 'running'
    })
  })
})
