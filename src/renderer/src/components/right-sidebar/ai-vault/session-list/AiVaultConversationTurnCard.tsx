import type React from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { AiVaultSession } from '../../../../../../shared/ai-vault/contracts/ai-vault-types'

export function ConversationTurnCard({
  role,
  text
}: {
  role: AiVaultSession['previewMessages'][number]['role']
  text: string
}): React.JSX.Element {
  const t = useTranslate()
  const isUserTurn = role === 'user'

  return (
    <div
      className={cn(
        'rounded-md border px-2.5 py-2',
        isUserTurn
          ? 'border-border/70 bg-foreground/[0.04]'
          : 'border-sidebar-border/70 bg-sidebar-accent/25'
      )}
    >
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {conversationRoleLabel(role, t)}
      </div>
      <p className="line-clamp-4 select-text text-[12px] leading-[1.35] text-foreground/90 [overflow-wrap:anywhere]">
        {text}
      </p>
    </div>
  )
}

function conversationRoleLabel(
  role: AiVaultSession['previewMessages'][number]['role'],
  t: Translate = translate
): string {
  if (role === 'user') {
    return t('auto.components.right.sidebar.AiVaultSessionDetails.userRole', 'You')
  }
  if (role === 'assistant') {
    return t('auto.components.right.sidebar.AiVaultSessionDetails.agentRole', 'Agent')
  }
  if (role === 'tool') {
    return t('auto.components.right.sidebar.AiVaultSessionDetails.toolRole', 'Tool')
  }
  if (role === 'system') {
    return t('auto.components.right.sidebar.AiVaultSessionDetails.systemRole', 'System')
  }
  return t('auto.components.right.sidebar.AiVaultSessionDetails.sessionRole', 'Session')
}
