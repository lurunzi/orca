import { useCallback, useEffect, useRef, useState } from 'react'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type { ComputerAwakeMode } from '../../../../shared/computer-awake-mode'
import {
  optimisticRemoteComputerAwake,
  parseRemoteComputerAwake,
  type RemoteComputerAwake
} from './remote-computer-awake'

const REMOTE_AWAKE_TIMEOUT_MS = 15_000
const MENU_OPEN_POLL_MS = 5_000
const MENU_CLOSED_POLL_MS = 60_000
const LOADING: RemoteComputerAwake = { kind: 'loading' }

async function readRemoteComputerAwake(environmentId: string): Promise<RemoteComputerAwake> {
  try {
    return parseRemoteComputerAwake(
      await callRuntimeRpc<unknown>(
        { kind: 'environment', environmentId },
        'settings.get',
        undefined,
        {
          timeoutMs: REMOTE_AWAKE_TIMEOUT_MS,
          reuseRecentCompatibilityFailure: true
        }
      )
    )
  } catch {
    return { kind: 'unreachable' }
  }
}

/** One remote host's own awake setting, read and written over its runtime connection. */
export function useRemoteComputerAwake(
  environmentId: string | null,
  menuOpen: boolean
): {
  remote: RemoteComputerAwake
  /** Resolves false when the host did not take the mode. */
  setMode: (mode: ComputerAwakeMode) => Promise<boolean>
} {
  const [entry, setEntry] = useState<{ environmentId: string; value: RemoteComputerAwake } | null>(
    null
  )
  // Why: a write must outrank any read sent before it, or the old mode flashes back.
  const requestRef = useRef(0)

  useEffect(() => {
    if (!environmentId) {
      return
    }
    let cancelled = false
    const read = (): void => {
      const request = ++requestRef.current
      void readRemoteComputerAwake(environmentId).then((value) => {
        if (!cancelled && request === requestRef.current) {
          setEntry({ environmentId, value })
        }
      })
    }
    // Reads at once, pauses while the window is hidden and reads again when it comes back.
    const stopPolling = installWindowVisibilityInterval({
      run: read,
      intervalMs: menuOpen ? MENU_OPEN_POLL_MS : MENU_CLOSED_POLL_MS
    })
    return () => {
      cancelled = true
      stopPolling()
    }
  }, [environmentId, menuOpen])

  const remote = entry && entry.environmentId === environmentId ? entry.value : LOADING

  const setMode = useCallback(
    async (mode: ComputerAwakeMode): Promise<boolean> => {
      if (!environmentId) {
        return false
      }
      const request = ++requestRef.current
      setEntry((previous) => ({
        environmentId,
        value: optimisticRemoteComputerAwake(
          mode,
          previous?.environmentId === environmentId ? previous.value : LOADING
        )
      }))
      let value: RemoteComputerAwake
      let accepted = true
      try {
        value = parseRemoteComputerAwake(
          await callRuntimeRpc<unknown>(
            { kind: 'environment', environmentId },
            'settings.update',
            { computerAwakeMode: mode },
            { timeoutMs: REMOTE_AWAKE_TIMEOUT_MS }
          )
        )
      } catch {
        accepted = false
        // Why re-read: show what the host actually holds, not the mode it refused.
        value = await readRemoteComputerAwake(environmentId)
      }
      if (request === requestRef.current) {
        setEntry({ environmentId, value })
      }
      return accepted && value.kind === 'ready' && value.status.mode === mode
    },
    [environmentId]
  )

  return { remote, setMode }
}
