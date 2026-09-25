import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../shared/agent-session-record.test-fixture'
import { claudeSessionIdForOrcaSession } from '../claude/claude-structured-launch-resolution'
import type { WindowsProcessRow } from '../windows/windows-process-table'
import {
  agentSessionReservationCommandLineIds,
  commandLineMentionsAgentSessionId,
  findAgentSessionReservationCommandLineProcesses,
  findAgentSessionReservationProcesses
} from './agent-session-reservation-command-line-scan'

const CLAUDE_ID = 'provider-session-alpha-1'
const THREAD = '019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b'

function reservation(
  overrides: Partial<AgentSessionRecord> = {},
  runtimeKind: 'native' | 'tui' = 'native'
): AgentSessionRecord {
  const base = agentSessionRecordFixture(
    agentSessionLeaseFixture({
      runtimeKind,
      claimStatus: 'reserved',
      ownerProcess: null,
      reservedSpawnToken: 'spawn-1'
    })
  )
  return { ...base, ...overrides }
}

function codexReservation(runtimeKind: 'native' | 'tui'): AgentSessionRecord {
  return reservation(
    {
      provider: 'codex',
      accountHome: { variable: 'CODEX_HOME', path: 'C:\\codex' },
      providerHandleChain: [
        {
          linkId: 'link-1',
          origin: 'created',
          mintedAtFence: 7,
          observedAt: 1_000,
          handle: { provider: 'codex', threadId: THREAD }
        }
      ]
    },
    runtimeKind
  )
}

function row(pid: number, command: string): WindowsProcessRow {
  return { pid, ppid: 1, name: 'node.exe', command }
}

function scan(record: AgentSessionRecord, rows: WindowsProcessRow[] | Error) {
  return findAgentSessionReservationCommandLineProcesses(record, {
    platform: 'win32',
    readProcessTable: async () => {
      if (rows instanceof Error) {
        throw rows
      }
      return rows
    }
  })
}

describe('commandLineMentionsAgentSessionId', () => {
  it.each([
    `claude.exe --resume ${CLAUDE_ID}`,
    `"C:\\node.exe" cli.js --resume=${CLAUDE_ID} --verbose`,
    `node cli.js --session-id="${CLAUDE_ID}"`,
    `cmd.exe /d /s /c "claude.cmd --resume ${CLAUDE_ID}"`,
    `codex.exe resume '${CLAUDE_ID.toUpperCase()}'`
  ])('matches the id however argv quoted it: %s', (commandLine) => {
    expect(commandLineMentionsAgentSessionId(commandLine, CLAUDE_ID)).toBe(true)
  })

  it('does not match an id that is only part of a longer token', () => {
    expect(commandLineMentionsAgentSessionId(`claude --resume ${CLAUDE_ID}9`, CLAUDE_ID)).toBe(
      false
    )
    expect(commandLineMentionsAgentSessionId(`claude --resume x${CLAUDE_ID}`, CLAUDE_ID)).toBe(
      false
    )
    expect(commandLineMentionsAgentSessionId('claude --resume', '')).toBe(false)
  })
})

describe('agentSessionReservationCommandLineIds', () => {
  it('covers the chained Claude id and the id a first launch derives', () => {
    expect(agentSessionReservationCommandLineIds(reservation())).toEqual([
      claudeSessionIdForOrcaSession('session-alpha-1'),
      CLAUDE_ID
    ])
  })

  it('covers a Codex TUI thread but refuses Codex app-server, whose argv names none', () => {
    expect(agentSessionReservationCommandLineIds(codexReservation('tui'))).toEqual([THREAD])
    expect(agentSessionReservationCommandLineIds(codexReservation('native'))).toBeNull()
  })

  it('refuses WSL and remote locations, which this process table cannot see', () => {
    const base = reservation()
    expect(
      agentSessionReservationCommandLineIds({
        ...base,
        location: { ...base.location, wslDistro: 'Ubuntu' }
      })
    ).toBeNull()
    expect(
      agentSessionReservationCommandLineIds({
        ...base,
        location: { ...base.location, executionHostId: 'ssh:build-box' }
      })
    ).toBeNull()
  })
})

describe('findAgentSessionReservationCommandLineProcesses', () => {
  it('proves absence when a readable table names no reserved id', async () => {
    await expect(
      scan(reservation(), [row(10, 'explorer.exe'), row(11, 'claude.exe --resume other-session')])
    ).resolves.toEqual([])
  })

  it('reports every process whose argv names a reserved id', async () => {
    await expect(
      scan(reservation(), [
        row(10, 'explorer.exe'),
        row(11, `claude.exe --resume "${CLAUDE_ID}"`),
        row(12, `node cli.js --session-id=${claudeSessionIdForOrcaSession('session-alpha-1')}`)
      ])
    ).resolves.toEqual([11, 12])
  })

  it('stays unprovable when the table cannot be read', async () => {
    await expect(scan(reservation(), new Error('snapshot wedged'))).resolves.toBeNull()
  })

  it('stays unprovable when no row carries a command line', async () => {
    await expect(scan(reservation(), [row(10, ''), row(11, '')])).resolves.toBeNull()
  })

  it('does not read the table off Windows or for an argv-less reservation', async () => {
    const readProcessTable = vi.fn(async () => [row(10, 'explorer.exe')])
    await expect(
      findAgentSessionReservationCommandLineProcesses(reservation(), {
        platform: 'darwin',
        readProcessTable
      })
    ).resolves.toBeNull()
    await expect(
      findAgentSessionReservationCommandLineProcesses(codexReservation('native'), {
        platform: 'win32',
        readProcessTable
      })
    ).resolves.toBeNull()
    expect(readProcessTable).not.toHaveBeenCalled()
  })
})

describe('findAgentSessionReservationProcesses', () => {
  it('prefers the spawn-token answer when the host has one', async () => {
    const readProcessTable = vi.fn(async () => [row(11, `claude --resume ${CLAUDE_ID}`)])
    await expect(
      findAgentSessionReservationProcesses('spawn-1', reservation(), {
        platform: 'win32',
        readProcessTable,
        findSpawnTokenProcesses: async () => []
      })
    ).resolves.toEqual([])
    expect(readProcessTable).not.toHaveBeenCalled()
  })

  it('falls back to argv when the spawn-token scan cannot answer', async () => {
    await expect(
      findAgentSessionReservationProcesses('spawn-1', reservation(), {
        platform: 'win32',
        readProcessTable: async () => [row(11, `claude --resume ${CLAUDE_ID}`)],
        findSpawnTokenProcesses: async () => null
      })
    ).resolves.toEqual([11])
  })
})
