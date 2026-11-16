import { MessageSquarePlus } from 'lucide-react'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'

export function StructuredChatContinueMenuItem({
  onSelect
}: {
  onSelect: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <MessageSquarePlus />
      {t('components.agentSessionContinuation.continueInNewSession', 'Continue in New Session…')}
    </DropdownMenuItem>
  )
}
