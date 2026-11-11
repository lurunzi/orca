import type { AgentChatPermissionChoice } from '../../../../shared/agent-launch/permissions/agent-chat-permission-mode'
import type { CodexSandboxPolicy } from '../launch/codex-structured-sandbox-policy'

/** Provider facts from this acquisition, not another copy of the chat's selected mode. */
export type CodexSessionPermissions = {
  acquiredMode: AgentChatPermissionChoice
  appliedMode?: AgentChatPermissionChoice
  acquiredSandbox?: CodexSandboxPolicy
  launchSandboxIntact: boolean
  cwd: string
  visualsFolder?: string
  preparedMode?: AgentChatPermissionChoice
  preparedAuto?: CodexSandboxPolicy
}
