import { _electron as electron, expect } from '@stablyai/playwright-test'
import { build as buildMain } from 'esbuild'
import { build as buildRenderer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
if (process.env.ORCA_BACKGROUND_LAUNCH !== '1') {
  throw new Error('Requires ORCA_BACKGROUND_LAUNCH=1')
}
const root = fileURLToPath(new URL('../../../', import.meta.url))
const parent = path.join(root, '.bench-fixtures')
mkdirSync(parent, { recursive: true })
const output = mkdtempSync(path.join(parent, 'native-chat-inbox-'))
const main = path.join(output, 'main.cjs')
await buildMain({
  entryPoints: [path.join(root, 'tests/tools/benchmarks/spinner-rendering/main.ts')],
  outfile: main,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron']
})
await buildRenderer({
  configFile: false,
  root: import.meta.dirname,
  base: './',
  logLevel: 'silent',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.join(root, 'src/renderer/src') } },
  build: { outDir: path.join(output, 'renderer'), emptyOutDir: true }
})
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env
const app = await electron.launch({ args: [main], env: { ...env, ORCA_BACKGROUND_LAUNCH: '1' } })
const report = {
  scope:
    'Production inbox button, panel, projection and marks in hidden Electron, fed a journal a Claude session would write; no live agent, no Orca shell.',
  combos: []
}
const COMBOS = [
  { lang: 'en', theme: 'light', title: 'Inbox' },
  { lang: 'en', theme: 'dark', title: 'Inbox' },
  { lang: 'zh', theme: 'light', title: '收件箱' },
  { lang: 'zh', theme: 'dark', title: '收件箱' }
]
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error)
  })
  const cdp = await page.context().newCDPSession(page)
  const settle = () =>
    page.evaluate(async () => {
      await Promise.all(
        document.getAnimations().map((animation) => animation.finished.catch(() => {}))
      )
    })
  const trigger = page.locator('[data-native-chat-inbox-count]')
  const panel = page.locator('[data-native-chat-inbox-panel]')
  const log = page.locator('[data-fixture-log] li')
  for (const combo of COMBOS) {
    const url = pathToFileURL(path.join(output, 'renderer/index.html'))
    url.searchParams.set('lang', combo.lang)
    url.searchParams.set('theme', combo.theme)
    await page.goto(url.href)
    // A question and a failing check wait on the user; the two findings do not.
    await expect(trigger).toHaveAttribute('data-native-chat-inbox-count', '2')
    await trigger.click()
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText(combo.title)
    await expect(panel.locator('[data-native-chat-inbox-entry]')).toHaveCount(4)
    await settle()
    const name = `${combo.lang}-${combo.theme}.png`
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: 760, height: 600, scale: 1 }
    })
    writeFileSync(path.join(output, name), Buffer.from(data, 'base64'))
    // Answering sends the user's message, by the question's id, and stops counting it.
    await panel.locator('[data-native-chat-inbox-entry="question"] button').first().click()
    await expect(log.first()).toContainText(/^sent: .*\bq[0-9a-z]{7}\b/)
    await expect(panel.locator('[data-native-chat-inbox-entry="question"]')).toHaveCount(0)
    await expect(trigger).toHaveAttribute('data-native-chat-inbox-count', '1')
    // Dismissing a finding hides it.
    const findings = panel.locator('[data-native-chat-inbox-entry="finding"]')
    await findings.last().locator('button').last().click()
    await expect(findings).toHaveCount(1)
    // Going to the turn hands the transcript the turn's user message and closes the panel.
    await findings.first().locator('button').nth(-2).click()
    await expect(page.locator('[data-fixture-log] li').last()).toHaveText('jump: item-1')
    await expect(panel).toBeHidden()
    report.combos.push({
      ...combo,
      screenshot: name,
      log: await page.locator('[data-fixture-log] li').allTextContents()
    })
  }
  expect(errors).toEqual([])
  report.windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isVisible(),
      focused: window.isFocused()
    }))
  )
  expect(report.windows.every((window) => !window.visible && !window.focused)).toBe(true)
} finally {
  writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Native chat inbox evidence: ${output}`)
  await app.close()
}
