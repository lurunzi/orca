import { waitForAntigravityDraftReady } from './antigravity-draft-readiness'
import { waitForAgentDraftInputReadyOnTab, waitForExpectedAgentOnPty } from './agent-draft-pty-wait'
import type { TuiAgent } from '../../../shared/tui-agent'
import type { TerminalInputKind } from '../../../shared/terminal-input-kind'
import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import { AGENT_PROMPT_POST_PASTE_SUBMIT_DELAY_MS } from '../../../shared/agent-prompt-injection'
import { resolveDraftPasteReadyTimeoutMs } from '../../../shared/draft-paste-ready-timeout'
import { resolvePasteReadySignal } from '../../../shared/draft-paste-ready-scanner'
import { sendRuntimePtyInputVerified } from '@/runtime/runtime-terminal-verified-input'
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START
} from '@/components/terminal-pane/terminal-bracketed-paste'
import { runTerminalPtyInputTransaction } from '@/components/terminal-pane/terminal-pty-input-transaction'
import { waitForAgentReady } from './agent-ready-wait'
import { sendAgentDraftPasteContentNow } from './agent-draft-paste-content'
import { agentDeliversDraftViaNativePrefill } from './agent-native-draft-prefill'
import { waitForAgentDraftInputReady } from './agent-draft-readiness'
export {
  AGENT_DRAFT_PASTE_CHUNK_MAX_BYTES,
  AGENT_DRAFT_PASTE_DIRECT_MAX_BYTES,
  AGENT_DRAFT_PASTE_MAX_BYTES,
  chunkAgentDraftPasteContent,
  iterateAgentDraftPasteContentChunks,
  sendAgentDraftPasteContent
} from './agent-draft-paste-content'

// Why: bracketed paste markers let modern TUIs (Claude Code / Codex / Pi /
// OpenCode / Gemini / cursor-agent / copilot) treat the inserted text as a
// single atomic paste instead of echoing character-by-character or triggering
// line-edit shortcuts. Callers choose whether to append Enter after the paste.
export const BRACKETED_PASTE_BEGIN = BRACKETED_PASTE_START
export { BRACKETED_PASTE_END }
export const POST_PASTE_SUBMIT_DELAY_MS = AGENT_PROMPT_POST_PASTE_SUBMIT_DELAY_MS

// PTY binding and composer readiness have separate budgets (STA-3367).
const PTY_SPAWN_TIMEOUT_MS = 8000

/**
 * Wait until the agent on `tabId` has rendered its input-accepting TUI,
 * then bracketed-paste `content` into its input buffer. By default the
 * draft stays editable; `submit: true` appends Enter after the paste.
 *
 * Returns true when the paste was issued, false on timeout or missing
 * PTY. `onTimeout` lets the caller surface a UI hint (e.g. toast) when
 * the agent doesn't reach a ready state. `timeoutMs` overrides the
 * readiness budget only; waiting for the PTY to spawn keeps its own budget.
 *
 * Readiness combines DECSET 2004 with one agent-specific follow-up signal:
 *   1. `\x1b[?2004h` (DECSET 2004 — bracketed-paste-enable) on the PTY
 *      output. This is the protocol-level "I accept bracketed paste"
 *      handshake.
 *   2. The agent's composer-ready signal, or its configured quiet window.
 */
export async function pasteDraftWhenAgentReady(args: {
  tabId: string
  content: string
  agent?: TuiAgent
  submit?: boolean
  forcePaste?: boolean
  hostPlatform?: NodeJS.Platform
  timeoutMs?: number
  onTimeout?: () => void
  onUnconfirmedDelivery?: () => void
  /** The launch pane's PTY once its spawn says the agent started there; null when it didn't. */
  launchPty?: Promise<string | null>
}): Promise<boolean> {
  const { tabId, content, agent, submit, forcePaste, timeoutMs, onTimeout, onUnconfirmedDelivery } =
    args

  const agentConfig = agent ? TUI_AGENT_CONFIG[agent] : null

  // Why: agents with a native draft prefill mechanism (flag or env var)
  // launch with the URL already in their input box. Pasting again would
  // duplicate it. Callers should not invoke this helper for those agents;
  // the early return guards against accidental double-injection if a stale
  // call slips through.
  if (agentDeliversDraftViaNativePrefill(agent, forcePaste)) {
    return false
  }

  const readySignal = resolvePasteReadySignal(agentConfig, submit === true)
  const readinessTimeoutMs = resolveDraftPasteReadyTimeoutMs(agent, timeoutMs)
  const readinessResult = waitForAgentDraftInputReadyOnTab({
    tabId,
    // Windows Antigravity launches can bind their PTY after the ordinary eight-second budget.
    spawnTimeoutMs:
      agent === 'antigravity'
        ? Math.max(PTY_SPAWN_TIMEOUT_MS, readinessTimeoutMs)
        : PTY_SPAWN_TIMEOUT_MS,
    readinessTimeoutMs,
    agent,
    readySignal,
    ...(args.launchPty ? { launchPty: args.launchPty } : {})
  })
  // Why: a pane that didn't start is the caller's own outcome to report, not a readiness timeout.
  if (args.launchPty && !(await args.launchPty)) {
    return false
  }
  const readiness = await readinessResult
  if (!readiness) {
    onTimeout?.()
    return false
  }

  const { ptyId } = readiness
  if (!readiness.ready) {
    if (agent === 'antigravity') {
      onTimeout?.()
      return false
    }
    // Why: fast-starting TUIs can emit the paste-ready escape sequence before
    // this sidecar subscription attaches. If process/title inspection says the
    // launched agent owns the PTY, fall back to a best-effort paste instead of
    // silently dropping generated prompts.
    // A running Codex can still own a startup dialog or discard provisional input.
    const fallbackReady =
      agentConfig && agent !== 'codex'
        ? await waitForAgentReady(tabId, agentConfig.expectedProcess, { timeoutMs: 1000 })
        : { ready: false }
    if (!fallbackReady.ready) {
      onTimeout?.()
      return false
    }
    // Why: the process merely exists -- its composer was never observed (e.g. the readiness
    // budget expired mid-startup, #22479). Callers must be able to tell this blind write apart
    // from a real delivery.
    onUnconfirmedDelivery?.()
  }

  return await sendBracketedPasteToAgent({
    ptyId,
    content,
    submit: submit === true,
    agent,
    hostPlatform: args.hostPlatform,
    // Why launch: this delivers the prompt or draft an agent is started with.
    inputKind: 'launch'
  })
}

