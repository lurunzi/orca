import type { HandlerGroup } from '../dispatch/handler-group-manifest'

export const DASHBOARD_ACCOUNT_HANDLER_GROUP: HandlerGroup = {
  name: 'dashboard-accounts',
  keys: [
    'dashboard-accounts status',
    'dashboard-accounts codex-processes',
    'dashboard-accounts codex-refreshes',
    'dashboard-accounts claude-launches',
    'dashboard-accounts restart'
  ],
  load: async () => (await import('./dashboard-accounts.js')).DASHBOARD_ACCOUNT_HANDLERS
}
