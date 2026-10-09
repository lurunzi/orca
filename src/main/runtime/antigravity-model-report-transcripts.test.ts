import { describe, expect, it } from 'vitest'
import { finalReplayFrame, readRuntimeFixture } from './agent-transcript-replay-test-harness'
import { HeadlessEmulator } from '../daemon/headless-emulator'
import { readAntigravityTerminalSessionOptions } from '../../shared/antigravity-terminal-session-options'

describe('Antigravity model reported by captured startup screens', () => {
  it.each(['antigravity-1-2-14-ready', 'antigravity-1-3-2-ready'])(
    'reads %s from the serialized snapshot used by native chat',
    async (name) => {
      const emulator = new HeadlessEmulator({ cols: 120, rows: 40 })
      try {
        await emulator.write(readRuntimeFixture(name))
        const snapshot = emulator.getSnapshot({ scrollbackRows: 0 })
        expect(
          readAntigravityTerminalSessionOptions(snapshot.snapshotAnsi, [
            { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', options: [] }
          ])
        ).toEqual({ model: 'gemini-3.8-flash-high' })
      } finally {
        emulator.dispose()
      }
    }
  )
  it.each([
    ['antigravity-1-2-14-ready', 120, 40],
    ['antigravity-1-3-2-ready', 120, 40],
    ['antigravity-1-2-14-ready-80x24', 80, 24]
  ] as const)(
    '%s names the actual model without a configured launch override',
    async (name, cols, rows) => {
      const frame = await finalReplayFrame(name, cols, rows)
      const screen = frame.screenLines.join('\n')
      expect(
        readAntigravityTerminalSessionOptions(screen, [
          { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', options: [] }
        ])
      ).toEqual({ model: 'gemini-3.8-flash-high' })
    }
  )
  it('does not treat conversation text or a startup spinner as a model', () => {
    expect(readAntigravityTerminalSessionOptions('Gemini 3.8 Flash (High)')).toBeNull()
    expect(readAntigravityTerminalSessionOptions('Signing in...')).toBeNull()
  })
})
