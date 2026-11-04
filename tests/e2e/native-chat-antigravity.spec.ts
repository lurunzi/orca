import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  splitActiveTerminalPane,
  waitForPaneCount
} from './helpers/terminal'
import {
  clearTerminalPtyWriteLog,
  installTerminalPtyWriteSpy,
  readTerminalPtyWriteEntries
} from './helpers/terminal-pty-write-spy'

async function enableNativeChat(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const nextSettings = await window.api.settings.set({
      nativeChatProviders: { antigravity: true },
      uiLanguage: 'en'
    })
    window.__store?.setState({ settings: nextSettings })
  })
}

async function seedAntigravitySession(
  page: Page,
  args: { paneKey: string; worktreeId: string; sessionId: string }
): Promise<void> {
  await page.evaluate(({ paneKey, worktreeId, sessionId }) => {
    window.__store
      ?.getState()
      .setAgentStatus(
        paneKey,
        { state: 'done', prompt: 'Antigravity Native Chat E2E', agentType: 'antigravity' },
        'Antigravity',
        undefined,
        { worktreeId },
        { providerSession: { key: 'conversation_id', id: sessionId } }
      )
  }, args)
}

async function toggleTerminalTabView(
  page: Page,
  args: { tabId: string; worktreeId: string }
): Promise<void> {
  await page.evaluate(({ tabId, worktreeId }) => {
    const state = window.__store!.getState()
    const unifiedTab = (state.unifiedTabsByWorktree[worktreeId] ?? []).find(
      (tab) => tab.contentType === 'terminal' && tab.entityId === tabId
    )
    if (!unifiedTab) {
      throw new Error('Unified terminal tab not found')
    }
    state.toggleTabViewMode(unifiedTab.id)
  }, args)
}

