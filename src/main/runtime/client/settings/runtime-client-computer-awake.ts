import {
  computerAwakeSettingsForMode,
  type ComputerAwakeHostControl,
  type ComputerAwakeMode,
  type ComputerAwakeStatus
} from '../../../../shared/app-lifecycle/computer-awake-mode'
import { RuntimeClientSettingsController } from './runtime-client-settings'
import type {
  RuntimeClientSettings,
  RuntimeClientSettingsUpdate
} from './runtime-client-settings-shape'

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

/** Fork: the client settings controller, plus this host's awake mode for paired clients. */
export class RuntimeClientSettingsWithComputerAwake extends RuntimeClientSettingsController {
  readonly computerAwake = new RuntimeClientComputerAwake()

  override get(): RuntimeClientSettings {
    return { ...super.get(), ...this.computerAwake.status() }
  }

  override async update(updates: RuntimeClientSettingsUpdate): Promise<RuntimeClientSettings> {
    const { computerAwakeMode, ...others } = updates
    // Refuses before anything is written; the mode's settings land in the same write.
    const awake = this.computerAwake.settingsFor(computerAwakeMode)
    const merged: RuntimeClientSettingsUpdate = { ...others, ...awake }
    await super.update(merged)
    this.computerAwake.apply(computerAwakeMode)
    return this.get()
  }
}
