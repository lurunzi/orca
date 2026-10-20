import type { CodexAppServerConnection } from './codex-app-server-connection-types'
import { isProviderRecord as isAppServerRecord } from '../provider-process/provider-json-record'
import { parseCliVersion } from '../../shared/app-version'

const HANDSHAKE_TIMEOUT_MS = 15_000

export async function initializeCodexAppServerConnection(
  connection: CodexAppServerConnection
): Promise<string | null> {
  const result = await connection.request(
    'initialize',
    {
      clientInfo: { name: 'orca_desktop', title: 'Orca', version: '0.0.0' },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        mcpServerOpenaiFormElicitation: false,
        extensions: {}
      }
    },
    { timeoutMs: HANDSHAKE_TIMEOUT_MS }
  )
  connection.notify('initialized')
  const version =
    isAppServerRecord(result) && typeof result.userAgent === 'string'
      ? parseCliVersion(result.userAgent)
      : null
  connection.noteServerVersion?.(version)
  return version
}
