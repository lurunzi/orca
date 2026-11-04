import { describe, expect, it, vi } from 'vitest'
import { HeadlessEmulator } from '../daemon/headless-emulator'
import { observeAntigravityErrorTerminalStatus } from './antigravity-error-terminal-status'
import { createTranscriptPane, TRANSCRIPT_PANE_PTY_ID } from './agent-transcript-pane-test-harness'

const TEXT = 'Individual quota reached. Resets in 4h56m48s.'
const ID = '00000000-0000-4000-8000-000000000001-10'
const ERROR = `\x1b[?2026h⚠ ${TEXT}\r\nErrID: ${ID}\r\n>\x1b[?2026l`

describe('Antigravity native terminal errors', () => {
  it.each([1, 7, 8192])(
    'detects a completed error frame in %i-character chunks once',
    async (size) => {
      const emulator = new HeadlessEmulator({ cols: 80, rows: 24 })
      const detected: unknown[] = []
      try {
        for (let index = 0; index < ERROR.length; index += size) {
          const chunk = ERROR.slice(index, index + size)
          await emulator.write(chunk)
          const result = observeAntigravityErrorTerminalStatus(
            emulator,
            chunk,
            'antigravity',
            () => undefined
          )
          if (result) {
            detected.push(result)
          }
        }
        expect(detected).toEqual([
          expect.objectContaining({
            agentType: 'antigravity',
            state: 'done',
            lastAssistantMessage: `${TEXT}\nErrID: ${ID}`,
            lastAssistantMessageIsToolOutput: true,
            mainAgent: expect.objectContaining({ state: 'done', outcome: 'failure' })
          })
        ])
        await emulator.write(ERROR)
        expect(
          observeAntigravityErrorTerminalStatus(emulator, ERROR, 'antigravity', () => undefined)
        ).toBeNull()
      } finally {
        emulator.dispose()
      }
    }
  )

  it('does not scan ordinary output or errors inside OSC titles', async () => {
    const emulator = new HeadlessEmulator({ cols: 80, rows: 24 })
    const read = vi.spyOn(emulator, 'getVisibleLines')
    try {
      const title = `\x1b]0;⚠ ${TEXT} ErrID: ${ID}\x07`
      await emulator.write(title)
      expect(
        observeAntigravityErrorTerminalStatus(emulator, title, 'antigravity', () => undefined)
      ).toBeNull()
      expect(
        observeAntigravityErrorTerminalStatus(
          emulator,
          'ordinary output',
          'antigravity',
          () => undefined
        )
      ).toBeNull()
      expect(read).not.toHaveBeenCalled()
    } finally {
      emulator.dispose()
    }
  })

  it('does not settle a different agent or a newer hook turn', async () => {
    for (const previous of [
      { agentType: 'claude' as const, prompt: '' },
      { agentType: 'antigravity' as const, prompt: '', turnStartedAt: 100 }
    ]) {
      const emulator = new HeadlessEmulator({ cols: 80, rows: 24 })
      try {
        await emulator.write(ERROR)
        expect(
          observeAntigravityErrorTerminalStatus(emulator, ERROR, 'antigravity', () => previous, 100)
        ).toBeNull()
      } finally {
        emulator.dispose()
      }
    }
  })

  it('publishes the failure through the execution-host status pipeline', async () => {
    const onTerminalAgentStatus = vi.fn()
    const { runtime } = await createTranscriptPane(
      {
        paneTitle: 'Antigravity',
        foregroundProcess: 'agy',
        launchAgent: 'antigravity',
        data: ''
      },
      { onTerminalAgentStatus }
    )
    try {
      runtime.onPtyData(TRANSCRIPT_PANE_PTY_ID, ERROR, 1)
      await vi.waitFor(() =>
        expect(onTerminalAgentStatus).toHaveBeenCalledWith(
          expect.objectContaining({
            payload: expect.objectContaining({
              agentType: 'antigravity',
              lastAssistantMessage: `${TEXT}\nErrID: ${ID}`
            })
          })
        )
      )
    } finally {
      await runtime.onPtyExit(TRANSCRIPT_PANE_PTY_ID, 0)
    }
  })
})
