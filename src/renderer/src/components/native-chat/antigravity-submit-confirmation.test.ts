import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Terminal } from '@xterm/headless'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sendRuntimePtyInput = vi.fn()
vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  sendRuntimePtyInput: (...args: unknown[]) => sendRuntimePtyInput(...args),
  sendRuntimePtyInputVerified: vi.fn()
}))

import {
  antigravityComposerHoldsDraft,
  withAntigravitySubmitConfirmation
} from './antigravity-submit-confirmation'
import {
  NATIVE_CHAT_CLEAR_UNSUBMITTED_INPUT,
  NATIVE_CHAT_SUBMIT_DELAY_MS,
  resetNativeChatPtySendQueuesForTests,
  sendNativeChatMessage
} from './native-chat-runtime-send'
import {
  NATIVE_CHAT_SUBMIT_CONFIRM_MS,
  NATIVE_CHAT_SUBMIT_RETRY_MAX
} from './native-chat-submit-confirmation'
import { sendNativeChatMessageWithImageAttachments } from './native-chat-runtime-image-send'
import { NATIVE_CHAT_SUBMIT } from './native-chat-send'

const RULE = '─'.repeat(120)
const HEADER = ['      ▄▀▀▄        Antigravity CLI 1.2.8', '─'.repeat(60)]
const FOOTER = '? for shortcuts                                        Gemini 3.8 Flash · high'

function screen(composer: string[], transcript: string[] = []): string {
  return [...HEADER, ...transcript, RULE, ...composer, RULE, FOOTER].join('\n')
}

async function capturedScreen(name: string): Promise<string> {
  const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
  try {
    const transcript = readFileSync(
      join(__dirname, '../../../../main/runtime/__fixtures__', `${name}.txt`),
      'utf8'
    )
    await new Promise<void>((resolve) => terminal.write(transcript, resolve))
    const buffer = terminal.buffer.active
    return Array.from(
      { length: terminal.rows },
      (_, row) => buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? ''
    ).join('\n')
  } finally {
    terminal.dispose()
  }
}

describe('antigravityComposerHoldsDraft on real agy captures', () => {
  const PSEUDO = 'In about 80 words, explain what a pseudoterminal is.'
  it.each([
    ['antigravity-composer-multiline-unsent', 'abc\n>', true],
    ['antigravity-busy-mid-turn', PSEUDO, false],
    ['antigravity-busy-turn-ended', PSEUDO, false],
    ['antigravity-ready-plan-127', 'hello', false],
    ['antigravity-dialog-model-picker', 'hello', false]
  ] as const)('%s holds the draft: %s', async (name, sent, holds) => {
    expect(antigravityComposerHoldsDraft(await capturedScreen(name), sent)).toBe(holds)
  })
})

describe('antigravityComposerHoldsDraft', () => {
  it('reports the sent text still sitting in the composer', () => {
    expect(
      antigravityComposerHoldsDraft(screen(['> explain this repo']), 'explain this repo')
    ).toBe(true)
  })

  it('treats an empty composer as submitted even though the prompt echoes above it', () => {
    const submitted = screen(['>'], ['> explain this repo', '⣟  Generating...'])
    expect(antigravityComposerHoldsDraft(submitted, 'explain this repo')).toBe(false)
  })

  it('matches wrapped and collapsed multi-line drafts', () => {
    const sent = 'first line\nsecond line that is long\nthird'
    expect(
      antigravityComposerHoldsDraft(
        screen(['> first line', '  second line that', '  is long', '  ↑ 1 more line']),
        sent
      )
    ).toBe(true)
  })

  it('never claims a placeholder, other text, or an unrecognised screen', () => {
    const sent = 'explain this repo'
    expect(
      antigravityComposerHoldsDraft(
        screen(['> Plan mode: research & plan only (shift+tab to cycle)']),
        sent
      )
    ).toBe(false)
    expect(antigravityComposerHoldsDraft(screen(['> something else']), sent)).toBe(false)
    expect(antigravityComposerHoldsDraft('Select a model\n  Gemini 3.8 Flash', sent)).toBe(false)
    expect(antigravityComposerHoldsDraft(null, sent)).toBe(false)
  })

  it('matches image references regardless of quoting', () => {
    expect(
      antigravityComposerHoldsDraft(
        screen(['> @"C:\\Users\\me\\shot 1.png" what is this']),
        'C:\\Users\\me\\shot 1.png what is this'
      )
    ).toBe(true)
  })
})

