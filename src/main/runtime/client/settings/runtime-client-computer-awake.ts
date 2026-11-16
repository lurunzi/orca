import {
  computerAwakeSettingsForMode,
  type ComputerAwakeHostControl,
  type ComputerAwakeMode,
  type ComputerAwakeStatus
} from '../../../../shared/app-lifecycle/computer-awake-mode'

/** Fork: lets paired clients read and set the awake mode of the host they are connected to. */
export class RuntimeClientComputerAwake {
  private control: ComputerAwakeHostControl | undefined

  /** Only hosts that own an OS sleep assertion attach one; a plain Node daemon has none. */
  attach(control: ComputerAwakeHostControl): void {
    this.control = control
  }

  status(): { computerAwake?: ComputerAwakeStatus } {
    return this.control ? { computerAwake: this.control.getStatus() } : {}
  }

  /** The settings a requested mode writes; refuses before anything is written on a host without
   *  control. */
  settingsFor(
    mode: ComputerAwakeMode | undefined
  ): Partial<ReturnType<typeof computerAwakeSettingsForMode>> {
    if (mode === undefined) {
      return {}
    }
    if (!this.control) {
      throw new Error('computer_awake_unsupported')
    }
    return computerAwakeSettingsForMode(mode)
  }

  apply(mode: ComputerAwakeMode | undefined): void {
    if (mode !== undefined) {
      this.control?.setMode(mode)
    }
  }
}
