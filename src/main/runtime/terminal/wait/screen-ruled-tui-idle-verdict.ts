import type { TerminalScreenReadiness } from '../../terminal-screen-readiness'
import {
  evaluateTuiIdle,
  type TuiIdleEvaluationInput,
  type TuiIdleVerdict
} from './tui-idle-evidence'
import { ptyTuiIdleEvidence, type TuiIdleEvidenceSource } from './tui-idle-evidence-source'
import type { RuntimePtyWorktreeRecord } from '../records/runtime-terminal-state-records'

/**
 * A pane whose current screen is authoritative (Antigravity) settles from that screen alone.
 * Not-ready maps to `working` so neither the screen-blocked read nor the quiet-foreground
 * lane can settle it from the line tail the screen already overruled.
 */
export function screenReadinessVerdict(
  screen: TerminalScreenReadiness | null | undefined
): TuiIdleVerdict | null {
  if (!screen) {
    return null
  }
  if (screen.blockedReason) {
    return { kind: 'blocked', reason: screen.blockedReason }
  }
  return screen.ready ? { kind: 'ready-strong' } : { kind: 'working' }
}

/** The agent's own status report (OSC 7501 or hooks) outranks the screen; the screen rules panes without one. */
export function screenRuledTuiIdleVerdict(
  screen: TerminalScreenReadiness | null | undefined,
  input: TuiIdleEvaluationInput
): TuiIdleVerdict {
  return (input.firstPartyStatus ? null : screenReadinessVerdict(screen)) ?? evaluateTuiIdle(input)
}

/** The pane's tui-idle verdict, its screen first, read through one evidence source. */
export function ptyScreenRuledTuiIdleVerdict(
  source: TuiIdleEvidenceSource,
  pty: RuntimePtyWorktreeRecord,
  readWaitText: () => string,
  extra: Partial<TuiIdleEvaluationInput> = {}
): TuiIdleVerdict {
  return screenRuledTuiIdleVerdict(source.getScreenReadiness?.(pty.ptyId, readWaitText()), {
    ...ptyTuiIdleEvidence(source, pty, readWaitText),
    ...extra
  })
}
