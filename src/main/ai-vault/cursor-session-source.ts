import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveAbsoluteDirOverride } from '../../shared/absolute-dir-override'
import type { AiVaultAgentSource } from './session-scanner-agent-sources'
import { pathSegments } from './session-file-discovery'
import { cursorChatMetaPath } from './scanners/cursor/session-scanner-cursor-chat-meta'
import {
  CURSOR_ACP_SESSIONS_DIR,
  cursorAcpStoreDependencyPath,
  isCursorAcpSessionMetaPath
} from './session-scanner-cursor-acp-parser'
import { sessionRootDirs } from './session-scanner-roots'
import { SUBAGENT_DIR_NAME } from './scanners/claude/session-scanner-subagent-transcripts'

const CURSOR_PROJECTS_DIR = join(homedir(), '.cursor', 'projects')
// Chats follow CURSOR_CONFIG_DIR as the launch does; ones started before it was set stay in ~/.cursor.
const CURSOR_ACP_SESSIONS_ROOTS = [
  ...new Set([
    resolveAbsoluteDirOverride(process.env.CURSOR_CONFIG_DIR, join(homedir(), '.cursor')),
    join(homedir(), '.cursor')
  ])
].map((configDir) => join(configDir, CURSOR_ACP_SESSIONS_DIR))

/** Terminal chats write agent-transcripts; `cursor-agent acp` chats write acp-sessions. */
export const CURSOR_AGENT_SOURCE: AiVaultAgentSource = {
  // Projects roots stay first: transcript lookups read the first root.
  rootDirs: (options, wslHomeDirs) => [
    ...sessionRootDirs(options.cursorProjectsDir ?? CURSOR_PROJECTS_DIR, wslHomeDirs, [
      '.cursor',
      'projects'
    ]),
    // Local only: the ACP parser opens store.db synchronously, which a WSL share cannot serve safely.
    ...(options.cursorAcpSessionsDir
      ? [options.cursorAcpSessionsDir]
      : options.cursorProjectsDir
        ? []
        : CURSOR_ACP_SESSIONS_ROOTS)
  ],
  extensions: ['.jsonl', '.json'],
  filePredicate: (filePath) =>
    isCursorAcpSessionMetaPath(filePath) ||
    (filePath.endsWith('.jsonl') && pathSegments(filePath).includes('agent-transcripts')),
  contentDependencyPath: (filePath) =>
    isCursorAcpSessionMetaPath(filePath)
      ? cursorAcpStoreDependencyPath(filePath)
      : cursorChatMetaPath(filePath),
  // agent-transcripts/<parent>/subagents/*.jsonl are Task children, not top-level chats.
  directoryPredicate: (name) => name !== SUBAGENT_DIR_NAME
}