describe('Antigravity chat send confirmation', () => {
  const SETTINGS: Parameters<typeof sendNativeChatMessage>[0] = null
  const PTY = 'pty-agy'

  beforeEach(() => {
    vi.useFakeTimers()
    sendRuntimePtyInput.mockClear()
    resetNativeChatPtySendQueuesForTests()
  })
  afterEach(() => {
    resetNativeChatPtySendQueuesForTests()
    vi.useRealTimers()
  })

  const enters = (): number =>
    sendRuntimePtyInput.mock.calls.filter((call) => call[2] === NATIVE_CHAT_SUBMIT).length

  it('leaves other agents on the plain delayed Enter', () => {
    const options = withAntigravitySubmitConfirmation('claude', 'hi', () => '', undefined)
    expect(options).toBeUndefined()
  })

  it('re-sends Enter while the composer still holds the draft, then stops', async () => {
    let current = screen(['> hi'])
    const options = withAntigravitySubmitConfirmation('antigravity', 'hi', () => current, undefined)
    const handle = sendNativeChatMessage(SETTINGS, PTY, 'hi', options)
    vi.advanceTimersByTime(NATIVE_CHAT_SUBMIT_DELAY_MS + 45)
    expect(enters()).toBe(1)
    vi.advanceTimersByTime(NATIVE_CHAT_SUBMIT_CONFIRM_MS)
    expect(enters()).toBe(2)
    current = screen(['>'], ['> hi'])
    vi.advanceTimersByTime(NATIVE_CHAT_SUBMIT_CONFIRM_MS)
    expect(enters()).toBe(2)
    await handle.settled
  })

  it('gives up after the retry budget without clearing the draft', async () => {
    const options = withAntigravitySubmitConfirmation(
      'antigravity',
      'hi',
      () => screen(['> hi']),
      undefined
    )
    const handle = sendNativeChatMessage(SETTINGS, PTY, 'hi', options)
    vi.advanceTimersByTime(NATIVE_CHAT_SUBMIT_DELAY_MS + 45 + NATIVE_CHAT_SUBMIT_CONFIRM_MS * 10)
    expect(enters()).toBe(1 + NATIVE_CHAT_SUBMIT_RETRY_MAX)
    await handle.settled
  })

  it('does not Ctrl+U the line when cancelled after Enter was written', () => {
    const options = withAntigravitySubmitConfirmation(
      'antigravity',
      'hi',
      () => screen(['> hi']),
      undefined
    )
    const handle = sendNativeChatMessage(SETTINGS, PTY, 'hi', options)
    vi.advanceTimersByTime(NATIVE_CHAT_SUBMIT_DELAY_MS + 45)
    sendRuntimePtyInput.mockClear()
    handle.cancel()
    vi.advanceTimersByTime(NATIVE_CHAT_SUBMIT_CONFIRM_MS * 10)
    expect(sendRuntimePtyInput.mock.calls.map((call) => call[2])).not.toContain(
      NATIVE_CHAT_CLEAR_UNSUBMITTED_INPUT
    )
    expect(enters()).toBe(0)
  })

  it('confirms image sends too', async () => {
    let current = screen(['> @/tmp/a.png look'])
    const options = withAntigravitySubmitConfirmation(
      'antigravity',
      '/tmp/a.png look',
      () => current,
      undefined
    )
    const handle = sendNativeChatMessageWithImageAttachments(
      'antigravity',
      SETTINGS,
      PTY,
      'look',
      ['/tmp/a.png'],
      options
    )
    await vi.advanceTimersByTimeAsync(2_000)
    expect(enters()).toBeGreaterThanOrEqual(2)
    current = screen(['>'])
    await vi.advanceTimersByTimeAsync(NATIVE_CHAT_SUBMIT_CONFIRM_MS * 10)
    await handle.settled
  })
})
