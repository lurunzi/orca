import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('external Cursor input survives tab switches and failed continuation', async ({
  orcaPage,
  electronApp,
  testRepoPath
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await electronApp.evaluate(({ ipcMain }, cwd) => {
    ipcMain.removeHandler('nativeChat:readSession')
    ipcMain.removeHandler('aiVault:listSessions')
    ipcMain.removeHandler('aiVault:prepareSessionResume')
    ipcMain.removeAllListeners('nativeChat:subscribe')
    ipcMain.handle('nativeChat:readSession', () => ({
      messages: [
        {
          id: 'response',
          role: 'assistant',
          source: 'transcript',
          timestamp: 1,
          blocks: [{ type: 'text', text: 'External Cursor response' }]
        }
      ],
      hasMore: false
    }))
    ipcMain.handle('aiVault:listSessions', (_event, args: { scopePaths?: string[] }) => ({
      sessions: [
        {
          id: 'cursor:external',
          agent: 'cursor',
          sessionId: 'external',
          executionHostId: 'local',
          cwd: args?.scopePaths?.[0] ?? cwd,
          filePath: '/fixture/external.jsonl',
          title: 'External Cursor',
          branch: null,
          model: null,
          codexHome: null,
          createdAt: null,
          updatedAt: null,
          modifiedAt: new Date().toISOString(),
          messageCount: 2,
          totalTokens: 0,
          previewMessages: [],
          queuedMessageCount: 0,
          subagentTranscriptCount: 0,
          resumeCommand: 'cursor-agent --resume external',
          subagent: null
        }
      ],
      issues: [],
      scannedAt: new Date().toISOString()
    }))
    ipcMain.handle('aiVault:prepareSessionResume', () => {
      throw new Error('Test host unavailable')
    })
  }, testRepoPath)
  const identity = await orcaPage.evaluate(() => {
    const store = window.__store!
    const worktreeId = store.getState().activeWorktreeId!
    const previous = store.getState().unifiedTabsByWorktree[worktreeId][0]
    const tab = store.getState().createUnifiedTab(worktreeId, 'agent-session', {
      entityId: 'cursor-transcript:local:external',
      executionHostId: 'local',
      agentSessionAgent: 'cursor',
      label: 'External Cursor',
      activate: true,
      agentTranscript: {
        agent: 'cursor',
        sessionId: 'external',
        transcriptPath: '/fixture/external.jsonl',
        runtimeEnvironmentId: null
      }
    })
    return { tabId: tab.id, previousId: previous.id, worktreeId }
  })
  const surface = orcaPage.locator(
    `[data-structured-agent-session-overlay-tab-id="${identity.tabId}"]`
  )
  await expect(surface.getByText('External Cursor response')).toBeVisible()
  const editor = surface.getByRole('textbox')
  await expect(editor).toBeEditable()
  await editor.fill('继续这个任务')
  await expect(surface.getByRole('button', { name: 'Resume and send' })).toBeEnabled()
  await orcaPage.screenshot({
    path: testInfo.outputPath('external-cursor-input.png'),
    timeout: 10000
  })
  await orcaPage.evaluate(
    ({ previousId, worktreeId }) =>
      window.__store!.getState().activateTab(previousId, { worktreeId }),
    identity
  )
  await expect(surface).toBeHidden()
  await orcaPage.evaluate(
    ({ tabId, worktreeId }) => window.__store!.getState().activateTab(tabId, { worktreeId }),
    identity
  )
  await expect(editor).toBeEditable()
  await expect(editor).toHaveText('继续这个任务')
  await editor.press('Enter')
  await expect(surface.getByRole('alert')).toContainText('Test host unavailable')
  await expect(editor).toHaveText('继续这个任务')
  await expect(editor).toBeEditable()
  await orcaPage.evaluate(({ worktreeId }) => {
    const store = window.__store!
    const state = store.getState()
    const terminal = state.tabsByWorktree[worktreeId][0]
    const leaf = Object.keys(state.terminalLayoutsByTabId[terminal.id].ptyIdsByLeafId ?? {})[0]
    if (!leaf) {
      throw new Error('Fixture terminal has no bound leaf')
    }
    const paneKey = `${terminal.id}:${leaf}`
    store.setState({
      agentStatusByPaneKey: {
        ...state.agentStatusByPaneKey,
        [paneKey]: {
          paneKey,
          agentType: 'cursor',
          providerSession: { key: 'session_id', id: 'external' },
          state: 'done',
          prompt: '',
          updatedAt: 0,
          stateStartedAt: 0,
          stateHistory: []
        }
      },
      sleepingAgentSessionsByPaneKey: {
        ...state.sleepingAgentSessionsByPaneKey,
        [paneKey]: {
          paneKey,
          tabId: terminal.id,
          worktreeId,
          agent: 'cursor',
          providerSession: { key: 'session_id', id: 'external' },
          state: 'done',
          prompt: '',
          capturedAt: 0,
          updatedAt: 0,
          origin: 'live'
        }
      }
    })
  }, identity)
  await expect(surface.getByRole('button', { name: 'Resume and send' })).toHaveCount(0)
  await expect(editor).toBeEditable()
  await expect(editor).toHaveText('继续这个任务')
  await orcaPage.evaluate(() => window.__store!.setState({ agentStatusByPaneKey: {} }))
  await expect(editor).toBeEditable()
  await expect(editor).toHaveText('继续这个任务')
  const windows = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isVisible(),
      focused: window.isFocused()
    }))
  )
  expect(windows.every((window) => !window.visible && !window.focused)).toBe(true)
})
