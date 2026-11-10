import type { TabBarItem } from './tab-bar-item-model'
import { resolveTerminalTabTitle } from '../../../../shared/tab-title-resolution'
import { getEditorDisplayLabel } from '@/components/editor/editor-labels'
import { getBrowserTabLabel } from './BrowserTab'
import { formatSimulatorTabLabel } from '@/lib/simulator/tabs/simulator-tab-label'
import type { Translate } from '@/i18n/use-translate'

export function tabItemLabel(
  item: TabBarItem,
  generatedTitlesEnabled: boolean,
  savedName: string | null,
  t?: Translate
): string {
  if (item.type === 'terminal') {
    return resolveTerminalTabTitle(item.data, generatedTitlesEnabled, item.data.title)
  }
  if (item.type === 'browser') {
    return getBrowserTabLabel(item.data, t)
  }
  if (item.type === 'agent-session') {
    return savedName ?? agentSessionFallbackLabel(item.data)
  }
  if (item.type === 'simulator') {
    return formatSimulatorTabLabel(item.data.label, t)
  }
  return getEditorDisplayLabel(item.data, undefined, t)
}

/** Fork: an unnamed chat shows its session-history title before the generic label. */
export function agentSessionFallbackLabel(
  data: Extract<TabBarItem, { type: 'agent-session' }>['data']
): string {
  return data.aiVaultTitle?.title.trim() || data.label
}
