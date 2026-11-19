import {
  AGENT_TUI_CLEAR_MAX_LINES,
  countAgentTuiInputLines,
  buildAgentTuiClearInputForText
} from '../../../../../shared/agent-launch/startup/agent-tui-input-clear'
import { stripScrollbackAnsi } from '../session/terminal/assembly/native-chat-scrape-fallback'

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

type NativeChatInputLineSendOptions = {
  clearInput: string | null
  readInputLine: () => string | null | undefined
}

const tooTallToClear = (text: string | null | undefined): boolean =>
  text != null && countAgentTuiInputLines(text) > AGENT_TUI_CLEAR_MAX_LINES

/** Size the clear to what the agent's input line holds. */
export function resolveNativeChatInputLineSend(
  /** The user's text on the agent's input line: '' when it is empty, null when unreadable. */
  readInputLine: () => string | null | undefined
): NativeChatInputLineSendOptions {
  const draft = readInputLine()
  if (tooTallToClear(draft)) {
    return { clearInput: null, readInputLine }
  }
  return { clearInput: buildAgentTuiClearInputForText(draft), readInputLine }
}

/** Replace a parked launch draft, otherwise clear whatever the input line holds. */
export function resolveNativeChatLaunchDraftSend(args: {
  launchDraft: { agent: string; text: string } | null | undefined
  launchDraftResolved: boolean
  agent: string
  readInputLine: () => string | null | undefined
  /** The agent's screen, read to hold a replacement until its composer is painted. */
  readScreen?: () => string | null | undefined
}): {
  plan: NativeChatLaunchDraftSendPlan
  sendOptions: NativeChatInputLineSendOptions & { composerReady?: () => boolean }
} {
  const { launchDraft, launchDraftResolved, agent, readInputLine, readScreen } = args
  // A resolved prefill no longer owns TUI input; clearing again could erase the user’s replacement.
  const seededText =
    launchDraft && launchDraft.agent === agent && !launchDraftResolved ? launchDraft.text : null
  const plan = planNativeChatLaunchDraftSend({ seededText })
  const sendOptions = resolveNativeChatInputLineSend(readInputLine)
  if (plan.kind !== 'replace-draft' || sendOptions.clearInput === null) {
    return { plan, sendOptions }
  }
  if (tooTallToClear(seededText)) {
    return { plan, sendOptions: { clearInput: null, readInputLine } }
  }
  return {
    plan,
    sendOptions: {
      clearInput: plan.clearInput,
      readInputLine,
      // Why: a starting TUI discards input, then paints its --prefill draft;
      // an early send vanishes and the next one glues onto that draft.
      composerReady: () => {
        const screen = readScreen?.()
        return !screen || agentComposerPainted(screen)
      }
    }
  }
}
