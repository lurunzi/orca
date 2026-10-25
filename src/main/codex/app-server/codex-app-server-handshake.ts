import type { CodexAppServerConnection } from './codex-app-server-connection-types'
import { isProviderRecord as isAppServerRecord } from '../../provider-process/provider-json-record'
import { parseCliVersion } from '../../../shared/app-version'

/** The caller owns the bound; null leaves cancellation to its startup signal. */
export async function initializeCodexAppServerConnection(
  connection: CodexAppServerConnection,
  timeoutMs: number | null
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
    { timeoutMs }
  )
  connection.notify('initialized')
  const version =
    isAppServerRecord(result) && typeof result.userAgent === 'string'
      ? parseCliVersion(result.userAgent)
      : null
  connection.noteServerVersion?.(version)
  return version
}
