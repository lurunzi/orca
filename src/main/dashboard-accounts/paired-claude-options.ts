import { structuredLaunchSeedOptions } from '../../shared/native-chat/input/session-options/native-chat-session-option-defaults'
import { AGENT_CHAT_PERMISSION_MODE_OPTION_ID } from '../../shared/agent-launch/permissions/agent-chat-permission-mode-option-id'
import { pairedSubscriptionEnabled } from './paired-subscription-owner'

/** Both createSupport and the actual create must report the trusted process's permission mode. */
export function dashboardStructuredLaunchSeedOptions(
  ...args: Parameters<typeof structuredLaunchSeedOptions>
) {
  const defaults = structuredLaunchSeedOptions(...args)
  return args[1] === 'claude' && pairedSubscriptionEnabled()
    ? { ...defaults, [AGENT_CHAT_PERMISSION_MODE_OPTION_ID]: 'ask' }
    : defaults
}
