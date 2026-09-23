// Antigravity (agy) submit confirmation: read agy's framed composer off the
// terminal screen to tell whether a chat send's Enter actually submitted.

import { TUI_AGENT_CONFIG } from '../../../../shared/tui-agent-config'
import { countAgentTuiInputLines } from '../../../../shared/agent-tui-input-clear'
import { NATIVE_CHAT_SUBMIT_DELAY_MS } from '../../../../shared/native-chat-answer-stepping'
import { stripScrollbackAnsi } from './native-chat-scrape-fallback'
import type { NativeChatSendOptions } from './native-chat-runtime-send'

// agy draws its composer between two full-width rules: `────`, `> draft`, `────`.
const COMPOSER_RULE_LINE = /^\s*─{8,}\s*$/
const COMPOSER_PROMPT_LINE = /^\s*>\s?(.*)$/
const COLLAPSED_PASTE_LINE = /^↑\s*\d+\s+more lines?$/i

/** Quotes and `@` differ between the composer's file references and the raw paths. */
function normalizeComposerText(text: string): string {
  return text.replace(/["'@]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * True only when the screen shows agy's composer still holding text from `sent`.
 * An empty composer, a placeholder, other typed text, or any unrecognized screen
 * (dialog, picker, unreadable) is not evidence, so the caller never re-sends Enter.
 */
export function antigravityComposerHoldsDraft(
  screen: string | null | undefined,
  sent: string
): boolean {
  if (!screen) {
    return false
  }
  const lines = stripScrollbackAnsi(screen).split('\n')
  const rules: number[] = []
  lines.forEach((line, index) => {
    if (COMPOSER_RULE_LINE.test(line)) {
      rules.push(index)
    }
  })
  if (rules.length < 2) {
    return false
  }
  const body = lines.slice(rules.at(-2)! + 1, rules.at(-1)!)
  const prompt = COMPOSER_PROMPT_LINE.exec(body[0] ?? '')
  if (!prompt) {
    return false
  }
  const normalizedSent = normalizeComposerText(sent)
  const shown = [prompt[1]!, ...body.slice(1)]
    .map((line) => normalizeComposerText(line.replace(/^\s*>(?=\s|$)/, '')))
    .filter((line) => line !== '' && !COLLAPSED_PASTE_LINE.test(line))
  return shown.length > 0 && shown.every((line) => normalizedSent.includes(line))
}

/** Adds agy's paste-settle delay and post-Enter confirmation to a chat send. */
export function withAntigravitySubmitConfirmation(
  agent: string,
  sent: string,
  readScreen: (() => string | null | undefined) | undefined,
  options: NativeChatSendOptions | undefined
): NativeChatSendOptions | undefined {
  if (agent !== 'antigravity' || !readScreen) {
    return options
  }
  // agy expands long pastes line by line and swallows an Enter that lands mid-expansion.
  const lineSettleMs =
    (TUI_AGENT_CONFIG.antigravity.submitLineSettleMsPerLine ?? 0) * countAgentTuiInputLines(sent)
  return {
    ...options,
    submitConfirmation: {
      submitDelayMs: NATIVE_CHAT_SUBMIT_DELAY_MS + lineSettleMs,
      composerHoldsDraft: () => antigravityComposerHoldsDraft(readScreen(), sent)
    }
  }
}
