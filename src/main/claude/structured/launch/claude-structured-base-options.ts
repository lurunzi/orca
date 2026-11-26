import type { Options as ClaudeAgentSdkOptions } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudePermissionOptions } from './claude-structured-permission-options'
import type { claudeBotSessionOptions } from './claude-bot-session-options'
import { CLAUDE_DEFAULT_SETTING_SOURCES } from './claude-discovery-options'
export type ClaudeStructuredSdkOptions = Pick<
  ClaudeAgentSdkOptions,
  | 'includePartialMessages'
  | 'systemPrompt'
  | 'settingSources'
  | 'supportedDialogKinds'
  | 'additionalDirectories'
  | 'plugins'
  | 'model'
  | 'effort'
  | 'allowDangerouslySkipPermissions'
  | 'settings'
  | 'sessionId'
  | 'resume'
  | 'mcpServers'
  | 'resumeSessionAt'
  | 'forkSession'
> &
  ClaudePermissionOptions & { promptSuggestions?: boolean } & Awaited<
    ReturnType<typeof claudeBotSessionOptions>
  >

/** Replay acknowledgements require an explicit flag; the SDK supplies the other transport flags. */
export const CLAUDE_STRUCTURED_BASE_OPTIONS: ClaudeStructuredSdkOptions = {
  includePartialMessages: true,
  // Keep the SDK on Claude Code's own system-prompt contract.
  systemPrompt: { type: 'preset', preset: 'claude_code' },
  settingSources: [...CLAUDE_DEFAULT_SETTING_SOURCES],
  supportedDialogKinds: [],
  extraArgs: { 'replay-user-messages': null }
}
