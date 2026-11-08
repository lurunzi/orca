import type { AgentCliVersionReader } from '../agent-launch/preflight/agent-cli-version-probe'
import { ANTIGRAVITY_ACP_RUNTIME } from '../antigravity/antigravity-acp-runtime'
import { antigravityCliLaunchSpec } from '../antigravity/antigravity-cli-acp-launch-spec'
import type { AcpLaunchSpec } from './acp-launch-specs'

/** Launch fields for agents whose own installed CLI serves ACP (Cursor, agy). */
export type AcpCliLaunchFields = {
  /** Replaces the plain `--version` read, e.g. to also prove the release serves ACP. */
  readVersion?: AgentCliVersionReader
  /** The agent cannot delete sessions, so helper sessions would stay in the user's own history. */
  keepsEverySession?: true
  /** Sent as `clientCapabilities._meta` when a chat initializes. */
  clientCapabilitiesMeta?: Readonly<Record<string, unknown>>
}

// Hosts with no managed build run the installed agy CLI's ACP server instead.
export function antigravityHostLaunchSpec(managed: AcpLaunchSpec): AcpLaunchSpec {
  return ANTIGRAVITY_ACP_RUNTIME.pin() === null ? antigravityCliLaunchSpec(managed) : managed
}
