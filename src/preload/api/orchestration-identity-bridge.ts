import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import {
  ORCHESTRATION_IDENTITY_GET_CHANNEL,
  ORCHESTRATION_IDENTITY_SET_CHANNEL,
  type StructuredSessionOrchestrationIdentityStatus
} from '../../shared/structured-session-orchestration-identity'

export const orchestrationIdentityApi = {
  get: (sessionId: string): Promise<StructuredSessionOrchestrationIdentityStatus> =>
    ipcRenderer.invoke(ORCHESTRATION_IDENTITY_GET_CHANNEL, { sessionId }),
  set: (
    sessionId: string,
    enabled: boolean
  ): Promise<StructuredSessionOrchestrationIdentityStatus> =>
    ipcRenderer.invoke(ORCHESTRATION_IDENTITY_SET_CHANNEL, {
      sessionId,
      enabled
    })
} satisfies NonNullable<PreloadApi['orchestrationIdentity']>
