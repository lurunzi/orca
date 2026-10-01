import { RUNTIME_CAPABILITIES } from './protocol-version'

// Fork-added capabilities for the Cursor and Antigravity integrations.
export const AGENT_SESSION_CURSOR_RESUME_RUNTIME_CAPABILITY =
  'agent-session.cursor-resume.v1' as const

export const ANTIGRAVITY_VISIBLE_READINESS_RUNTIME_CAPABILITY =
  'terminal.antigravity-visible-readiness.v1' as const

export const ANTIGRAVITY_NATIVE_CHAT_RUNTIME_CAPABILITY = 'native-chat.antigravity.v1' as const
export const CURSOR_NATIVE_CHAT_RUNTIME_CAPABILITY = 'native-chat.cursor.v1' as const

export const STATUS_BAR_CURSOR_ITEM_RUNTIME_CAPABILITY = 'ui.status-bar-cursor'

export const AGENT_PROVIDER_RUNTIME_CAPABILITIES = [
  STATUS_BAR_CURSOR_ITEM_RUNTIME_CAPABILITY,
  ANTIGRAVITY_NATIVE_CHAT_RUNTIME_CAPABILITY,
  CURSOR_NATIVE_CHAT_RUNTIME_CAPABILITY,
  ANTIGRAVITY_VISIBLE_READINESS_RUNTIME_CAPABILITY,
  AGENT_SESSION_CURSOR_RESUME_RUNTIME_CAPABILITY
] as const

/** Everything this host advertises: upstream's list plus the fork's own capabilities. */
export const ADVERTISED_RUNTIME_CAPABILITIES = [
  ...RUNTIME_CAPABILITIES,
  ...AGENT_PROVIDER_RUNTIME_CAPABILITIES
] as const
