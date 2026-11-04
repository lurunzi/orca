import type { HandlerGroup } from './handler-group-manifest'

export const DASHBOARD_ACCOUNT_HANDLER_GROUP: HandlerGroup = {
  name: 'dashboard-accounts',
  keys: [
    'dashboard-accounts status',
    'dashboard-accounts codex-processes',
    'dashboard-accounts codex-refreshes'
  ],
  load: async () => (await import('./handlers/dashboard-accounts.js')).DASHBOARD_ACCOUNT_HANDLERS
}
