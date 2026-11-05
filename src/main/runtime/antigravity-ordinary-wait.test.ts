import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTranscriptPane,
  TRANSCRIPT_PANE_PTY_ID,
  waitForTranscriptIdle
} from './agent-transcript-pane-test-harness'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

function capture(name: string): string {
  const raw = readFileSync(join(__dirname, '__fixtures__', `${name}.txt`), 'utf8')
  const teardown =
    name === 'antigravity-dialog-trust-workspace' ? raw.lastIndexOf('\x1b[?1049l') : -1
  // Replay the recorded live dialog before capture shutdown leaves its alternate screen.
  return teardown === -1 ? raw : raw.slice(0, teardown)
}

function eventAt(): number {
  const time = vi.getMockedSystemTime()
  if (!time) {
    throw new Error('Transcript events require the fixture clock')
  }
  return time.getTime()
}

describe('Antigravity ordinary waits use the current screen', () => {
  beforeEach(() =>
    vi.useFakeTimers({
      now: 1_700_000_000_000,
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
    })
  )
  afterEach(() => vi.useRealTimers())

  it.each([
    ['antigravity-ready-default-127', true],
    ['antigravity-ready-plan-127', true],
    ['antigravity-ready-accept-edits-127', true],
    ['antigravity-plan-hint-as-draft-127', false],
    ['antigravity-composer-multiline-unsent', false],
    ['antigravity-dialog-model-picker', false],
    ['antigravity-busy-mid-turn', false]
  ] as const)('%s ready=%s', async (name, ready) => {
    const { runtime, handle } = await createTranscriptPane({
      paneTitle: 'agy',
      foregroundProcess: 'agy',
      data: ''
    })
    runtime.seedHeadlessTerminal(TRANSCRIPT_PANE_PTY_ID, '\x1b[0m', { cols: 120, rows: 40 })
    runtime.onPtyData(TRANSCRIPT_PANE_PTY_ID, capture(name), eventAt())
    const waiting = waitForTranscriptIdle({ runtime, handle }, 3500)
    await (ready
      ? expect(waiting).resolves.toMatchObject({ satisfied: true })
      : expect(waiting).rejects.toThrow('timeout'))
  })

  it('forgets a trust dialog after the real ready-screen redraw', async () => {
    const { runtime, handle } = await createTranscriptPane({
      paneTitle: 'agy',
      foregroundProcess: 'agy',
      data: ''
    })
    runtime.seedHeadlessTerminal(TRANSCRIPT_PANE_PTY_ID, '\x1b[0m', { cols: 120, rows: 40 })
    runtime.onPtyData(
      TRANSCRIPT_PANE_PTY_ID,
      capture('antigravity-dialog-trust-workspace'),
      eventAt()
    )
    await expect(waitForTranscriptIdle({ runtime, handle }, 3500)).resolves.toMatchObject({
      satisfied: false,
      blockedReason: 'agent-trust-workspace'
    })
    runtime.onPtyData(TRANSCRIPT_PANE_PTY_ID, capture('antigravity-ready-default-127'), eventAt())
    await expect(waitForTranscriptIdle({ runtime, handle }, 3500)).resolves.toMatchObject({
      satisfied: true
    })
  })

  it('invalidates a ready screen before draft output finishes parsing', async () => {
    const { runtime, handle } = await createTranscriptPane({
      paneTitle: 'agy',
      foregroundProcess: 'agy',
      data: ''
    })
    runtime.seedHeadlessTerminal(TRANSCRIPT_PANE_PTY_ID, '\x1b[0m', { cols: 120, rows: 40 })
    runtime.onPtyData(TRANSCRIPT_PANE_PTY_ID, capture('antigravity-ready-plan-127'), eventAt())
    await expect(waitForTranscriptIdle({ runtime, handle }, 3500)).resolves.toMatchObject({
      satisfied: true
    })
    runtime.onPtyData(
      TRANSCRIPT_PANE_PTY_ID,
      capture('antigravity-plan-hint-as-draft-127'),
      eventAt()
    )
    await expect(waitForTranscriptIdle({ runtime, handle }, 2500)).rejects.toThrow('timeout')
  })

  it('invalidates a ready screen when the terminal grid reflows', async () => {
    const { runtime, handle } = await createTranscriptPane({
      paneTitle: 'agy',
      foregroundProcess: 'agy',
      data: ''
    })
    runtime.seedHeadlessTerminal(TRANSCRIPT_PANE_PTY_ID, '\x1b[0m', { cols: 120, rows: 40 })
    runtime.onPtyData(TRANSCRIPT_PANE_PTY_ID, capture('antigravity-ready-plan-127'), eventAt())
    await expect(waitForTranscriptIdle({ runtime, handle }, 3500)).resolves.toMatchObject({
      satisfied: true
    })
    runtime.reflowHeadlessTerminalToPtyGrid(TRANSCRIPT_PANE_PTY_ID, 20, 40)
    await expect(waitForTranscriptIdle({ runtime, handle }, 2500)).rejects.toThrow('timeout')
  })

  it('rechecks queued delivery after a draft becomes an empty composer', async () => {
    const { runtime, handle } = await createTranscriptPane({
      paneTitle: 'agy',
      foregroundProcess: 'agy',
      size: { cols: 120, rows: 40 },
      data: ''
    })
    runtime.onPtyData(
      TRANSCRIPT_PANE_PTY_ID,
      capture('antigravity-plan-hint-as-draft-127'),
      eventAt()
    )
    await expect(waitForTranscriptIdle({ runtime, handle }, 3500)).rejects.toThrow('timeout')
    runtime.terminalRunFacts.recordInput(TRANSCRIPT_PANE_PTY_ID, 'driving', 'unsent draft')
    runtime.onPtyData(TRANSCRIPT_PANE_PTY_ID, '\x1b]7501;state=done:app=antigravity\x07', eventAt())
    const deliver = vi
      .spyOn(runtime['orchestrationMailboxNotifications'], 'deliverForTerminal')
      .mockImplementation(() => {})
    vi.spyOn(runtime['orchestrationMailboxNotifications'], 'hasDeliverableMail').mockReturnValue(
      true
    )
    expect(runtime['checkDeliverySettledAndArmRecheck'](TRANSCRIPT_PANE_PTY_ID)).toBe(false)
    expect(deliver).not.toHaveBeenCalled()
    runtime.onPtyData(TRANSCRIPT_PANE_PTY_ID, capture('antigravity-ready-plan-127'), eventAt())
    await vi.waitFor(() => expect(deliver).toHaveBeenCalled(), { timeout: 4500 })
  })

  it('does not reuse a ready screen after the execution host becomes unverifiable', async () => {
    const { runtime, handle } = await createTranscriptPane({
      paneTitle: 'agy',
      foregroundProcess: 'agy',
      data: '',
      connectionId: 'ssh-host'
    })
    runtime.seedHeadlessTerminal(TRANSCRIPT_PANE_PTY_ID, '\x1b[0m', { cols: 120, rows: 40 })
    runtime.onPtyData(TRANSCRIPT_PANE_PTY_ID, capture('antigravity-ready-default-127'), eventAt())
    await expect(waitForTranscriptIdle({ runtime, handle }, 3500)).resolves.toMatchObject({
      satisfied: true
    })
    runtime.markPtyLivenessUnverifiable(TRANSCRIPT_PANE_PTY_ID, 'SSH transport disconnected')
    await expect(waitForTranscriptIdle({ runtime, handle }, 2500)).rejects.toThrow('timeout')
    expect(runtime.getPtyLivenessVerdict(TRANSCRIPT_PANE_PTY_ID)?.status).toBe('unverifiable')
  })
})
