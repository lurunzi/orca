import { OrcaRuntimeWithPreparePtyExecutionContext } from '../launch/terminal-execution-context'
import type { RuntimeConstructionDependencies } from '../../construction/runtime-construction-dependencies'

type ScreenPermissionBinding = RuntimeConstructionDependencies['onTerminalScreenPermission']

export abstract class OrcaRuntimeWithAntigravityScreenPermissionSchedule extends OrcaRuntimeWithPreparePtyExecutionContext {
  declare protected readonly onTerminalScreenPermission: NonNullable<ScreenPermissionBinding> | null
  protected abstract readonly antigravityScreenPermissions: { schedule(ptyId: string): void }

  constructor(...args: ConstructorParameters<typeof OrcaRuntimeWithPreparePtyExecutionContext>) {
    super(...args)
    // Fork: the host binding lives on this fork-owned layer, out of the upstream constructor.
    this.onTerminalScreenPermission = args[2]?.onTerminalScreenPermission ?? null
  }

  protected scheduleAntigravityScreenPermission(ptyId: string): void {
    if (this.onTerminalScreenPermission) {
      this.antigravityScreenPermissions.schedule(ptyId)
    }
  }
}
