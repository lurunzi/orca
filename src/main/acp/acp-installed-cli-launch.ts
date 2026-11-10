import type { AgentCliVersionReader } from '../agent-launch/preflight/agent-cli-version-probe'

/** Launch fields for agents whose own installed CLI serves ACP (Cursor). */
export type AcpCliLaunchFields = {
  /** Replaces the plain `--version` read, e.g. to also prove the release serves ACP. */
  readVersion?: AgentCliVersionReader
  /** The agent cannot delete sessions, so helper sessions would stay in the user's own history. */
  keepsEverySession?: true
  /** Sent as `clientCapabilities._meta` when a chat initializes. */
  clientCapabilitiesMeta?: Readonly<Record<string, unknown>>
}
