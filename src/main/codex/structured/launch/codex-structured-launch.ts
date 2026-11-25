import type { CodexStructuredPermissionPolicy } from '../../../../shared/agent-launch/permissions/codex-permission-policy'
import type { NativeChatVisualsLaunch } from '../../../native-chat/conversation-files/native-chat-visuals-delivery'
import type { CodexBotLaunchOptions } from './codex-bot-launch-options'

export type CodexStructuredLaunch = CodexBotLaunchOptions & {
  prefixArgs?: readonly string[]
  command: string
  args: string[]
  cwd: string
  codexHome: string | null
  resumeThreadId: string | null
  /** Replace an unsaved thread created by this session; never supersede a proven resume. */
  supersedeIfUnsaved?: boolean
  permissionPolicy?: CodexStructuredPermissionPolicy
  /** Open on the chosen model to avoid a first-turn switch. */
  model?: string
  /** Sealed child environment; envToDelete removes inherited keys. */
  env?: Record<string, string>
  envToDelete?: readonly string[]
  /** Command values that must survive the user's shell environment policy. */
  commandEnv?: Record<string, string>
  visuals?: NativeChatVisualsLaunch
  /** What this launch's `codex --version` reported, when it could be read. */
  codexVersion?: string
  /** Launched through the user's Command setting rather than the stock CLI. */
  customCommand?: boolean
}