export async function pasteDraftToAgentPtyWhenReady(args: {
  /** Antigravity's host readiness resolves the pane through its tab. */
  tabId?: string
  ptyId: string
  content: string
  agent?: TuiAgent
  submit?: boolean
  forcePaste?: boolean
  timeoutMs?: number
  onTimeout?: () => void
  onUnconfirmedDelivery?: () => void
}): Promise<boolean> {
  const { ptyId, content, agent, submit, forcePaste, timeoutMs, onTimeout, onUnconfirmedDelivery } =
    args
  const agentConfig = agent ? TUI_AGENT_CONFIG[agent] : null

  if (agentDeliversDraftViaNativePrefill(agent, forcePaste)) {
    return false
  }

  const readySignal = resolvePasteReadySignal(agentConfig, submit === true)
  const budget = resolveDraftPasteReadyTimeoutMs(agent, timeoutMs)
  const ready =
    agent === 'antigravity'
      ? await waitForAntigravityDraftReady(args.tabId, ptyId, budget)
      : await waitForAgentDraftInputReady(ptyId, budget, readySignal)
  if (!ready) {
    if (agent === 'antigravity') {
      onTimeout?.()
      return false
    }
    // A running Codex can still own a startup dialog or discard provisional input.
    const fallbackReady =
      agentConfig && agent !== 'codex'
        ? await waitForExpectedAgentOnPty(ptyId, agentConfig.expectedProcess, 1000)
        : false
    if (!fallbackReady) {
      onTimeout?.()
      return false
    }
    onUnconfirmedDelivery?.()
  }

  return await sendBracketedPasteToAgent({
    ptyId,
    content,
    submit: submit === true,
    agent,
    // Why launch: this delivers the prompt or draft an agent is started with.
    inputKind: 'launch'
  })
}

export async function submitPromptToAgentPty(args: {
  tabId: string
  ptyId: string
  content: string
}): Promise<boolean> {
  return await sendBracketedPasteToAgent({
    ptyId: args.ptyId,
    content: args.content,
    submit: true,
    inputKind: 'driving'
  })
}

export async function sendBracketedPasteToRunningAgent(args: {
  ptyId: string
  content: string
}): Promise<boolean> {
  return await sendBracketedPasteToAgent({ ...args, submit: true, inputKind: 'driving' })
}

async function sendBracketedPasteToAgent(args: {
  ptyId: string
  content: string
  submit: boolean
  agent?: TuiAgent
  hostPlatform?: NodeJS.Platform
  inputKind: TerminalInputKind
}): Promise<boolean> {
  const { ptyId, content, submit, agent } = args
  const { inputKind } = args
  const submitRetryDelayMs = agent ? TUI_AGENT_CONFIG[agent]?.submitRetryDelayMs : undefined
  try {
    // Why: paste + Enter (+ retry Enter) must be one transaction, or a concurrent
    // paste on this PTY can slip between them and submit a half-written prompt.
    return await runTerminalPtyInputTransaction(ptyId, async () => {
      const newline =
        args.hostPlatform === 'win32' && agent
          ? TUI_AGENT_CONFIG[agent].windowsInputRecordPasteNewline
          : undefined
      const pasted = await sendAgentDraftPasteContentNow(
        ptyId,
        content,
        inputKind,
        undefined,
        newline
      )
      if (!pasted || !submit) {
        return pasted
      }

      // Why: Claude Code can leave a prompt as editable text when paste-end and
      // Enter arrive in the same PTY write. Split the submit into the next turn so
      // the TUI processes bracketed-paste termination before handling Enter.
      await new Promise<void>((resolve) => window.setTimeout(resolve, POST_PASTE_SUBMIT_DELAY_MS))
      const submitted = await sendRuntimePtyInputVerified(ptyId, '\r', inputKind)

      if (submitRetryDelayMs !== undefined) {
        // Why: agents that render their composer before Enter is live silently eat
        // the first Enter; the retry is best-effort and never downgrades `submitted`.
        await new Promise<void>((resolve) => window.setTimeout(resolve, submitRetryDelayMs))
        try {
          await sendRuntimePtyInputVerified(ptyId, '\r', inputKind)
        } catch {
          // Why: a rejected retry leaves the first Enter's verdict untouched.
        }
      }

      return submitted
    })
  } catch {
    return false
  }
}
