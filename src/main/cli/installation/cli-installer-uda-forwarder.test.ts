import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => tmpdir(),
    getAppPath: () => tmpdir()
  }
}))

import { CliInstaller } from '../cli-installer'
import type { WindowsUserPathReadResult } from '../command-paths/windows-user-path-registry'
import { buildWindowsForwarder } from '../launchers/cli-dev-launcher'

function userPathRead(value: string | null, expandable = false): WindowsUserPathReadResult {
  return { state: 'success', value, expandable }
}

async function makeFixture(): Promise<{ root: string; userDataPath: string; appPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'orca-cli-installer-'))
  const appPath = join(root, 'app')
  await mkdir(join(appPath, 'out', 'cli'), { recursive: true })
  await writeFile(join(appPath, 'out', 'cli', 'index.js'), 'console.log("orca")\n', 'utf8')
  return { root, userDataPath: join(root, 'userData'), appPath }
}

describe('CliInstaller UDA Orca command', () => {
  it('registers a uda-orca forwarder outside resources/bin and leaves the launcher alone', async () => {
    const fixture = await makeFixture()
    const localAppDataPath = join(fixture.root, 'AppData', 'Local')
    const resourcesPath = join(fixture.root, 'D Custom Orca', 'resources')
    const bundledLauncher = join(resourcesPath, 'bin', 'orca.exe')
    const bundledContent = 'native launcher'
    await mkdir(dirname(bundledLauncher), { recursive: true })
    await writeFile(bundledLauncher, bundledContent, 'utf8')

    let userPath: string | null = null
    const installer = new CliInstaller({
      platform: 'win32',
      isPackaged: true,
      resourcesPath,
      localAppDataPath,
      userDataPath: fixture.userDataPath,
      execPath: join(fixture.root, 'D Custom Orca', 'Orca.exe'),
      appPath: fixture.appPath,
      userPathReader: async () => userPathRead(userPath),
      userPathWriter: async (value) => {
        userPath = value
      }
    })

    const installed = await installer.install()

    expect(installed.state).toBe('installed')
    expect(installed.pathConfigured).toBe(true)
    // UDA Orca: resources\bin holds `orca`, which would shadow the official Orca's command.
    const forwarder = join(localAppDataPath, 'UDA Orca', 'bin', 'uda-orca.cmd')
    expect(installed.commandName).toBe('uda-orca')
    expect(installed.commandPath).toBe(forwarder)
    expect(userPath).toBe(dirname(forwarder))
    await expect(readFile(forwarder, 'utf8')).resolves.toBe(buildWindowsForwarder(bundledLauncher))
    await expect(readFile(bundledLauncher, 'utf8')).resolves.toBe(bundledContent)

    const removed = await installer.remove()

    expect(removed.state).toBe('not_installed')
    expect(removed.pathConfigured).toBe(false)
    expect(userPath).toBe('')
    await expect(readFile(bundledLauncher, 'utf8')).resolves.toBe(bundledContent)
  })
})