async function openAntigravityChat(page: Page, app: ElectronApplication) {
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  await waitForActiveTerminalManager(page, 30_000)
  await installTerminalPtyWriteSpy(app)

  const descriptor = await waitForActivePaneHookDescriptor(page)
  const ptyId = await waitForActivePanePtyId(page)
  const [tabId] = descriptor.paneKey.split(':')
  const sessionId = `e2e-agy-${randomUUID()}`
  const home = await app.evaluate(({ app }) => app.getPath('home'))
  const logsDir = path.join(
    home,
    '.gemini',
    'antigravity-cli',
    'brain',
    sessionId,
    '.system_generated',
    'logs'
  )
  mkdirSync(logsDir, { recursive: true })
  const assistantText = 'Hello from Antigravity.'
  writeFileSync(
    path.join(logsDir, 'transcript.jsonl'),
    [
      { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'hi' },
      { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', content: assistantText }
    ]
      .map((record) => `${JSON.stringify(record)}\n`)
      .join('')
  )

  await enableNativeChat(page)
  await seedAntigravitySession(page, {
    paneKey: descriptor.paneKey,
    worktreeId: descriptor.worktreeId,
    sessionId
  })
  await toggleTerminalTabView(page, { tabId, worktreeId: descriptor.worktreeId })

  const chatRoot = page.locator('[data-native-chat-root="true"]')
  await expect(chatRoot).toBeVisible({ timeout: 15_000 })
  await expect(chatRoot.getByText(assistantText)).toBeVisible({ timeout: 30_000 })
  return { descriptor, ptyId, tabId, chatRoot, logsDir, sessionId }
}

test.describe('Antigravity Native Chat', () => {
  test('shows terminal quota and persisted subagent failures in the conversation', async ({
    electronApp,
    orcaPage: page
  }, testInfo) => {
    const { chatRoot, logsDir, descriptor, sessionId } = await openAntigravityChat(
      page,
      electronApp
    )
    const childFailure =
      'The subagent Output researcher (research) with id "child-e2e" encountered an error and has either stopped or failed to start execution: RESOURCE_EXHAUSTED (code 429): Individual quota reached.'
    appendFileSync(
      path.join(logsDir, 'transcript.jsonl'),
      `${JSON.stringify({
        step_index: 2,
        source: 'SYSTEM',
        type: 'SYSTEM_MESSAGE',
        status: 'DONE',
        content: `System-provided information.\n<SYSTEM_MESSAGE>\n[Message] content=${childFailure}\n</SYSTEM_MESSAGE>`
      })}\n`,
      'utf8'
    )
    await expect(chatRoot.getByText(childFailure, { exact: true })).toBeVisible({ timeout: 20_000 })
    const quota =
      'Individual quota reached. Resets in 4h56m48s.\nError ID: 00000000-0000-4000-8000-000000000001-10'
    await electronApp.evaluate(
      ({ BrowserWindow }, { descriptor, sessionId, quota }) => {
        BrowserWindow.getAllWindows()[0]!.webContents.send('agentStatus:set', {
          paneKey: descriptor.paneKey,
          worktreeId: descriptor.worktreeId,
          agentType: 'antigravity',
          state: 'done',
          prompt: '',
          providerSession: { key: 'conversation_id', id: sessionId },
          lastAssistantMessage: quota,
          lastAssistantMessageIsToolOutput: true,
          mainAgent: { state: 'done', outcome: 'failure', stateStartedAt: Date.now() }
        })
      },
      { descriptor, sessionId, quota }
    )
    await expect(
      chatRoot.getByText(/Individual quota reached\. Resets in 4h56m48s\./)
    ).toBeVisible()
    await expect(chatRoot.getByText(/ErrID: 00000000-0000-4000-8000-000000000001-10/)).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('antigravity-failures-visible.png') })
  })

  test('shows the model picker and submits composer sends', async ({ electronApp, orcaPage }) => {
    const { chatRoot, ptyId } = await openAntigravityChat(orcaPage, electronApp)
    await orcaPage.screenshot({ path: test.info().outputPath('antigravity-chat.png') })
    await chatRoot.getByRole('button', { name: 'Model' }).click()
    await expect(orcaPage.getByRole('combobox', { name: 'Search models…' })).toBeEditable()
    await expect(orcaPage.getByRole('option').first()).toBeVisible()
    await orcaPage.keyboard.press('Escape')

    await clearTerminalPtyWriteLog(electronApp)
    const prompt = 'Antigravity composer routed to the active PTY'
    const composer = chatRoot.getByRole('textbox')
    await composer.click()
    await orcaPage.keyboard.type(prompt)
    await chatRoot.getByRole('button', { name: 'Send' }).click()
    await expect
      .poll(
        async () =>
          (await readTerminalPtyWriteEntries(electronApp))
            .filter((entry) => entry.id === ptyId)
            .map((entry) => entry.data),
        { timeout: 10_000 }
      )
      .toEqual(expect.arrayContaining([prompt, '\r']))
  })

  for (const split of [false, true]) {
    test(`restores input after delayed reattach without a CLI toggle (${split ? 'split' : 'single'})`, async ({
      electronApp,
      orcaPage: page
    }, testInfo) => {
      const { chatRoot, tabId, ptyId, descriptor } = await openAntigravityChat(page, electronApp)
      await page.setViewportSize({ width: 1280, height: 900 })
      if (split) {
        await splitActiveTerminalPane(page, 'horizontal')
        await waitForPaneCount(page, 2)
        await page.evaluate(
          ({ tabId, paneKey }) => {
            const manager = window.__paneManagers!.get(tabId)!
            const leafId = paneKey.slice(tabId.length + 1)
            const pane = manager.getPanes().find((pane) => pane.leafId === leafId)!
            manager.setActivePane(pane.id, { focus: false })
          },
          { tabId, paneKey: descriptor.paneKey }
        )
      }
      const composer = chatRoot.getByRole('textbox')
      const draft = '空闲后继续输入 / draft survives reconnect'
      await expect(composer).toBeEditable()
      await composer.fill(draft)
      await page.clock.install()
      await page.clock.fastForward(31 * 60 * 1000)
      await expect(composer).toHaveAttribute('contenteditable', 'true')
      await expect(composer).toHaveText(draft)

      await electronApp.evaluate(({ ipcMain }) => {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Electron exposes its registered invoke handlers to the test-owned main process.
        const mainIpc = ipcMain as unknown as {
          _invokeHandlers: Map<string, (event: unknown, args: unknown) => Promise<unknown>>
        }
        const handlers = mainIpc._invokeHandlers
        const spawn = handlers.get('pty:spawn')!
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these fields belong only to this isolated test process.
        const gate = process as unknown as {
          reattachEntered?: boolean
          releaseReattach?: () => void
        }
        const held = new Promise<void>((resolve) => {
          gate.releaseReattach = resolve
        })
        handlers.set('pty:spawn', async (event, args) => {
          const result = await spawn(event, args)
          gate.reattachEntered = true
          await held
          return result
        })
      })
      try {
        const remounted = await page.evaluate(
          (tabId) => window.__store!.getState().remountTerminalTabForRecovery(tabId),
          tabId
        )
        expect(remounted.remounted).toBe(true)
        await expect
          .poll(() =>
            electronApp.evaluate(() => {
              // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: read the gate installed in this test's own main process.
              return (process as unknown as { reattachEntered?: boolean }).reattachEntered === true
            })
          )
          .toBe(true)
        await expect(composer).toHaveAttribute('contenteditable', 'false')
        await page.screenshot({ path: testInfo.outputPath('reattach-pending.png') })
        await electronApp.evaluate(() => {
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: release the gate installed in this test's own main process.
          const gate = process as unknown as { releaseReattach?: () => void }
          gate.releaseReattach?.()
        })
        await expect(composer).toHaveAttribute('contenteditable', 'true', { timeout: 15_000 })
        await expect(composer).toHaveText(draft)
        await composer.press('End')
        await composer.pressSequentially(' + recovered')
        await expect(composer).toHaveText(`${draft} + recovered`)
        await expect(chatRoot).toBeVisible()
        expect(await waitForActivePanePtyId(page)).toBe(ptyId)
        await clearTerminalPtyWriteLog(electronApp)
        await chatRoot.getByRole('button', { name: 'Send', exact: true }).click()
        await expect
          .poll(async () =>
            (await readTerminalPtyWriteEntries(electronApp)).filter((entry) =>
              entry.data.includes(draft)
            )
          )
          .toEqual([{ id: ptyId, data: `${draft} + recovered` }])
        await page.screenshot({ path: testInfo.outputPath('reattach-recovered.png') })
        expect(
          await electronApp.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows().every(
              (window) => !window.isVisible() && !window.isFocused()
            )
          )
        ).toBe(true)
      } finally {
        await electronApp.evaluate(() => {
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: cleanup releases only the gate installed in this isolated test process.
          const gate = process as unknown as { releaseReattach?: () => void }
          gate.releaseReattach?.()
        })
      }
    })
  }
})
