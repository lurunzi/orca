import { OrcaRuntimeWithVisibleSnapshotPreview } from './terminal-visible-state'
import { isAntigravityCommandApprovalScreen } from '../../antigravity-command-approval-screen'
import { AntigravityScreenPermissionPublisher } from '../../antigravity-screen-permission-publisher'
import {
  classifyTerminalScreenReadiness,
  type TerminalScreenReadiness
} from '../../terminal-screen-readiness'

export abstract class OrcaRuntimeWithAntigravityScreenReadiness extends OrcaRuntimeWithVisibleSnapshotPreview {
  protected readonly antigravityScreenPermissions = new AntigravityScreenPermissionPublisher({
    baseline: (ptyId) => {
      const pty = this.ptysById.get(ptyId)
      if (!pty?.connected || pty.connectionId || !pty.paneKey) {
        return null
      }
      const terminalHandle = this.getAgentStatusTerminalHandleForPaneKey(pty.paneKey)
      const row = this.getAgentProviderSessionRowsForPaneFn?.(pty.paneKey)?.find(
        (candidate) =>
          candidate.providerSessionOnly !== true && candidate.agentType === 'antigravity'
      )
      // Native hooks identify the pane; the runtime owns its live terminal binding.
      return row && terminalHandle ? { ...row, terminalHandle } : null
    },
    readScreen: (ptyId) => this.readVisibleTerminalState(ptyId),
    isCurrent: (ptyId, screen) =>
      this.ptysById.get(ptyId)?.connected === true &&
      this.getPtyLivenessVerdict(ptyId)?.status !== 'unverifiable' &&
      screen.generation === this.getPtyLifecycleGeneration(ptyId) &&
      screen.sequence >= this.getPtyOutputSequence(ptyId) &&
      (!screen.headlessWriteChain ||
        screen.headlessWriteChain === this.headlessTerminals.get(ptyId)?.writeChain),
    publish: (event) => this.onTerminalScreenPermission?.(event) ?? false
  })

  protected getTerminalScreenReadiness(
    ptyId: string | null | undefined,
    retainedText: string
  ): TerminalScreenReadiness | null {
    const agent = this.getPaneAgentForTuiIdle(ptyId)
    if (
      !ptyId ||
      (agent ? agent !== 'antigravity' : !retainedText.toLowerCase().includes('antigravity cli'))
    ) {
      return null
    }
    if (this.getPtyLivenessVerdict(ptyId)?.status === 'unverifiable') {
      return { ready: false, blockedReason: null }
    }
    // Measured local grids use the shared rules, including their quiet and reflow gates.
    if (
      agent === 'antigravity' &&
      this.getTerminalSize(ptyId) &&
      !this.providerSnapshotPreferredPtys.has(ptyId)
    ) {
      const screen = this.readRuledScreen(ptyId)
      return screen && isAntigravityCommandApprovalScreen(screen.lines)
        ? { ready: false, blockedReason: 'agent-approval-prompt' }
        : null
    }
    const cached = this.providerVisibleStateByPtyId.get(ptyId)
    if (
      cached?.generation === this.getPtyLifecycleGeneration(ptyId) &&
      cached.sequence >= this.getPtyOutputSequence(ptyId) &&
      (!cached.headlessWriteChain ||
        cached.headlessWriteChain === this.headlessTerminals.get(ptyId)?.writeChain)
    ) {
      return classifyTerminalScreenReadiness({ tail: cached.lines, draft: cached.draft })
    }
    // A pending or unreachable screen cannot prove that typing is safe.
    void this.readVisibleTerminalState(ptyId).catch(() => {})
    return { ready: false, blockedReason: null }
  }
}
