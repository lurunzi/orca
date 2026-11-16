import {
  COMPUTER_AWAKE_MODES,
  type ComputerAwakeMode,
  type ComputerAwakeStatus
} from '../../../../shared/app-lifecycle/computer-awake-mode'

/** What this client knows about one remote host's own awake setting. */
export type RemoteComputerAwake =
  | { kind: 'loading' }
  | { kind: 'ready'; status: ComputerAwakeStatus }
  // The host answered without the setting: an older build, or a daemon with no sleep to hold off.
  | { kind: 'unsupported' }
  | { kind: 'unreachable' }

const TARGET_STORAGE_KEY = 'orca.computerAwake.targetEnvironmentId'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Reads the host's status out of a `settings.get` / `settings.update` result. */
export function parseRemoteComputerAwake(result: unknown): RemoteComputerAwake {
  const settings = isRecord(result) ? result.settings : null
  const status = isRecord(settings) ? settings.computerAwake : null
  if (!isRecord(status)) {
    return { kind: 'unsupported' }
  }
  const mode = COMPUTER_AWAKE_MODES.find((candidate) => candidate === status.mode)
  return mode
    ? { kind: 'ready', status: { mode, active: status.active === true } }
    : { kind: 'unsupported' }
}

/** Shown until the host confirms; only Agent mode depends on something this client cannot see. */
export function optimisticRemoteComputerAwake(
  mode: ComputerAwakeMode,
  previous: RemoteComputerAwake
): RemoteComputerAwake {
  const wasActive = previous.kind === 'ready' && previous.status.active
  return {
    kind: 'ready',
    status: { mode, active: mode === 'on' || (mode === 'auto' && wasActive) }
  }
}

/** Local first, then each connected host in order, then back to local. */
export function nextComputerAwakeTargetId(
  currentId: string | null,
  remoteHostIds: readonly string[]
): string | null {
  const index = currentId === null ? -1 : remoteHostIds.indexOf(currentId)
  return remoteHostIds[index + 1] ?? null
}

export function readStoredComputerAwakeTargetId(): string | null {
  try {
    return window.localStorage.getItem(TARGET_STORAGE_KEY) || null
  } catch {
    return null
  }
}

export function storeComputerAwakeTargetId(environmentId: string | null): void {
  try {
    if (environmentId === null) {
      window.localStorage.removeItem(TARGET_STORAGE_KEY)
    } else {
      window.localStorage.setItem(TARGET_STORAGE_KEY, environmentId)
    }
  } catch {
    // The choice still holds for this window.
  }
}
