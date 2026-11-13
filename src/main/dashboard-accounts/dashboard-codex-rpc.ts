import type { CodexAppServerConnection } from '../codex/app-server/codex-app-server-connection-types'

export type DashboardCodexRpc = Pick<
  CodexAppServerConnection,
  'request' | 'closed' | 'respond' | 'respondWithError'
>

export type DashboardCodexLifecycleOptions = {
  signal?: AbortSignal
  deadlineAt?: number
}
