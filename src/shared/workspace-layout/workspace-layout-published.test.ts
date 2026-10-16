import { describe, expect, it } from 'vitest'
import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../execution-host'
import { loadWorkspaceLayout } from './workspace-layout-load'
import { localDesktopSession } from './workspace-layout-profile.test-fixture'
import { publishWorkspaceLayout } from './workspace-layout-published'
import { nameBasedLoadContext } from './workspace-layout-minted-ids'
import { checkLayoutRoundTrip } from './workspace-layout-round-trip-check'
import { GIT_KEY, leaf } from './workspace-layout-session.test-fixture'
import { workspaceLayoutFromPublished } from './workspace-layout-from-published'
import { saveWorkspaceLayout } from './workspace-layout-save'

function published() {
  const { layout } = loadWorkspaceLayout(
    LOCAL_EXECUTION_HOST_ID,
    localDesktopSession(),
    nameBasedLoadContext()
  )
  return { layout, workspace: publishWorkspaceLayout(layout.workspaces[GIT_KEY]!, 'local') }
}

describe('publishWorkspaceLayout: the explicit published projection', () => {
  it.each([null, 'ssh-host'])(
    'keeps transcript tabs through save and publish on %s',
    (environment) => {
      const session = localDesktopSession()
      const entry = session.unifiedTabs![GIT_KEY]!.find((tab) => tab.id === 'agent-session-1')!
      entry.agentTranscript = {
        agent: 'cursor',
        sessionId: 'cursor-session',
        transcriptPath: '/workspace/session.jsonl',
        runtimeEnvironmentId: environment
      }
      const loaded = loadWorkspaceLayout(LOCAL_EXECUTION_HOST_ID, session, nameBasedLoadContext())
      const saved = saveWorkspaceLayout(loaded)
      expect(
        saved.unifiedTabs![GIT_KEY]!.find((tab) => tab.id === entry.id)?.agentTranscript
      ).toEqual(entry.agentTranscript)
      const published = publishWorkspaceLayout(loaded.layout.workspaces[GIT_KEY]!, 'local')
      expect(
        workspaceLayoutFromPublished(published).tabs.find((tab) => tab.id === entry.id)
          ?.agentTranscript
      ).toEqual(entry.agentTranscript)
    }
  )

  it('publishes tabs and panes in the one tab order, without runtime records or legacy bits', () => {
    const { workspace } = published()
    expect(workspace.groups).toEqual([
      { id: 'group-a', tabIds: ['tab-shell', 'tab-agent', 'editor:src/app.ts'] },
      { id: 'group-b', tabIds: ['browser-1', 'agent-session-1', 'tab-unbound'] }
    ])
    expect(workspace.tabs.map((tab) => tab.id)).toEqual([
      'tab-shell',
      'tab-agent',
      'editor:src/app.ts',
      'browser-1',
      'agent-session-1',
      'tab-unbound'
    ])
    const agent = workspace.tabs[1]!
    expect(agent).toMatchObject({ entityId: 'term-agent', customTitle: 'Agent', isPinned: true })
    expect(agent.terminal).toEqual({
      root: { type: 'leaf', leafId: leaf(3) },
      panes: [{ leafId: leaf(3), ptyId: `${GIT_KEY}@@aaaa0003` }],
      chatLeafId: leaf(3),
      defaultTitle: 'Terminal 2',
      launchAgent: 'claude'
    })
    // A tab's launch inputs are published, so a window mounting it starts the same shell.
    expect(workspace.tabs[5]!.terminal).toMatchObject({
      startupCwd: '/Users/dev/orca/src',
      shellOverride: 'zsh'
    })
    const json = JSON.stringify(workspace)
    for (const internal of [
      'incarnationId',
      'inc-3',
      'sleeping',
      'providerSession',
      'closedTerminalTabs',
      'terminalRowOwners',
      'topologyRevision',
      'dirtyDraftContent',
      'activeLeafId',
      'activeTabId'
    ]) {
      expect(json).not.toContain(internal)
    }
  })

  it('names the host that runs each tab: an editor tab its file owner, else the partition', () => {
    const { layout } = published()
    const git = layout.workspaces[GIT_KEY]!
    git.editorFiles = git.editorFiles!.map((file) => ({ ...file, externalSshTargetId: 'box' }))
    const tabs = publishWorkspaceLayout(git, 'local').tabs
    expect(tabs.find((tab) => tab.kind === 'editor')?.executionHostId).toBe(
      toSshExecutionHostId('box')
    )
    expect(tabs.find((tab) => tab.kind === 'terminal')?.executionHostId).toBe('local')
  })
})

describe('checkLayoutRoundTrip', () => {
  it('finds nothing in data today’s writers leave', () => {
    expect(checkLayoutRoundTrip(LOCAL_EXECUTION_HOST_ID, localDesktopSession())).toEqual({
      findings: [],
      firstLoadChanges: {}
    })
  })

  it('reports a session the Loader cannot read, without throwing', () => {
    const session = localDesktopSession()
    // A corrupt row, as an older build could leave.
    session.tabsByWorktree[GIT_KEY] = JSON.parse('[null]')
    expect(checkLayoutRoundTrip(LOCAL_EXECUTION_HOST_ID, session).findings).toEqual([
      { kind: 'threw', message: expect.any(String) }
    ])
  })
})
