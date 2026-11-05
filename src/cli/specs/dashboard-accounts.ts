import type { CommandSpec } from '../args'
import { LOCAL_COMMAND_FLAGS } from '../args'

export const DASHBOARD_ACCOUNT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['dashboard-accounts', 'restart'],
    destructive: true,
    summary: 'Interrupt and restart one confirmed local pool Agent process',
    usage: 'orca dashboard-accounts restart --request-json <metadata-json> [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'request-json'],
    notes: [
      'Uses explicit local ORCA_USER_DATA; remote selection is refused.',
      'The strict JSON request contains schema_version, instance_id, runtime_id and target with confirm_interrupt:true. Maximum 16 KiB; no credentials.',
      'The old process is interrupted. Unsent user text is retained and paused; existing model requests are not replayed.',
      'Waits at most 120 seconds. Timeout or disconnection leaves the outcome unknown; re-query process reports before another operation. No automatic retry.',
      'A replacement process does not prove target credential adoption.'
    ]
  },
  {
    path: ['dashboard-accounts', 'status'],
    summary: 'Read the local Dashboard allocation metadata without credentials',
    usage: 'orca dashboard-accounts status [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'ORCA_USER_DATA must name the absolute data directory used by this local Runtime.',
      'Remote selection flags and nonempty ORCA_PAIRING_CODE, ORCA_REMOTE_PAIRING or ORCA_ENVIRONMENT are refused.',
      'Output is JSON with or without --json. Allocation metadata does not prove process adoption.'
    ],
    examples: ['orca dashboard-accounts status --json']
  },
  {
    path: ['dashboard-accounts', 'codex-processes'],
    summary: 'Read current Codex pool credential adoption without credentials',
    usage: 'orca dashboard-accounts codex-processes [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'Uses the same explicit local ORCA_USER_DATA and remote-selection refusal as status.',
      'Reports unsupported until the Codex adapter is installed. Pending acquisitions and closing processes are not proof of completed adoption.',
      'Output is validated JSON with or without --json. No authentication or model request is triggered.'
    ],
    examples: ['orca dashboard-accounts codex-processes --json']
  },
  {
    path: ['dashboard-accounts', 'codex-refreshes'],
    summary: 'Read pending Codex credential refresh metadata without credentials',
    usage: 'orca dashboard-accounts codex-refreshes [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'Uses the same explicit local ORCA_USER_DATA and remote-selection refusal as status.',
      'Reports unsupported until the Codex adapter provides refresh observation.',
      'Output is validated JSON with or without --json. Querying does not trigger authentication, refresh or model requests.'
    ],
    examples: ['orca dashboard-accounts codex-refreshes --json']
  },
  {
    path: ['dashboard-accounts', 'claude-launches'],
    summary: 'Read local Claude process startup metadata without credentials',
    usage: 'orca dashboard-accounts claude-launches [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    notes: [
      'Uses the same explicit local ORCA_USER_DATA and remote-selection refusal as status.',
      'Reports unsupported until the Claude adapter provides launch observation.',
      'Initialized records prove startup only. Querying does not trigger authentication, model requests or restarts.'
    ],
    examples: ['orca dashboard-accounts claude-launches --json']
  }
]
