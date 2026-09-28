import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import type { StructuredSessionOrchestrationIdentityStatus } from '../../../../shared/structured-session-orchestration-identity'

export type UseNativeChatOrchestrationIdentityArgs = {
  sessionId: string
  target: RuntimeClientTarget
  isWorking?: boolean
  enabled?: boolean
}

export type NativeChatOrchestrationIdentity = {
  offered: boolean
  status: StructuredSessionOrchestrationIdentityStatus | null
  pending: boolean
  toggle: (checked: boolean) => Promise<void>
  refresh: () => Promise<void>
}

export function useNativeChatOrchestrationIdentity({
  sessionId,
  target,
  isWorking = false,
  enabled = true
}: UseNativeChatOrchestrationIdentityArgs): NativeChatOrchestrationIdentity {
  const api = typeof window !== 'undefined' ? window.api?.orchestrationIdentity : undefined
  // Why: structured identities are local-only; paired/remote runtimes cannot grant one.
  const offered = enabled && api !== undefined && target.kind === 'local'
  const [status, setStatus] = useState<StructuredSessionOrchestrationIdentityStatus | null>(null)
  const [pending, setPending] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (!offered || !api) {
      return
    }
    try {
      const next = await api.get(sessionId)
      if (mountedRef.current) {
        setStatus(next)
      }
    } catch {
      if (mountedRef.current) {
        setStatus({ state: 'unavailable', reason: 'missing' })
      }
    }
  }, [api, offered, sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh, isWorking])

  const toggle = async (checked: boolean): Promise<void> => {
    if (!offered) {
      return
    }
    setPending(true)
    try {
      const next = await api.set(sessionId, checked)
      if (mountedRef.current) {
        setStatus(next)
      }
    } catch (error: unknown) {
      toast.error(
        translate(
          'components.native-chat.orchestrationIdentity.updateFailed',
          'Could not change orchestration identity'
        ),
        { description: error instanceof Error ? error.message : String(error) }
      )
    } finally {
      if (mountedRef.current) {
        setPending(false)
      }
    }
  }

  return {
    offered,
    status,
    pending,
    toggle,
    refresh
  }
}
