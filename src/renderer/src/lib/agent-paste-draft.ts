import { waitForAntigravityDraftReady } from './antigravity-draft-readiness'
import { waitForAgentDraftInputReadyOnTab, waitForExpectedAgentOnPty } from './agent-draft-pty-wait'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { TuiAgent } from '../../../shared/tui-agent'
import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import { resolveDraftPasteReadyTimeoutMs } from '../../../shared/draft-paste-ready-timeout'
import { useAppStore } from '@/store'
import { sendRuntimePtyInputVerified } from '@/runtime/runtime-terminal-inspection'
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START
} from '@/components/terminal-pane/terminal-bracketed-paste'
import { runTerminalPtyInputTransaction } from '@/components/terminal-pane/terminal-pty-input-transaction'
import { waitForAgentReady } from './agent-ready-wait'
import { getSettingsForWorktreeRuntimeOwner } from './worktree-runtime-owner'
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
export const POST_PASTE_SUBMIT_DELAY_MS = 50

// PTY binding and composer readiness have separate budgets (STA-3367).
const PTY_SPAWN_TIMEOUT_MS = 8000

export function getSettingsForAgentTabRuntimeOwner(
  tabId: string
): Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined {
  const store = useAppStore.getState()
  for (const [worktreeId, tabs] of Object.entries(store.tabsByWorktree ?? {})) {
    if (tabs?.some((tab) => tab.id === tabId)) {
      // Why: legacy remote PTY ids may not embed their runtime owner. The tab's
      // worktree still identifies which host should receive readiness/send RPCs.
      return getSettingsForWorktreeRuntimeOwner(store, worktreeId)
    }
  }
  return store.settings
}

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
 *   2. Either ≥`BRACKETED_PASTE_QUIET_MS` of silence after the last byte of
 *      the post-handshake render burst, or Codex's composer prompt glyph.
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

  const readySignal = agentConfig?.draftPasteReadySignal ?? 'render-quiet-after-bracketed-paste'
  const settings = getSettingsForAgentTabRuntimeOwner(tabId)
  const readinessTimeoutMs = resolveDraftPasteReadyTimeoutMs(agent, timeoutMs)
  const readiness = await waitForAgentDraftInputReadyOnTab({
    tabId,
    // Windows Antigravity launches can bind their PTY after the ordinary eight-second budget.
    spawnTimeoutMs:
      agent === 'antigravity'
        ? Math.max(PTY_SPAWN_TIMEOUT_MS, readinessTimeoutMs)
        : PTY_SPAWN_TIMEOUT_MS,
    readinessTimeoutMs,
    agent,
    readySignal,
    settings
  })
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
    const fallbackReady = agentConfig
      ? await waitForAgentReady(tabId, agentConfig.expectedProcess, { timeoutMs: 1000 })
      : { ready: false }
    if (!fallbackReady.ready) {
      onTimeout?.()
      return false
    }
    // Why: the process merely exists -- its composer was never observed. On Windows this is
    // the ONLY path: ConPTY does not forward DECSET 2004, so no 2004-anchored ready signal
    // can ever fire. Callers must be able to tell this blind write apart from a real delivery.
    onUnconfirmedDelivery?.()
  }

  return await sendBracketedPasteToAgent({
    settings,
    ptyId,
    content,
    submit: submit === true,
    agent,
    hostPlatform: args.hostPlatform
  })
}

export async function pasteDraftToAgentPtyWhenReady(args: {
  tabId: string
  ptyId: string
  content: string
  agent?: TuiAgent
  submit?: boolean
  forcePaste?: boolean
  timeoutMs?: number
  onTimeout?: () => void
  onUnconfirmedDelivery?: () => void
}): Promise<boolean> {
  const {
    tabId,
    ptyId,
    content,
    agent,
    submit,
    forcePaste,
    timeoutMs,
    onTimeout,
    onUnconfirmedDelivery
  } = args
  const agentConfig = agent ? TUI_AGENT_CONFIG[agent] : null

  if (agentDeliversDraftViaNativePrefill(agent, forcePaste)) {
    return false
  }

  const settings = getSettingsForAgentTabRuntimeOwner(tabId)
  const readySignal = agentConfig?.draftPasteReadySignal ?? 'render-quiet-after-bracketed-paste'
  const budget = resolveDraftPasteReadyTimeoutMs(agent, timeoutMs)
  const ready =
    agent === 'antigravity'
      ? await waitForAntigravityDraftReady(tabId, ptyId, budget, settings)
      : await waitForAgentDraftInputReady(ptyId, budget, readySignal, settings)
  if (!ready) {
    if (agent === 'antigravity') {
      onTimeout?.()
      return false
    }
    const fallbackReady = agentConfig
      ? await waitForExpectedAgentOnPty(ptyId, agentConfig.expectedProcess, 1000, settings)
      : false
    if (!fallbackReady) {
      onTimeout?.()
      return false
    }
    onUnconfirmedDelivery?.()
  }

  return await sendBracketedPasteToAgent({
    settings,
    ptyId,
    content,
    submit: submit === true,
    agent
  })
}

export async function submitPromptToAgentPty(args: {
  tabId: string
  ptyId: string
  content: string
}): Promise<boolean> {
  return await sendBracketedPasteToAgent({
    settings: getSettingsForAgentTabRuntimeOwner(args.tabId),
    ptyId: args.ptyId,
    content: args.content,
    submit: true
  })
}

export async function sendBracketedPasteToRunningAgent(args: {
  ptyId: string
  content: string
}): Promise<boolean> {
  return await sendBracketedPasteToAgent({ ptyId: args.ptyId, content: args.content, submit: true })
}

async function sendBracketedPasteToAgent(args: {
  settings?: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null
  ptyId: string
  content: string
  submit: boolean
  agent?: TuiAgent
  hostPlatform?: NodeJS.Platform
}): Promise<boolean> {
  const { settings = useAppStore.getState().settings, ptyId, content, submit, agent } = args
  const submitRetryDelayMs = agent ? TUI_AGENT_CONFIG[agent]?.submitRetryDelayMs : undefined
  try {
    // Why: paste + Enter (+ retry Enter) must be one transaction, or a concurrent
    // paste on this PTY can slip between them and submit a half-written prompt.
    return await runTerminalPtyInputTransaction(ptyId, async () => {
      const newline =
        args.hostPlatform === 'win32' && agent
          ? TUI_AGENT_CONFIG[agent].windowsInputRecordPasteNewline
          : undefined
      const sent = await sendAgentDraftPasteContentNow(settings, ptyId, content, undefined, newline)
      if (!sent || !submit) {
        return sent
      }

      // Why: Claude Code can leave a prompt as editable text when paste-end and
      // Enter arrive in the same PTY write. Split the submit into the next turn so
      // the TUI processes bracketed-paste termination before handling Enter.
      await new Promise<void>((resolve) => window.setTimeout(resolve, POST_PASTE_SUBMIT_DELAY_MS))
      const submitted = await sendRuntimePtyInputVerified(settings, ptyId, '\r')

      if (submitRetryDelayMs !== undefined) {
        // Why: agents that render their composer before Enter is live silently eat
        // the first Enter; the retry is best-effort and never downgrades `submitted`.
        await new Promise<void>((resolve) => window.setTimeout(resolve, submitRetryDelayMs))
        try {
          await sendRuntimePtyInputVerified(settings, ptyId, '\r')
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
