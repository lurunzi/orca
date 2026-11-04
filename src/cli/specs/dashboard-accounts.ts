import type { CommandSpec } from '../args'
import { LOCAL_COMMAND_FLAGS } from '../args'

export const DASHBOARD_ACCOUNT_COMMAND_SPECS: CommandSpec[] = [
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
  }
]
