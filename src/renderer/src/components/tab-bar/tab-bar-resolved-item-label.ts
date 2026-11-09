import type { TabBarItem } from './tab-bar-item-model'
import { agentSessionTabLabel, tabItemLabel } from './tab-bar-item-label'
import type { Translate } from '@/i18n/use-translate'

type AgentSessionItemData = Extract<TabBarItem, { type: 'agent-session' }>['data']

/** Fork: a tab's label with a chat tab's fallback resolved against the generated-titles setting. */
export function resolvedTabItemLabel(
  item: TabBarItem,
  generatedTitlesEnabled: boolean,
  savedName: (data: AgentSessionItemData) => string | null,
  t?: Translate
): string {
  return tabItemLabel(
    item,
    generatedTitlesEnabled,
    item.type === 'agent-session'
      ? agentSessionTabLabel(item, generatedTitlesEnabled, savedName(item.data))
      : null,
    t
  )
}
