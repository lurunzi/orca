import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkAgentCliVersion, type AgentCliVersionInput } from '../agent-cli-version-probe'
import {
  ANTIGRAVITY_HOST_LAUNCH_SPEC,
  ANTIGRAVITY_LAUNCH_SPEC,
  acpLaunchSpecFor
} from '../acp/acp-launch-specs'
import { acpStructuredAgentDefinition } from '../acp/acp-structured-agent-definitions'
import { resolveAcpLaunchInvocation } from '../acp/acp-structured-launch-resolution'
import { supportsAcpStructuredLocation } from '../acp/acp-structured-location-support'
import { ANTIGRAVITY_ACP_RUNTIME } from './antigravity-acp-runtime'
import { antigravityCliLaunchSpec, readAgyAcpRelease } from './antigravity-cli-acp-launch-spec'

const CLI = antigravityCliLaunchSpec(ANTIGRAVITY_LAUNCH_SPEC)
// Recorded from agy 1.5.1 on Windows.
const AGY_HELP = `Usage of agy.exe:
  --model                         Model for the current CLI session

Available subcommands:
  acp             Start the Agent Client Protocol (ACP) stdio server
  agent           List available agents
`
const INPUT = { program: '/opt/agy/agy', cwd: '/work', env: {} }

function probe(version: string | null, help: string | Error) {
  const runs: string[][] = []
  const deps = {
    readVersion: async () => ({ version }),
    run: async (spec: { args?: readonly string[] }) => {
      runs.push([...(spec.args ?? [])])
      if (help instanceof Error) {
        throw help
      }
      return { stdout: '', stderr: help, code: 0, signal: null, timedOut: false }
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the probe reads only stdout, stderr and timedOut from the run result.
  const read = (input: AgentCliVersionInput) => readAgyAcpRelease(input, deps as never)
  return { read, runs }
}

describe('installed agy as the Antigravity chat server', () => {
  it('runs the CLI where no managed build exists and keeps the managed server elsewhere', () => {
    const pinned = ANTIGRAVITY_ACP_RUNTIME.pin() !== null
    expect(acpLaunchSpecFor('antigravity')).toBe(ANTIGRAVITY_HOST_LAUNCH_SPEC)
    expect(ANTIGRAVITY_HOST_LAUNCH_SPEC.command).toBe(
      pinned ? ANTIGRAVITY_LAUNCH_SPEC.command : 'agy'
    )
    // No managed runtime means no install card and launches route to chat.
    expect(acpStructuredAgentDefinition(CLI).managedRuntime).toBeUndefined()
    const local = {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'w',
      workspaceKind: 'folder'
    } as const
    expect(supportsAcpStructuredLocation(CLI, local, () => true)).toBe(true)
  })

  it('accepts an agy whose help lists the acp server', async () => {
    const { read, runs } = probe('1.5.1', AGY_HELP)
    expect(await checkAgentCliVersion(INPUT, CLI.minimumVersions!, read)).toEqual({
      status: 'ready',
      version: '1.5.1'
    })
    expect(runs).toEqual([['--help']])
  })

  it('treats an agy without acp, or another program named agy, as having no chat program', async () => {
    for (const help of ['Usage: agy [options] [paths...]\n', new Error('spawn failed')]) {
      const { read } = probe('1.11.2', help)
      expect(await checkAgentCliVersion(INPUT, CLI.minimumVersions!, read)).toEqual({
        status: 'missing',
        version: null
      })
    }
  })

  it('refuses releases before the ACP fixes chats rely on, without probing help', async () => {
    const { read, runs } = probe('1.5.0', AGY_HELP)
    expect(await checkAgentCliVersion(INPUT, CLI.minimumVersions!, read)).toEqual({
      status: 'tooOld',
      version: '1.5.0',
      minimumVersion: '1.5.1'
    })
    expect(runs).toEqual([['--help']])
    const unreadable = probe(null, AGY_HELP)
    expect(await checkAgentCliVersion(INPUT, CLI.minimumVersions!, unreadable.read)).toEqual({
      status: 'unknown',
      version: null
    })
    expect(unreadable.runs).toEqual([])
  })

  it('launches `agy acp` with the CLI account, searching the installer folder after PATH', async () => {
    const searched: string[] = []
    const resolveCommand = (command: string, options?: { pathEnv?: string | null }) => {
      searched.push(options?.pathEnv ?? '')
      return join('/found', command)
    }
    const launchEnv = { PATH: '/usr/bin', LOCALAPPDATA: '/local', GOOGLE_API_KEY: 'k' }
    const home = await CLI.account.resolve({ launchEnv, stateDirectory: '/orca' })
    expect(home).toMatchObject({
      variable: 'GEMINI_HOME',
      path: expect.stringMatching(/\.gemini$/)
    })
    const invocation = await resolveAcpLaunchInvocation(CLI, home, {
      resolveEnvironment: async () => launchEnv,
      resolveCommand,
      homePath: '/home/u',
      inheritedEnv: { GEMINI_API_KEY: 'k' },
      dataDirectory: '/orca'
    })
    expect(invocation).toMatchObject({
      command: join('/found', 'agy'),
      prefixArgs: [],
      envToDelete: []
    })
    // agy keeps its own home and sign-in; the chat changes neither.
    expect(invocation.env).toEqual(launchEnv)
    expect(searched[0]?.split(/[;:]/)).toContain(join('/local', 'agy', 'bin'))
    for (const fullAccess of [false, true]) {
      expect(CLI.args({ fullAccess, pluginDir: null })).toEqual(['acp'])
    }
  })

  it('runs the agy named by the Command setting', async () => {
    const home = await CLI.account.resolve({ launchEnv: {}, stateDirectory: '/orca' })
    const { command } = await resolveAcpLaunchInvocation(CLI, home, {
      resolveEnvironment: async () => ({ PATH: '' }),
      resolveCommandSettings: () => ({
        agentCmdOverrides: { antigravity: `"${process.execPath}"` }
      }),
      dataDirectory: '/orca'
    })
    expect(command).toBe(process.execPath)
  })
})
