import { describe, expect, it, vi } from 'vitest'
import { buildAiVaultResumeStartupForWorktree } from './ai-vault-resume-command'

vi.mock('@/lib/new-workspace', () => ({
  CLIENT_PLATFORM: 'darwin'
}))

type ResumableAgentState = Parameters<typeof buildAiVaultResumeStartupForWorktree>[0]['state']

function makeState(): ResumableAgentState {
  return {
    activeRepoId: 'repo-1',
    activeWorktreeId: 'repo-1::worktree-1',
    folderWorkspaces: [],
    projectGroups: [],
    repos: [{ id: 'repo-1', path: '/Users/ada/repo' }],
    projects: [{ id: 'repo-1', sourceRepoIds: ['repo-1'] }],
    settings: {
      agentDefaultArgs: { claude: '', codex: '' },
      agentDefaultEnv: { claude: {}, codex: {} }
    },
    worktreesByRepo: {
      'repo-1': [{ id: 'repo-1::worktree-1', repoId: 'repo-1', path: '/Users/ada/repo' }]
    }
    // SAFETY: the resume builder reads only these fields; the rest of AppState is irrelevant here.
  } as unknown as ResumableAgentState
}

describe('AI Vault resume for skill-launched Cursor', () => {
  it('carries the selected worker transcript into its own pane before hooks arrive', () => {
    const transcriptPath = '/Users/ada/.cursor/projects/worker/agent-transcripts/worker-id.jsonl'
    const startup = buildAiVaultResumeStartupForWorktree({
      state: makeState(),
      worktreeId: 'repo-1::worktree-1',
      session: {
        agent: 'cursor',
        sessionId: 'worker-id',
        filePath: transcriptPath,
        cwd: '/Users/ada/repo',
        codexHome: null
      }
    })
    expect(startup.providerSession).toEqual({
      key: 'conversation_id',
      id: 'worker-id',
      transcriptPath
    })
    expect(startup.launchConfig).toBeDefined()
    expect(startup.command).toContain("'--resume' 'worker-id'")
  })
})
