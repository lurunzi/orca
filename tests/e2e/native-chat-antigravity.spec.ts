import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import {
  clearTerminalPtyWriteLog,
  installTerminalPtyWriteSpy,
  readTerminalPtyWriteEntries
} from './helpers/terminal-pty-write-spy'

async function enableNativeChat(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const nextSettings = await window.api.settings.set({
      experimentalNativeChat: true,
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

test.describe('Antigravity Native Chat', () => {
  test('shows the model picker and submits composer sends', async ({ electronApp, orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)
    await installTerminalPtyWriteSpy(electronApp)

    const descriptor = await waitForActivePaneHookDescriptor(orcaPage)
    const ptyId = await waitForActivePanePtyId(orcaPage)
    const [tabId] = descriptor.paneKey.split(':')
    const sessionId = `e2e-agy-${randomUUID()}`
    const home = await electronApp.evaluate(({ app }) => app.getPath('home'))
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

    await enableNativeChat(orcaPage)
    await seedAntigravitySession(orcaPage, {
      paneKey: descriptor.paneKey,
      worktreeId: descriptor.worktreeId,
      sessionId
    })
    await toggleTerminalTabView(orcaPage, { tabId, worktreeId: descriptor.worktreeId })

    const chatRoot = orcaPage.locator('[data-native-chat-root="true"]')
    await expect(chatRoot).toBeVisible({ timeout: 15_000 })
    await expect(chatRoot.getByText(assistantText)).toBeVisible({ timeout: 30_000 })
    await orcaPage.screenshot({ path: test.info().outputPath('antigravity-chat.png') })
    await chatRoot.getByRole('button', { name: 'Model' }).click()
    await expect(orcaPage.getByRole('menuitem', { name: 'Choose in agent picker…' })).toBeEnabled()
    await orcaPage.keyboard.press('Escape')

    await clearTerminalPtyWriteLog(electronApp)
    const prompt = 'Antigravity composer routed to the active PTY'
    const composer = chatRoot.getByRole('textbox', { name: 'Send a message…' })
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
})
