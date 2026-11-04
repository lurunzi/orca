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
  }
]
