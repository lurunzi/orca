import { OrcaRuntimeWithPreparePtyExecutionContext } from '../launch/terminal-execution-context'

export abstract class OrcaRuntimeWithAntigravityScreenPermissionSchedule extends OrcaRuntimeWithPreparePtyExecutionContext {
  protected abstract readonly antigravityScreenPermissions: { schedule(ptyId: string): void }

  protected scheduleAntigravityScreenPermission(ptyId: string): void {
    if (this.onTerminalScreenPermission) {
      this.antigravityScreenPermissions.schedule(ptyId)
    }
  }
}
