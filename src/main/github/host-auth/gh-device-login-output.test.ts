import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  GhDeviceLoginOutput,
  parseGhDeviceLoginPrompt,
  redactGhDeviceCodes
} from './gh-device-login-output'

// Verbatim stderr of `gh auth login --hostname github.com --git-protocol https --web` (gh 2.96, no TTY).
const GH_WEB_LOGIN_STDERR =
  '\n! First copy your one-time code: 1A2B-3C4D\n' +
  'Open this URL to continue in your web browser: https://github.com/login/device\n'
// The same text colored, as gh prints it when color is forced (GH_FORCE_TTY, CLICOLOR_FORCE).
const GH_COLORED_STDERR =
  '\u001b[0;33m!\u001b[0m First copy your one-time code: \u001b[1mZX9Q-77KM\u001b[0m\n' +
  '\u001b[1mOpen this URL\u001b[0m to continue in your web browser: https://github.com/login/device\n'

function ghStreams(): [PassThrough, PassThrough] {
  return [new PassThrough(), new PassThrough()]
}

describe('parseGhDeviceLoginPrompt', () => {
  it('reads the code and page from real gh output', () => {
    expect(parseGhDeviceLoginPrompt(GH_WEB_LOGIN_STDERR)).toEqual({
      userCode: '1A2B-3C4D',
      verificationUri: 'https://github.com/login/device'
    })
    expect(parseGhDeviceLoginPrompt(GH_COLORED_STDERR)?.userCode).toBe('ZX9Q-77KM')
  })

  it('waits until both lines are complete and refuses other pages', () => {
    expect(parseGhDeviceLoginPrompt('! First copy your one-time code: 1A2B-3C4D\n')).toBeNull()
    expect(parseGhDeviceLoginPrompt('! First copy your one-time code: 1A2B-3C')).toBeNull()
    expect(
      parseGhDeviceLoginPrompt(
        '! First copy your one-time code: 1A2B-3C4D\nOpen this URL to continue in your web browser: https://evil.example/login/device\n'
      )
    ).toBeNull()
  })

  it('masks every device code in retained output', () => {
    expect(redactGhDeviceCodes(GH_WEB_LOGIN_STDERR)).not.toContain('1A2B-3C4D')
  })
})

describe('GhDeviceLoginOutput', () => {
  it('resolves once the prompt arrives split across chunks', async () => {
    const [stdout, stderr] = ghStreams()
    const output = new GhDeviceLoginOutput([stdout, stderr], 1_000)
    stderr.write(GH_WEB_LOGIN_STDERR.slice(0, 30))
    stderr.write(GH_WEB_LOGIN_STDERR.slice(30))
    await expect(output.promptReady).resolves.toMatchObject({ userCode: '1A2B-3C4D' })
    output.dispose()
  })

  it('fails when gh shows no code in time', async () => {
    const [stdout, stderr] = ghStreams()
    const output = new GhDeviceLoginOutput([stdout, stderr], 20)
    stderr.write('! First copy your one-time code: 1A2B-3C4D\n')
    await expect(output.promptReady).rejects.toMatchObject({ code: 'promptTimeout' })
    output.dispose()
  })

  it('fails with the reason when gh exits without a code', async () => {
    const [stdout, stderr] = ghStreams()
    const output = new GhDeviceLoginOutput([stdout, stderr], 1_000)
    stderr.end(
      'The value of the GH_TOKEN environment variable is being used for authentication.\n' +
        'To have GitHub CLI store credentials instead, first clear the value from the environment.\n'
    )
    stdout.end()
    await expect(output.promptReady).rejects.toMatchObject({ code: 'envToken' })

    const [silentOut, silentErr] = ghStreams()
    const silent = new GhDeviceLoginOutput([silentOut, silentErr], 1_000)
    silentOut.end()
    silentErr.end('unknown flag: --web\n')
    await expect(silent.promptReady).rejects.toMatchObject({ code: 'noCode' })
  })
})
