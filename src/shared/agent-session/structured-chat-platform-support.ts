// Fork: Antigravity chats run on the host's agy where Google publishes no managed server (#30817).
const CHAT_UNAVAILABLE_PLATFORMS: Readonly<Record<string, readonly string[]>> = {}

/** The agent has no chat server Orca can run on this platform. */
export function structuredChatUnavailableOnPlatform(
  agent: string,
  platform: string | null | undefined
): boolean {
  return !!platform && (CHAT_UNAVAILABLE_PLATFORMS[agent]?.includes(platform) ?? false)
}
