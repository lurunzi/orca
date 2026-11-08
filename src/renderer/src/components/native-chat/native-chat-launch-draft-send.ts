import {
  AGENT_TUI_CLEAR_MAX_LINES,
  countAgentTuiInputLines,
  buildAgentTuiClearInputForText
} from '../../../../shared/agent-launch/startup/agent-tui-input-clear'
import { stripScrollbackAnsi } from './native-chat-scrape-fallback'

export type NativeChatLaunchDraftSendPlan =
  /** Input line holds a stale injected draft — replace it, clearing every line. */
  | { kind: 'replace-draft'; clearInput: string; seededText: string }
  /** No injected draft is parked on the line; keep the ordinary send path. */
  | { kind: 'default' }

/** Prompt glyphs both supported agent TUIs draw at the start of the input line. */
const COMPOSER_PROMPT_LINE = /^\s*([❯›])\s?(.*)$/
const CODEX_FOOTER_LINE = /^\s*\S.*\s[·•]\s.*$/
/** Claude's composer rule; lenient because Claude can draw labels into it. */
const CLAUDE_FRAME_RULE_START = /^\s*─{3,}/

/** Whether the agent painted its composer: a prompt row closed by Claude's frame or Codex's footer; a shell ❯ prompt has none. */
export function agentComposerPainted(screen: string | null | undefined): boolean {
  if (!screen) {
    return false
  }
  const lines = stripScrollbackAnsi(screen).split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = COMPOSER_PROMPT_LINE.exec(lines[index]!)
    if (!match) {
      continue
    }
    const closing = match[1] === '❯' ? CLAUDE_FRAME_RULE_START : CODEX_FOOTER_LINE
    return lines.slice(index + 1).some((line) => closing.test(line))
  }
  return false
}

/** Visual wrapping loses logical lines, so replace from the composer copy rather than trusting a screen match. */
export function planNativeChatLaunchDraftSend(args: {
  /** Text Orca injected into the TUI line, or null when nothing is parked there. */
  seededText: string | null | undefined
}): NativeChatLaunchDraftSendPlan {
  const seededText = args.seededText
  if (!seededText || seededText.trim() === '') {
    return { kind: 'default' }
  }
  return {
    kind: 'replace-draft',
    clearInput: buildAgentTuiClearInputForText(seededText),
    seededText
  }
}

/** Select replacement clearing and optional confirmation for the normal send paths. */
export function resolveNativeChatLaunchDraftSend(args: {
  launchDraft: { agent: string; text: string } | null | undefined
  launchDraftResolved: boolean
  agent: string
  /** The user's text on the agent's input line: '' when it is empty, null when unreadable. */
  readInputLine: () => string | null | undefined
  /** The agent's screen, read to hold a replacement until its composer is painted. */
  readScreen?: () => string | null | undefined
}): {
  plan: NativeChatLaunchDraftSendPlan
  sendOptions: {
    clearInput: string | null
    confirmCleared?: () => boolean
    composerReady?: () => boolean
  }
} {
  const { launchDraft, launchDraftResolved, agent, readInputLine, readScreen } = args
  // A resolved prefill no longer owns TUI input; clearing again could erase the user’s replacement.
  const seededText =
    launchDraft && launchDraft.agent === agent && !launchDraftResolved ? launchDraft.text : null
  const plan = planNativeChatLaunchDraftSend({ seededText })
  const draft = readInputLine()
  if (
    [draft, seededText].some(
      (text) => text != null && countAgentTuiInputLines(text) > AGENT_TUI_CLEAR_MAX_LINES
    )
  ) {
    return { plan, sendOptions: { clearInput: null } }
  }
  if (plan.kind !== 'replace-draft') {
    return { plan, sendOptions: { clearInput: buildAgentTuiClearInputForText(draft) } }
  }
  return {
    plan,
    sendOptions: {
      clearInput: plan.clearInput,
      // A dim placeholder or suggestion is not residue; only typed text is.
      confirmCleared: () => readInputLine() === '',
      // Why: a starting TUI discards input, then paints its --prefill draft;
      // an early send vanishes and the next one glues onto that draft.
      composerReady: () => {
        const screen = readScreen?.()
        return !screen || agentComposerPainted(screen)
      }
    }
  }
}
