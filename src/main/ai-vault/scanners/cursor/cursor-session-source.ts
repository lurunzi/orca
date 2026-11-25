import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AiVaultAgentSource } from '../../discovery/session-scanner-agent-sources'
import { pathSegments } from '../../discovery/session-file-discovery'
import { cursorChatMetaPath } from './session-scanner-cursor-chat-meta'
import { sessionRootDirs } from '../../discovery/session-scanner-roots'
import { SUBAGENT_DIR_NAME } from '../claude/session-scanner-subagent-transcripts'

const CURSOR_PROJECTS_DIR = join(homedir(), '.cursor', 'projects')

export const CURSOR_AGENT_SOURCE: AiVaultAgentSource = {
  rootDirs: (options, wslHomeDirs) =>
    sessionRootDirs(options.cursorProjectsDir ?? CURSOR_PROJECTS_DIR, wslHomeDirs, [
      '.cursor',
      'projects'
    ]),
  extensions: ['.jsonl'],
  filePredicate: (filePath) => pathSegments(filePath).includes('agent-transcripts'),
  contentDependencyPath: cursorChatMetaPath,
  // Fork: agent-transcripts/<parent>/subagents/*.jsonl are Task children, not top-level chats.
  directoryPredicate: (name) => name !== SUBAGENT_DIR_NAME
}
